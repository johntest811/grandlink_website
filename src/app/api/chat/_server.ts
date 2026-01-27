import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function getChatAdminClient() {
  if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_ROLE) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Chat APIs require service role (server-side)."
    );
  }

  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getThreadByToken(token: string) {
  const supabase = getChatAdminClient();
  const { data, error } = await supabase
    .from("chat_threads")
    .select("*")
    .eq("access_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data as any;
}
