import html2canvas from "html2canvas";

export type SharePreviewResult = {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFontsAndImages(root: HTMLElement) {
  const fontPromise = (document as any).fonts?.ready?.catch?.(() => undefined) ?? Promise.resolve();
  const imgs = Array.from(root.querySelectorAll("img"));
  const imgPromises = imgs.map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth !== 0) return resolve();
        const done = () => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          resolve();
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      })
  );

  await Promise.all([fontPromise, ...imgPromises]);
}

export async function renderSharePreview(target: HTMLElement | null): Promise<SharePreviewResult> {
  if (!target) {
    throw new Error("renderSharePreview: root element is missing");
  }

  // Allow layout/fonts/images to settle
  await waitForFontsAndImages(target);
  await wait(50);

  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    throw new Error("renderSharePreview: root has zero size");
  }

  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  console.log("[share] capture rect", { width, height, left: rect.left, top: rect.top });

  const canvas = await html2canvas(target, {
    useCORS: true,
    backgroundColor: null,
    scale: window.devicePixelRatio || 2,
    width,
    height,
    scrollX: 0,
    scrollY: 0,
    logging: false,
  });

  const dataUrl = canvas.toDataURL("image/png");
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  );

  console.log("[share] capture success", { width: canvas.width, height: canvas.height, size: blob.size });
  return { dataUrl, blob, width, height };
}
