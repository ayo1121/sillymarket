'use client';

import React from 'react';

export function CopyChip({
  value,
  short = true,
  onCopied,
  className = '',
  title,
}: {
  value: string;
  short?: boolean;
  onCopied?: (full: string) => void;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const display = React.useMemo(() => {
    if (!short) return value;
    return value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
  }, [value, short]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.(value);
    } finally {
      setTimeout(() => setCopied(false), 1000);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? value}
      className={
        'inline-flex items-center gap-1 rounded-full btn btn-ghost px-2.5 py-1 text-[11px] font-medium text-white/90 ' +
        className
      }
    >
      <span className="opacity-80">📋</span>
      <span className="font-mono">{copied ? 'Copied!' : display}</span>
    </button>
  );
}
