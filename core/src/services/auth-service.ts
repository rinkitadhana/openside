import { prisma } from "../db/index.ts";
import { getClerkClient } from "../lib/clerk-client.ts";
import type { AuthUserClaims } from "../lib/verifyClerkToken.ts";

interface ClerkProfile {
	email: string;
	emailVerified: boolean;
	name: string;
	avatar: string;
}

const withTimeout = async <T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> => {
	let timeoutHandle: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
	}
};

const resolveFallbackProfile = (claims: AuthUserClaims): ClerkProfile => {
	const email = claims.email;
	if (!email) {
		throw new Error("CLERK_EMAIL_NOT_FOUND");
	}
	const name = claims.name || email.split("@")[0] || "User";
	return {
		email,
		emailVerified: false,
		name,
		avatar: claims.image_url || "",
	};
};

const resolveClerkProfile = async (
	claims: AuthUserClaims,
): Promise<ClerkProfile> => {
	const clerkClient = getClerkClient();
	const clerkUser = await withTimeout(
		clerkClient.users.getUser(claims.sub),
		8000,
		"CLERK_GET_USER",
	);
	const primaryEmailId = clerkUser.primaryEmailAddressId;
	const primaryEmail = clerkUser.emailAddresses.find(
		(email) => email.id === primaryEmailId,
	);
	const email = primaryEmail?.emailAddress || claims.email;

	if (!email) {
		throw new Error("CLERK_EMAIL_NOT_FOUND");
	}

	const fullName =
		[clerkUser.firstName, clerkUser.lastName]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		clerkUser.username ||
		claims.name ||
		email.split("@")[0] ||
		"User";

	const emailVerified = primaryEmail?.verification?.status === "verified";

	return {
		email,
		emailVerified,
		name: fullName,
		avatar: clerkUser.imageUrl || claims.image_url || "",
	};
};

const isPrismaUniqueViolation = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { code?: string }).code === "P2002";

const syncProfileFromClaims = async (
	user: {
		id: string;
		name: string;
		email: string;
		avatar: string | null;
		profileCustomized?: boolean;
	},
	claims: AuthUserClaims,
) => {
	// Once the user has edited their profile in-app, their name/avatar are
	// authoritative - never clobber them with the Clerk values again.
	if (user.profileCustomized) {
		return user;
	}
	const claimName = claims.name?.trim();
	const claimAvatar = claims.image_url?.trim();
	const nameNeedsUpdate = !!claimName && claimName !== user.name;
	const avatarNeedsUpdate = !!claimAvatar && claimAvatar !== user.avatar;
	if (!nameNeedsUpdate && !avatarNeedsUpdate) {
		return user;
	}
	return prisma.user.update({
		where: { id: user.id },
		data: {
			...(nameNeedsUpdate ? { name: claimName } : {}),
			...(avatarNeedsUpdate ? { avatar: claimAvatar } : {}),
		},
	});
};

export async function findOrCreateUser(authUser: AuthUserClaims) {
	const { sub: clerkId } = authUser;
	if (!clerkId || typeof clerkId !== "string" || !clerkId.trim()) {
		throw new Error("AUTH_USER_SUB_MISSING");
	}

	let user: Awaited<ReturnType<typeof prisma.user.findUnique>>;
	try {
		user = await prisma.user.findUnique({ where: { clerkId } });
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown Prisma error";
		throw new Error(`USER_LOOKUP_FAILED(clerkId): ${errorMessage}`);
	}
	if (user) {
		return syncProfileFromClaims(user, authUser);
	}

	let profile: ClerkProfile;
	try {
		profile = await resolveClerkProfile(authUser);
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown Clerk profile error";
		console.warn(
			"[auth/findOrCreateUser] Clerk profile lookup failed, using JWT fallback",
			{
				error: errorMessage,
				clerkId,
			},
		);
		profile = resolveFallbackProfile(authUser);
	}

	let existingByEmail: Awaited<ReturnType<typeof prisma.user.findUnique>>;
	try {
		existingByEmail = await prisma.user.findUnique({
			where: { email: profile.email },
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown Prisma error";
		throw new Error(`USER_LOOKUP_FAILED(email): ${errorMessage}`);
	}

	if (existingByEmail) {
		if (!profile.emailVerified) {
			console.error(
				"[auth/findOrCreateUser] Refusing to merge: email not verified by Clerk",
				{
					newClerkId: clerkId,
					existingClerkId: existingByEmail.clerkId,
					email: profile.email,
				},
			);
			throw new Error("EMAIL_MERGE_BLOCKED_UNVERIFIED");
		}
		console.warn(
			"[auth/findOrCreateUser] Re-linking existing user to new clerkId",
			{
				previousClerkId: existingByEmail.clerkId,
				newClerkId: clerkId,
				email: profile.email,
			},
		);
		return prisma.user.update({
			where: { id: existingByEmail.id },
			data: {
				clerkId,
				name: profile.name,
				avatar: profile.avatar,
			},
		});
	}

	try {
		return await prisma.user.create({
			data: {
				clerkId,
				email: profile.email,
				name: profile.name,
				avatar: profile.avatar,
			},
		});
	} catch (error: unknown) {
		if (isPrismaUniqueViolation(error)) {
			const raceByClerkId = await prisma.user.findUnique({
				where: { clerkId },
			});
			if (raceByClerkId) return raceByClerkId;
			const raceByEmail = await prisma.user.findUnique({
				where: { email: profile.email },
			});
			if (raceByEmail) return raceByEmail;
		}
		const errorMessage =
			error instanceof Error ? error.message : "Unknown Prisma error";
		throw new Error(`USER_CREATE_FAILED: ${errorMessage}`);
	}
}
