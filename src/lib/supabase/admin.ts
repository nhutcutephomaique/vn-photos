import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}

/**
 * Client quyền service_role — BỎ QUA RLS.
 * Chỉ được dùng trong API route / server code, không bao giờ gửi xuống browser.
 */
export function adminClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "X-Client-Info": "vn-photos/server" } },
      },
    );
  }
  return cached;
}
