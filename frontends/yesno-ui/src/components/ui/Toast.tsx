// src/components/ui/Toast.tsx
"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

type Toast = {
  id: string;
  title?: string;
  message: string;
  href?: string; // e.g., Solscan link
  variant?: "default" | "success" | "error" | "warning";
  ttlMs?: number;
};

type ToastCtx = {
  push: (t: Omit<Toast, "id">) => void;
  remove: (id: string) => void;
};

const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      const toast: Toast = { id, variant: "default", ttlMs: 6000, ...t };
      setToasts((prev) => [...prev, toast]);
      if (toast.ttlMs && toast.ttlMs > 0) {
        setTimeout(() => remove(id), toast.ttlMs);
      }
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={{ push, remove }}>
      {children}
      <div className="fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-xl flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "rounded-2xl px-4 py-3 shadow-lg border",
              "bg-white/90 backdrop-blur dark:bg-neutral-900/80",
              t.variant === "success" && "border-green-500",
              t.variant === "error" && "border-red-500",
              t.variant === "warning" && "border-amber-500",
              t.variant === "default" && "border-neutral-300 dark:border-neutral-700",
            ].filter(Boolean).join(" ")}
          >
            {t.title && <div className="text-sm font-semibold mb-1">{t.title}</div>}
            <div className="text-sm">{t.message}</div>
            {t.href && (
              <a
                href={t.href}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs underline opacity-80 hover:opacity-100"
              >
                View on explorer
              </a>
            )}
            <button
              onClick={() => remove(t.id)}
              className="absolute right-3 top-2 text-xs opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
