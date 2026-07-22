import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";
import { getPublicProfile } from "../services/profile-service";

export async function getMe(
	req: AuthenticatedRequest,
	res: Response,
): Promise<void> {
	if (!req.user) {
		res
			.status(401)
			.json({ success: false, data: null, message: "Unauthorized" });
		return;
	}
	try {
		const user = await findOrCreateUser(req.user);
		const profile = await getPublicProfile(user.id);
		res.status(200).json({
			success: true,
			data: profile,
			message: "User retrieved successfully!",
		});
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		console.error("[auth/getMe] Failed to get user", {
			error: errorMessage,
			clerkId: req.user.sub,
		});
		res
			.status(500)
			.json({ success: false, data: null, message: "Failed to load user" });
	}
}
