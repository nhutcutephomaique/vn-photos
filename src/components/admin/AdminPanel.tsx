"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueueItem } from "@/lib/types";

type Filter = "all" | "hold" | "reported";

type ModerationSummary = {
  reason?: string;
  flags?: string[];
  scores?: Record<string, number>;
  providers?: { name: string; ok: boolean; error?: string }[];
  admin?: { action?: string; at?: string; note?: string | null };
};

async function act(id: string, action: "approve" | "reject" | "delete") {
  const response = await fetch("/api/admin/moderate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, action }),
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "Thao tác thất bại.");
  }
}

export default function AdminPanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [blur, setBlur] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/queue", { cache: "no-store" });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const json = (await response.json()) as { items?: QueueItem[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Không tải được hàng chờ.");
      setItems(json.items ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lỗi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "hold") return items.filter((item) => item.status !== "approved");
    if (filter === "reported") return items.filter((item) => item.reportCount > 0);
    return items;
  }, [filter, items]);

  const counts = useMemo(
    () => ({
      all: items.length,
      hold: items.filter((item) => item.status !== "approved").length,
      reported: items.filter((item) => item.reportCount > 0).length,
    }),
    [items],
  );

  async function handle(id: string, action: "approve" | "reject" | "delete") {
    if (action === "delete" && !window.confirm("Xoá vĩnh viễn ảnh này? Không hoàn tác được.")) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await act(id, action);
      setItems((previous) => previous.filter((item) => item.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Thao tác thất bại.");
    } finally {
      setBusyId(null);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <div className="admin-panel">
      <header className="admin-head">
        <div>
          <h1>Hàng chờ kiểm duyệt</h1>
          <p className="muted">
            {counts.hold} ảnh chờ duyệt · {counts.reported} ảnh bị báo cáo · {counts.all} mục
          </p>
        </div>
        <div className="admin-head-actions">
          <button type="button" className="btn ghost" onClick={() => void load()}>
            Tải lại
          </button>
          <button type="button" className="btn ghost" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>

      <div className="admin-tabs">
        {(
          [
            ["all", `Tất cả (${counts.all})`],
            ["hold", `Chờ duyệt (${counts.hold})`],
            ["reported", `Bị báo cáo (${counts.reported})`],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`tab${filter === value ? " active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`tab${blur ? " active" : ""}`}
          onClick={() => setBlur((value) => !value)}
          title="Che ảnh để giảm căng thẳng cho người duyệt"
        >
          {blur ? "Đang che ảnh" : "Đang hiện ảnh"}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">Đang tải…</p>}
      {!loading && filtered.length === 0 && (
        <p className="admin-empty">Không có gì chờ duyệt. Ngon.</p>
      )}

      <div className="queue-grid">
        {filtered.map((item) => {
          const summary = (item.moderation ?? {}) as ModerationSummary;
          return (
            <article key={item.id} className="queue-card">
              <div className={`queue-media${blur ? " is-blurred" : ""}`}>
                {item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" loading="lazy" />
                ) : (
                  <span className="muted">Không tải được ảnh</span>
                )}
                <span className={`badge badge-${item.status}`}>{item.status}</span>
                {item.reportCount > 0 && (
                  <span className="badge badge-report">{item.reportCount} báo cáo</span>
                )}
              </div>

              <div className="queue-body">
                <p className="queue-caption">{item.caption || <em>Không có chú thích</em>}</p>
                <p className="queue-meta">
                  {item.x}, {item.y} · {new Date(item.createdAt).toLocaleString("vi-VN")}
                </p>

                {summary.reason && (
                  <p className="queue-reason">
                    Lý do máy: <b>{summary.reason}</b>
                  </p>
                )}

                {summary.flags && summary.flags.length > 0 && (
                  <div className="chips">
                    {summary.flags.map((flag) => (
                      <span key={flag} className="chip">
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                {summary.scores && (
                  <p className="queue-meta mono">
                    sexual {summary.scores.sexual?.toFixed(3)} · suggest{" "}
                    {summary.scores.suggestive?.toFixed(3)} · minors{" "}
                    {summary.scores.sexualMinors?.toFixed(3)} · gore{" "}
                    {summary.scores.gore?.toFixed(3)}
                  </p>
                )}

                {summary.providers && (
                  <p className="queue-meta mono">
                    {summary.providers
                      .map((provider) => `${provider.name}:${provider.ok ? "ok" : "fail"}`)
                      .join(" · ")}
                  </p>
                )}
              </div>

              <div className="queue-actions">
                <button
                  type="button"
                  className="btn success"
                  disabled={busyId === item.id || item.status === "approved"}
                  onClick={() => void handle(item.id, "approve")}
                >
                  Duyệt
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busyId === item.id}
                  onClick={() => void handle(item.id, "reject")}
                >
                  Gỡ + chặn hash
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busyId === item.id}
                  onClick={() => void handle(item.id, "delete")}
                >
                  Xoá
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
