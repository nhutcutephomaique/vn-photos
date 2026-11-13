"use client";

import { useEffect, useState } from "react";
import { HEARTS_PER_DAY, HEART_COOLDOWN_MS } from "@/lib/config";
import { growthFactor } from "@/lib/display";
import { REPORT_REASONS, type Photo, type ReportReason } from "@/lib/types";
import { publicPhotoUrl } from "@/lib/urls";
import { ensureSession } from "@/lib/supabase/browser";

type ActionResult = { ok: true } | { ok: false; message: string };

type Props = {
  photo: Photo;
  isMine: boolean;
  /** Thời điểm (ms) được thả tym tiếp — đồng bộ toàn app. */
  heartReadyAt: number;
  onClose: () => void;
  onHeart: (id: string) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
};

const COOLDOWN_MINUTES = Math.round(HEART_COOLDOWN_MS / 60_000);

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function Lightbox({
  photo,
  isMine,
  heartReadyAt,
  onClose,
  onHeart,
  onDelete,
}: Props) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>("sexual");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [heartBusy, setHeartBusy] = useState(false);
  const [burst, setBurst] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Đếm ngược tới lần tym kế tiếp (3 phút) để người dùng biết phải chờ bao lâu.
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, heartReadyAt - now);

  useEffect(() => {
    setNow(Date.now());
    if (heartReadyAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [heartReadyAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function like() {
    if (heartBusy || isMine || remaining > 0) return;
    setHeartBusy(true);
    setMessage(null);

    const result = await onHeart(photo.id);
    setHeartBusy(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setBurst(true);
    window.setTimeout(() => setBurst(false), 600);
  }

  async function removePhoto() {
    if (deleting) return;
    const confirmed = window.confirm(
      "Xoá ảnh này? Tym và vị trí sẽ mất hết, bạn có thể đăng ảnh mới từ đầu.",
    );
    if (!confirmed) return;

    setDeleting(true);
    const result = await onDelete(photo.id);
    setDeleting(false);
    if (!result.ok) setMessage(result.message);
  }

  async function submitReport() {
    setSending(true);
    setMessage(null);
    try {
      const session = await ensureSession();
      const response = await fetch(`/api/photos/${photo.id}/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ reason, note }),
      });
      const json = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      setMessage(json.message ?? json.error ?? "Đã gửi báo cáo.");
      setReporting(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không gửi được báo cáo.");
    } finally {
      setSending(false);
    }
  }

  const factor = growthFactor(photo.hearts);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lightbox" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="overlay-close" onClick={onClose} aria-label="Đóng">
          ×
        </button>

        <div className="lightbox-media">
          <img
            src={publicPhotoUrl(photo.path, 1280)}
            alt={photo.caption ?? "Ảnh cộng đồng"}
            draggable={false}
          />
        </div>

        <div className="lightbox-meta">
          <div className="lightbox-info">
            {photo.caption ? (
              <p className="lightbox-caption">{photo.caption}</p>
            ) : (
              <p className="lightbox-caption muted">Không có chú thích</p>
            )}
            <p className="lightbox-sub">
              {photo.w}×{photo.h}
              {factor > 1.001 && ` · đã to ${factor.toFixed(2)}× nhờ tym`} ·{" "}
              {new Date(photo.createdAt).toLocaleString("vi-VN")}
            </p>
          </div>

          <div className="lightbox-actions">
            <div className="heart-wrap">
              <button
                type="button"
                className={`heart-btn${burst ? " is-burst" : ""}${remaining > 0 ? " is-cooling" : ""}`}
                onClick={() => void like()}
                disabled={heartBusy || isMine || remaining > 0}
                title={
                  isMine
                    ? "Không tự thả tym cho ảnh của mình"
                    : `Mỗi tym làm ảnh to thêm · ${HEARTS_PER_DAY} tym/ngày · ${COOLDOWN_MINUTES} phút/tym`
                }
              >
                <span className="heart-icon" aria-hidden>
                  {heartBusy ? "·" : "♥"}
                </span>
                <span className="heart-count">{photo.hearts}</span>
              </button>
              {!isMine && remaining > 0 && (
                <span className="heart-cooldown">Tym tiếp sau {formatRemaining(remaining)}</span>
              )}
            </div>

            {isMine ? (
              <button
                type="button"
                className="btn danger"
                onClick={() => void removePhoto()}
                disabled={deleting}
              >
                {deleting ? "Đang xoá…" : "Xoá ảnh của tôi"}
              </button>
            ) : (
              !reporting && (
                <button type="button" className="btn ghost" onClick={() => setReporting(true)}>
                  Báo cáo
                </button>
              )
            )}
          </div>

          {reporting && (
            <div className="report-form">
              <label className="field">
                <span>Lý do</span>
                <select value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
                  {REPORT_REASONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Ghi chú (không bắt buộc)</span>
                <textarea
                  value={note}
                  rows={2}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Mô tả ngắn giúp người duyệt xử lý nhanh hơn"
                />
              </label>
              <div className="report-actions">
                <button type="button" className="btn ghost" onClick={() => setReporting(false)}>
                  Huỷ
                </button>
                <button type="button" className="btn danger" onClick={submitReport} disabled={sending}>
                  {sending ? "Đang gửi…" : "Gửi báo cáo"}
                </button>
              </div>
            </div>
          )}

          {message && <p className="lightbox-message">{message}</p>}
        </div>
      </div>
    </div>
  );
}
