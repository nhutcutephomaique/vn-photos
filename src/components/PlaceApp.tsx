"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Canvas, { type PlacingImage } from "@/components/Canvas";
import InfoModal from "@/components/InfoModal";
import Lightbox from "@/components/Lightbox";
import TopBar from "@/components/TopBar";
import { ToastStack, useToasts } from "@/components/Toasts";
import {
  ALLOWED_MIME_TYPES,
  BUCKET_PENDING,
  HEART_COOLDOWN_MS,
  MAX_DISPLAY_SIZE,
  MAX_UPLOAD_BYTES,
} from "@/lib/config";
import { displaySize } from "@/lib/display";
import { ensureSession, supabaseBrowser } from "@/lib/supabase/browser";
import type { Bounds, Photo, PhotoStatus } from "@/lib/types";
import { rowToPhoto, usePhotos, type RealtimePhotoRow } from "@/lib/usePhotos";

type InitResponse = { id: string; path: string; token: string };
type CompleteResponse = {
  status: "approved" | "review" | "rejected";
  photo?: Photo;
  message?: string;
};
type MeResponse = { status: PhotoStatus | null; id: string | null; photo: Photo | null };

type HeartResult =
  | { ok: true; nextHeartAt?: number; heartsLeft?: number }
  | { ok: false; message: string };

async function postJson<T>(path: string, body: unknown, token: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(json.error ?? `Lỗi ${response.status}`);
  return json as T;
}

function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Không đọc được ảnh."));
    image.src = url;
  });
}

