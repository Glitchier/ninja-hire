import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Admin Supabase Client
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

// Per-User Supabase Client

export function createScopedClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLIC_KEY, {
    global: {
      headers: {
        Authorization: `Bearer${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
