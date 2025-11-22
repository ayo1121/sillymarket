declare global {
  interface Window {
    html2canvas?: (el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>;
  }
}

async function loadHtml2Canvas(): Promise<(el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>> {
  if (typeof window === "undefined") {
    throw new Error("html2canvas unavailable during SSR");
  }
  if (window.html2canvas) return window.html2canvas;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-html2canvas="true"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("html2canvas load error")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.async = true;
    script.defer = true;
    script.dataset.html2canvas = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("html2canvas load error"));
    document.body.appendChild(script);
  });

  if (!window.html2canvas) {
    throw new Error("html2canvas failed to load");
  }
  return window.html2canvas;
}

export async function renderElementToPngDataUrl(el: HTMLElement): Promise<string> {
  const html2canvas = await loadHtml2Canvas();
  const canvas = await html2canvas(el, {
    backgroundColor: "#c0c0c0",
    scale: window.devicePixelRatio || 2,
  });
  return canvas.toDataURL("image/png");
}