export default function PlaceApp() {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const { photos, total, loading, upsert, remove, patch } = usePhotos(bounds);

  const [placing, setPlacing] = useState<(PlacingImage & { file: File }) | null>(null);
  const [caption, setCaption] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(1);
  const [me, setMe] = useState<MeResponse>({ status: null, id: null, photo: null });
  const [heartReadyAt, setHeartReadyAt] = useState(0);
  const [session, setSession] = useState<{ ready: boolean; error: string | null }>({
    ready: false,
    error: null,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { items: toasts, push, update, dismiss } = useToasts();

  const onBoundsChange = useCallback((next: Bounds) => setBounds(next), []);
  const selected = selectedId ? (photos[selectedId] ?? null) : null;

  // ---- Danh tính ẩn danh ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    ensureSession()
      .then(() => {
        if (!cancelled) setSession({ ready: true, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSession({
            ready: false,
            error: error instanceof Error ? error.message : "Không kết nối được Supabase.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Ảnh hiện tại của tôi (1 ảnh/tài khoản) ---------------------------
  const refreshMe = useCallback(async () => {
    try {
      const identity = await ensureSession();
      const response = await fetch("/api/me", {
        headers: { authorization: `Bearer ${identity.token}` },
        cache: "no-store",
      });
      if (!response.ok) return;
      setMe((await response.json()) as MeResponse);
    } catch {
      // chưa cấu hình Supabase — banner lỗi đã hiển thị ở trên
    }
  }, []);

  useEffect(() => {
    if (!session.ready) return;
    void refreshMe();
    // Đồng bộ định kỳ: ảnh có thể vừa được admin duyệt/gỡ.
    const timer = window.setInterval(() => void refreshMe(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshMe, session.ready]);

  // ---- Realtime: tym làm ảnh to lên + ảnh bị xoá biến mất ngay ----------
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    try {
      const supabase = supabaseBrowser();
      channel = supabase.channel("vn-photos-live", {
        config: { presence: { key: Math.random().toString(36).slice(2) } },
      });

      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "photos" },
        (payload) => {
          const row = payload.new as RealtimePhotoRow & { status?: string };
          if (row?.status !== "approved") return;
          // UPDATE này mang w/h mới sau khi có người thả tym.
          upsert(rowToPhoto(row));
        },
      );

      channel.on("broadcast", { event: "photo_deleted" }, (message) => {
        const id = (message.payload as { id?: string } | undefined)?.id;
        if (id) remove(id);
      });

      channel.on("presence", { event: "sync" }, () => {
        const state = channel?.presenceState() ?? {};
        setOnline(Math.max(1, Object.keys(state).length));
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") void channel?.track({ at: Date.now() });
      });
    } catch (error) {
      console.warn("[realtime] không kết nối được", error);
    }

    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [remove, upsert]);

  // ---- Chọn file --------------------------------------------------------
  const pickFile = useCallback(() => {
    if (!session.ready) {
      push({
        kind: "error",
        title: "Chưa kết nối được Supabase",
        body: session.error ?? "Kiểm tra biến môi trường rồi tải lại trang.",
      });
      return;
    }
    if (me.status) {
      push({
        kind: "info",
        title: "Bạn đã có 1 ảnh rồi",
        body: "Mỗi tài khoản chỉ được 1 ảnh. Xoá ảnh cũ rồi đăng ảnh mới nhé.",
      });
      return;
    }
    fileInputRef.current?.click();
  }, [me.status, push, session.error, session.ready]);

  const cancelPlacing = useCallback(() => {
    setPlacing((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setCaption("");
  }, []);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      push({
        kind: "error",
        title: "Định dạng không hỗ trợ",
        body: "Chỉ nhận JPG, PNG, WebP, GIF hoặc AVIF.",
      });
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      push({
        kind: "error",
        title: "Ảnh quá lớn",
        body: `Tối đa ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
      });
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      const dimensions = await readImageSize(url);
      const size = displaySize(dimensions.width, dimensions.height, MAX_DISPLAY_SIZE);
      if (placing) URL.revokeObjectURL(placing.url);
      setPlacing({ url, file, ...size });
      setCaption("");
      push({
        kind: "info",
        title: "Chọn vị trí trên bàn cờ",
        body: "Nhấp chuột (hoặc chạm) vào nơi bạn muốn đặt ảnh. Esc để huỷ.",
      });
    } catch {
      URL.revokeObjectURL(url);
      push({ kind: "error", title: "Không đọc được ảnh này" });
    }
  }

  // ---- Đặt ảnh + upload ------------------------------------------------
  const handlePlace = useCallback(
    async (x: number, y: number) => {
      const current = placing;
      if (!current || busy) return;

      setPlacing(null);
      setBusy(true);
      const toastId = push({ kind: "progress", title: "Đang tải ảnh lên…" });

      try {
        const identity = await ensureSession();
        const init = await postJson<InitResponse>(
          "/api/upload/init",
          { x, y, caption: caption.trim() || null },
          identity.token,
        );

        const { error } = await supabaseBrowser()
          .storage.from(BUCKET_PENDING)
          .uploadToSignedUrl(init.path, init.token, current.file, {
            contentType: current.file.type,
            upsert: false,
          });

        if (error) throw new Error(`Tải file thất bại: ${error.message}`);

        update(toastId, {
          title: "Đang kiểm duyệt ảnh…",
          body: "Hai lớp kiểm duyệt đang chạy, thường mất 2–5 giây.",
        });

        const done = await postJson<CompleteResponse>(
          "/api/upload/complete",
          { id: init.id },
          identity.token,
        );

        if (done.status === "approved" && done.photo) {
          upsert(done.photo);
          setMe({ status: "approved", id: done.photo.id, photo: done.photo });
          update(toastId, {
            kind: "success",
            title: "Ảnh đã lên bàn cờ!",
            body: "Nhờ bạn bè thả tym để ảnh to lên nhé.",
          });
        } else if (done.status === "review") {
          setMe({ status: "review", id: init.id, photo: null });
          update(toastId, {
            kind: "info",
            title: "Ảnh đang chờ người duyệt",
            body: done.message ?? "Thường được xử lý trong 24 giờ.",
          });
        } else {
          setMe({ status: null, id: null, photo: null });
          update(toastId, {
            kind: "error",
            title: "Ảnh không được đăng",
            body: done.message ?? "Ảnh không vượt qua kiểm duyệt.",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lỗi không xác định.";
        update(toastId, { kind: "error", title: "Không đăng được ảnh", body: message });
        // Có thể ảnh cũ vẫn đang chiếm chỗ → đồng bộ lại trạng thái.
        void refreshMe();
      } finally {
        URL.revokeObjectURL(current.url);
        setBusy(false);
        setCaption("");
      }
    },
    [busy, caption, placing, push, refreshMe, update, upsert],
  );

  // ---- Thả tym ---------------------------------------------------------
  const heartPhoto = useCallback(
    async (id: string): Promise<HeartResult> => {
      try {
        const identity = await ensureSession();
        const response = await fetch(`/api/photos/${id}/heart`, {
          method: "POST",
          headers: { authorization: `Bearer ${identity.token}` },
        });
        const json = (await response.json().catch(() => ({}))) as {
          hearts?: number;
          w?: number;
          h?: number;
          heartsLeft?: number;
          nextHeartAt?: string;
          error?: string;
        };
        if (!response.ok) return { ok: false, message: json.error ?? "Không thả được tym." };

        patch(id, {
          hearts: typeof json.hearts === "number" ? json.hearts : 0,
          ...(typeof json.w === "number" && typeof json.h === "number"
            ? { w: json.w, h: json.h }
            : {}),
        });

        // Bắt đầu đếm ngược 3 phút ngay trên client cho tới lần tym kế tiếp.
        const readyAt = json.nextHeartAt ? Date.parse(json.nextHeartAt) : Number.NaN;
        setHeartReadyAt(Number.isFinite(readyAt) ? readyAt : Date.now() + HEART_COOLDOWN_MS);

        return {
          ok: true,
          nextHeartAt: Number.isFinite(readyAt) ? readyAt : undefined,
          heartsLeft: json.heartsLeft,
        };
      } catch {
        return { ok: false, message: "Mất kết nối rồi, thử lại nhé." };
      }
    },
    [patch],
  );

  // ---- Xoá ảnh của mình -------------------------------------------------
  const deletePhoto = useCallback(
    async (id: string): Promise<HeartResult> => {
      try {
        const identity = await ensureSession();
        const response = await fetch(`/api/photos/${id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${identity.token}` },
        });
        if (!response.ok) {
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, message: json.error ?? "Không xoá được ảnh." };
        }

        remove(id);
        setMe({ status: null, id: null, photo: null });
        setSelectedId(null);
        return { ok: true };
      } catch {
        return { ok: false, message: "Mất kết nối rồi, thử lại nhé." };
      }
    },
    [remove],
  );

  const isEmpty = !loading && total === 0 && Object.keys(photos).length === 0;
  const isMine = Boolean(selected && me.id && selected.id === me.id);

  const mineLabel = useMemo(() => {
    if (me.status === "approved") return "ảnh của bạn";
    if (me.status === "review") return "ảnh chờ duyệt";
    if (me.status === "pending") return "ảnh đang xử lý";
    return null;
  }, [me.status]);

  const mineTitle = useMemo(() => {
    if (me.status === "approved") return "Ảnh của bạn đang ở trên bàn cờ — bấm để mở";
    if (me.status === "review") return "Ảnh đang chờ người duyệt — bấm để xoá";
    if (me.status === "pending") return "Ảnh đang được xử lý — bấm để xoá";
    return undefined;
  }, [me.status]);

  return (
    <div className="app">
      <TopBar
        total={total}
        online={online}
        mineLabel={mineLabel}
        mineTitle={mineTitle}
        onMine={() => {
          if (me.status === "approved" && me.photo) {
            // Ảnh có thể nằm ngoài khung nhìn hiện tại → nạp vào map trước.
            upsert(me.photo);
            setSelectedId(me.photo.id);
            return;
          }
          if (me.status && me.id) {
            const confirmed = window.confirm(
              "Ảnh của bạn đang chờ xử lý. Xoá nó để đăng ảnh khác?",
            );
            if (confirmed) {
              void deletePhoto(me.id).then((result) => {
                if (!result.ok) {
                  push({ kind: "error", title: "Không xoá được ảnh", body: result.message });
                } else {
                  push({ kind: "success", title: "Đã xoá — bạn có thể đăng ảnh mới." });
                }
              });
            }
            return;
          }
          push({
            kind: "info",
            title: mineLabel ?? "Ảnh đang được xử lý",
            body: "Bạn có thể xoá ảnh này để đăng ảnh khác.",
          });
        }}
        onInfo={() => setInfoOpen(true)}
      />

      <main className="stage">
        <Canvas
          photos={photos}
          placing={placing}
          myPhotoId={me.status === "approved" ? me.id : null}
          onPlace={handlePlace}
          onSelect={(photo) => setSelectedId(photo.id)}
          onBoundsChange={onBoundsChange}
          onCancelPlacing={cancelPlacing}
        />

        {isEmpty && !placing && (
          <div className="empty-state">
            <span className="empty-kicker">bàn cờ đang trống</span>
            <h1>Dán tấm ảnh đầu tiên</h1>
            <p>
              Mỗi tài khoản được <b>1 ảnh</b>. Ảnh được kiểm duyệt tự động trước khi
              xuất hiện, và càng được thả tym thì càng to ra.
            </p>
            <button type="button" className="btn primary" onClick={pickFile}>
              Đăng ảnh
            </button>
          </div>
        )}

        {placing && (
          <div className="placement-bar">
            <img src={placing.url} alt="" className="placement-thumb" />
            <div className="placement-fields">
              <p className="placement-title">
                Nhấp vào bàn cờ để đặt ảnh · {placing.w}×{placing.h}
              </p>
              <input
                className="input"
                maxLength={140}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Chú thích ngắn (không bắt buộc)"
              />
            </div>
            <button type="button" className="btn ghost" onClick={cancelPlacing}>
              Huỷ
            </button>
          </div>
        )}

        {!placing && (
          <button
            type="button"
            className={`place-cta${me.status ? " is-locked" : ""}`}
            onClick={pickFile}
            disabled={!session.ready}
            title={
              me.status
                ? "Mỗi tài khoản chỉ có 1 ảnh — xoá ảnh cũ để đặt ảnh mới"
                : "Chọn một tấm ảnh rồi click lên bàn cờ"
            }
          >
            {me.status ? "Bạn đã có 1 ảnh" : "Đặt ảnh"}
          </button>
        )}

        {session.error && (
          <div className="banner-error">
            <b>Chưa cấu hình Supabase:</b> {session.error}
          </div>
        )}
      </main>

      {selected && (
        <Lightbox
          photo={selected}
          isMine={isMine}
          heartReadyAt={heartReadyAt}
          onClose={() => setSelectedId(null)}
          onHeart={heartPhoto}
          onDelete={deletePhoto}
        />
      )}
      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}

      <ToastStack items={toasts} onDismiss={dismiss} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        hidden
        onChange={handleFileChange}
      />
    </div>
  );
}
