import { verifyToken } from "@clerk/backend";
import type { JwtPayload } from "jsonwebtoken";

export interface AuthUserClaims extends JwtPayload {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  image_url?: string;
}

const getAuthorizedParties = (): string[] => {
  const raw = process.env.CLERK_AUTHORIZED_PARTIES;
  if (!raw) return [];

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

export async function verifyClerkJWT(token: string): Promise<AuthUserClaims> {
  const jwtKeyRaw = process.env.CLERK_JWT_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  const authorizedParties = getAuthorizedParties();

  const normalizedJwtKey = jwtKeyRaw?.replace(/\\n/g, "\n").trim();
  const hasValidJwtKey = Boolean(
    normalizedJwtKey &&
      normalizedJwtKey.includes("BEGIN PUBLIC KEY") &&
      normalizedJwtKey.includes("END PUBLIC KEY")
  );

  if (!hasValidJwtKey && !secretKey) {
    throw new Error("Missing CLERK_JWT_KEY or CLERK_SECRET_KEY");
  }

  const payload = await verifyToken(token, {
    ...(hasValidJwtKey && normalizedJwtKey ? { jwtKey: normalizedJwtKey } : {}),
    ...(secretKey ? { secretKey } : {}),
    ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
  });

  if (!payload?.sub || typeof payload.sub !== "string") {
    throw new Error("Invalid token: missing subject");
  }

  return {
    ...payload,
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    given_name:
      typeof payload.given_name === "string" ? payload.given_name : undefined,
    family_name:
      typeof payload.family_name === "string" ? payload.family_name : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    image_url:
      typeof payload.image_url === "string" ? payload.image_url : undefined,
  } as AuthUserClaims;
}
