import { useEffect, useState } from "react";

function formatRemaining(diffMs: number): string {
  const secs = Math.floor(diffMs / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;

  if (diffMs <= 0) return "closed";
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function useTimeRemaining(deadline: string | number | Date | null): {
  remainingMs: number | null;
  label: string;
} {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (!deadline) return { remainingMs: null, label: "—" };

  const deadlineMs = typeof deadline === "number" ? deadline : new Date(deadline).getTime();
  const diff = Math.max(0, deadlineMs - now);

  return {
    remainingMs: diff,
    label: formatRemaining(diff),
  };
}
