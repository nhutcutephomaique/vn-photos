"use client";

type Props = {
  total: number;
  online: number;
  mineLabel: string | null;
  mineTitle?: string;
  onMine: () => void;
  onInfo: () => void;
};

export default function TopBar({ total, online, mineLabel, mineTitle, onMine, onInfo }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-word">vn</span>
        <span className="brand-slash">/</span>
        <span className="brand-word alt">photos</span>
        <span className="brand-tag">bàn cờ ảnh cộng đồng</span>
      </div>

      <div className="topbar-stats">
        <span className="stat">
          <b>{total.toLocaleString("vi-VN")}</b> ảnh
        </span>
        <span className="stat">
          <i className="live-dot" aria-hidden />
          {online} đang xem
        </span>
        {mineLabel && (
          <button type="button" className="stat mine" onClick={onMine} title={mineTitle ?? mineLabel ?? undefined}>
            <i className="mine-dot" aria-hidden />
            {mineLabel}
          </button>
        )}
      </div>

      <div className="topbar-actions">
        <button type="button" className="btn ghost" onClick={onInfo}>
          Luật chơi
        </button>
      </div>
    </header>
  );
}
