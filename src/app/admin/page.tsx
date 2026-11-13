import type { Metadata } from "next";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminPanel from "@/components/admin/AdminPanel";
import { isAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kiểm duyệt — vn/photos",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const authed = await isAdmin();

  return (
    <div className="admin-shell">{authed ? <AdminPanel /> : <AdminLogin />}</div>
  );
}
