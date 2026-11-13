import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin-auth";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const store = await cookies();
    store.delete(ADMIN_COOKIE);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
