"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "progress" | "success" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; title: string; body?: string };

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const scheduleDismiss = useCallback((id: number, delay = 7000) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setItems((previous) => previous.filter((item) => item.id !== id));
      timers.current.delete(id);
    }, delay);
    timers.current.set(id, timer);
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      seq.current += 1;
      const id = seq.current;
      setItems((previous) => [...previous, { ...toast, id }]);
      if (toast.kind !== "progress") scheduleDismiss(id);
      return id;
    },
    [scheduleDismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setItems((previous) =>
        previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
      if (patch.kind && patch.kind !== "progress") scheduleDismiss(id);
    },
    [scheduleDismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
    };
  }, []);

  return { items, push, update, dismiss };
}

const ICON: Record<ToastKind, string> = {
  progress: "◌",
  success: "✓",
  error: "!",
  info: "i",
};

export function ToastStack({
  items,
  onDismiss,
}: {
  items: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className={`toast-icon toast-icon-${toast.kind}`}>{ICON[toast.kind]}</span>
          <div className="toast-copy">
            <p className="toast-title">{toast.title}</p>
            {toast.body && <p className="toast-body">{toast.body}</p>}
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
