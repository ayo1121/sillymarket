import { createRoot } from "react-dom/client";
import React from "react";
import type { UIMarket } from "@/solana/marketMapping";
import { MarketShareCard } from "@/components/MarketShareCard";
import { renderElementToPngDataUrl } from "@/utils/shareImage";

const computeStaticTimeRemaining = (deadline: number | Date | string | null): string => {
  if (!deadline) return "closed";
  const deadlineMs =
    typeof deadline === "number" ? deadline : new Date(deadline).getTime();
  const diff = Math.max(0, deadlineMs - Date.now());
  const secs = Math.floor(diff / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;

  if (diff <= 0) return "closed";
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export async function generateMarketShareImage(
  market: UIMarket
): Promise<{ dataUrl: string; blob: Blob }> {
  return new Promise<{ dataUrl: string; blob: Blob }>((resolve, reject) => {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    container.style.width = "1200px";
    container.style.padding = "0";
    container.style.margin = "0";
    document.body.appendChild(container);

    const deadline =
      market?.closesAt?.getTime?.() ??
      (market as any)?.cutoff_ts ??
      (market as any)?.cutoffTs ??
      null;
    const timeRemainingLabel = computeStaticTimeRemaining(deadline);

    const root = createRoot(container);
    root.render(<MarketShareCard market={market} timeRemainingLabel={timeRemainingLabel} />);

    const waitForImages = async () => {
      const imgs = Array.from(container.querySelectorAll("img"));
      await Promise.allSettled(
        imgs.map(
          (img) =>
            new Promise<void>((res) => {
              if (img.complete) return res();
              img.onload = () => res();
              img.onerror = () => res();
            })
        )
      );
    };

    // Wait for next paint to ensure styles/images load
    requestAnimationFrame(async () => {
      try {
        await waitForImages();
        const dataUrl = await renderElementToPngDataUrl(container);
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        resolve({ dataUrl, blob });
      } catch (err) {
        reject(err);
      } finally {
        root.unmount();
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }
    });
  });
}
