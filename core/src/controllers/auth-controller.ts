import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth-middleware";
import { findOrCreateUser } from "../services/auth-service";

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, data: null, message: "No user context!" });
      return;
    }
    const user = await findOrCreateUser(req.user);
    res.status(200).json({ success: true, data: user, message: "User retrieved successfully!" });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, data: null, message: `Failed to get user: ${errorMessage}!` });
    return;
  }
}
