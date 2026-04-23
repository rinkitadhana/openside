import type { Request, Response, NextFunction } from "express";
import { verifyClerkJWT, type AuthUserClaims } from "../lib/verifyClerkToken";

export interface AuthenticatedRequest extends Request {
  user?: AuthUserClaims;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization as string | undefined;

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
    const decoded = await verifyClerkJWT(token);
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
  const authHeader = req.headers.authorization as string | undefined;

  if (!authHeader) {
    next();
    return;
  }

  try {
    const token = authHeader.split(" ")[1];
    if (token) {
      const decoded = await verifyClerkJWT(token);
      req.user = decoded;
    }
    next();
  } catch {
    next();
  }
}
