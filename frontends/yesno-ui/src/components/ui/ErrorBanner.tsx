"use client";

import { useState } from "react";
import { X } from "lucide-react";

export default function ErrorBanner({ title, details }: { title: string; details?: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="w-full rounded-2xl border border-red-300/40 bg-red-50/80 text-red-800 px-4 py-3 shadow-sm flex items-start gap-3">
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        {details ? <div className="text-sm opacity-80 mt-0.5">{details}</div> : null}
      </div>
      <button
        onClick={() => setOpen(false)}
        className="p-1 -mr-1 rounded-lg hover:bg-red-100"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
