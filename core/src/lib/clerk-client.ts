import { createClerkClient } from "@clerk/backend";

let cachedClient: ReturnType<typeof createClerkClient> | null = null;

export const getClerkClient = () => {
  if (cachedClient) {
    return cachedClient;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }

  cachedClient = createClerkClient({ secretKey });
  return cachedClient;
};

