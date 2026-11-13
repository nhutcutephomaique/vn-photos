import { cookies } from "next/headers";
import { ADMIN_COOKIE, checkPassword, issueToken } from "@/lib/admin-auth";
import { clientIp, memoryRateLimit } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST /api/admin/login — đăng nhập bằng mật khẩu dùng chung (xem README để nâng cấp). */
export async function POST(req: Request) {
  try {
    memoryRateLimit(`admin-login:${clientIp(req)}`, 5, 5 * 60_000);

    const body = (await req.json().catch(() => ({}))) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";

    if (!checkPassword(password)) {
      throw new ApiError(401, "Sai mật khẩu.", "bad_password");
    }

    const { value, maxAge } = issueToken();
    const store = await cookies();
    store.set(ADMIN_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
