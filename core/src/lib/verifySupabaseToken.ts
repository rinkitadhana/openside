import { createClient } from '@supabase/supabase-js'
import type { JwtPayload } from "jsonwebtoken";

export interface SupabaseUser extends JwtPayload {
  sub: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

const supabase = createClient(
  `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`,
  process.env.SUPABASE_ANON_KEY || '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

export async function verifySupabaseJWT(token: string): Promise<SupabaseUser> {
  console.log("Verifying token with Supabase client:", token.substring(0, 50) + "...");
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error) {
    console.error("JWT verification failed:", error.message);
    throw new Error(error.message);
  }
  
  if (!user) {
    throw new Error("No user found in token");
  }

  console.log("JWT verified successfully for user:", user.email);
  
  return {
    sub: user.id,
    email: user.email || '',
    user_metadata: user.user_metadata,
    aud: user.aud,
    exp: Math.floor(Date.now() / 1000),
    iat: Math.floor(Date.now() / 1000),
    iss: `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co/auth/v1`
  } as SupabaseUser;
}
