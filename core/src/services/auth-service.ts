import { prisma } from "../db/index.ts";
import { getClerkClient } from "../lib/clerk-client.ts";
import type { AuthUserClaims } from "../lib/verifyClerkToken.ts";

interface ClerkProfile {
  email: string;
  name: string;
  avatar: string;
}

const resolveClerkProfile = async (
  claims: AuthUserClaims
): Promise<ClerkProfile> => {
  const clerkClient = getClerkClient();
  const clerkUser = await clerkClient.users.getUser(claims.sub);
  const primaryEmailId = clerkUser.primaryEmailAddressId;
  const primaryEmail = clerkUser.emailAddresses.find(
    (email) => email.id === primaryEmailId
  );
  const email = primaryEmail?.emailAddress || claims.email;

  if (!email) {
    throw new Error("CLERK_EMAIL_NOT_FOUND");
  }

  const fullName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser.username ||
    claims.name ||
    email.split("@")[0] ||
    "User";

  return {
    email,
    name: fullName,
    avatar: clerkUser.imageUrl || claims.image_url || "",
  };
};

export async function findOrCreateUser(authUser: AuthUserClaims) {
  const { sub: clerkId } = authUser;

  let user = await prisma.user.findUnique({ where: { clerkId } });
  if (user) {
    return user;
  }

  const profile = await resolveClerkProfile(authUser);
  const existingByEmail = await prisma.user.findUnique({
    where: { email: profile.email },
  });

  if (existingByEmail) {
    user = await prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        clerkId,
        name: profile.name,
        avatar: profile.avatar,
      },
    });
    return user;
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        clerkId,
        email: profile.email,
        name: profile.name,
        avatar: profile.avatar,
      },
    });
    return user;
  }

  return user;
}
