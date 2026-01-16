import type { Request, Response, NextFunction } from "express";
import { verifySupabaseJWT, type SupabaseUser } from "../lib/verifySupabaseToken";

export interface AuthenticatedRequest extends Request {
  user?: SupabaseUser;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ success: false, data: null, message: "Missing Authorization header" });
    return;
  }

  try {
    const token = authHeader.split(" ")[1];
    if (!token) {
      res.status(401).json({ success: false, data: null, message: "Invalid Authorization header format!" });
      return;
    }
    const decoded = await verifySupabaseJWT(token);
    req.user = decoded;
    next();
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    res.status(401).json({ success: false, data: null, message: `Unauthorized: ${errorMessage}!` });
    return;
  }
}

export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  try {
    const token = authHeader.split(" ")[1];
    if (token) {
      const decoded = await verifySupabaseJWT(token);
      req.user = decoded;
    }
    next();
  } catch {
    next();
  }
}
