"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "Thiếu NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Xem .env.example.",
      );
    }
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "vn-photos-auth",
      },
    });
  }
  return client;
}

let sessionPromise: Promise<{ token: string; userId: string }> | null = null;

/**
 * Mỗi thiết bị có một danh tính ẩn danh (Supabase anonymous sign-in).
 * Danh tính này chỉ dùng để chống spam và cho phép người dùng xoá ảnh của mình.
 */
export function ensureSession(): Promise<{ token: string; userId: string }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();

      if (data.session?.access_token && data.session.user) {
        return { token: data.session.access_token, userId: data.session.user.id };
      }

      const { data: signIn, error } = await supabase.auth.signInAnonymously();
      if (error || !signIn.session?.access_token || !signIn.user) {
        throw new Error(
          "Không tạo được phiên ẩn danh. Hãy bật Anonymous Sign-ins trong Supabase → Authentication → Providers.",
        );
      }
      return { token: signIn.session.access_token, userId: signIn.user.id };
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function resetSession(): void {
  sessionPromise = null;
}
