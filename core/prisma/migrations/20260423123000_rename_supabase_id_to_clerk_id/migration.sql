ALTER TABLE "User" RENAME COLUMN "supabaseId" TO "clerkId";
ALTER INDEX IF EXISTS "User_supabaseId_key" RENAME TO "User_clerkId_key";
