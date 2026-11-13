"use client";

import { useState } from "react";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Đăng nhập thất bại.");
      }
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Đăng nhập thất bại.");
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <h1>Kiểm duyệt vn/photos</h1>
      <p className="muted">
        Khu vực nội bộ. Mọi hành động duyệt/gỡ đều được ghi vào log của ảnh.
      </p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Mật khẩu admin</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            required
          />
        </label>
        <button type="submit" className="btn primary full" disabled={busy}>
          {busy ? "Đang kiểm tra…" : "Vào bảng duyệt"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  );
}
