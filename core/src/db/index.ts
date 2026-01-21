import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/client/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

export default prisma;

export * from "../../prisma/generated/client/client.js";
