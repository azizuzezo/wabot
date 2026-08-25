import { createClient } from "@supabase/supabase-js";

const DATABASE_URL = process.env.SUPABASE_URL;

const DATABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const database =
  DATABASE_URL && DATABASE_SECRET_KEY
    ? createClient(DATABASE_URL, DATABASE_SECRET_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;
