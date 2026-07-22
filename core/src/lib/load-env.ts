import dotenv from "dotenv";

const nodeEnv = process.env.NODE_ENV ?? "development";
const envFile = nodeEnv === "production" ? ".env.production" : ".env.local";

dotenv.config({ path: envFile });
