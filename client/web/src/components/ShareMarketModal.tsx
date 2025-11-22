import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UIMarket } from "@/solana/marketMapping";
import { renderSharePreview, type SharePreviewResult } from "../share/renderSharePreview";
import { SharePreviewMarketCard } from "@/components/share/SharePreviewMarketCard";

type ShareMarketModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  market: UIMarket;
};

export function ShareMarketModal({ open, onOpenChange, market }: ShareMarketModalProps) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<SharePreviewResult | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const hiddenCardRef = useRef<HTMLDivElement | null>(null);

  const shareUrl = useMemo(() => {
    if (!market) return "";
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/market/${market.pubkey}`;
  }, [market]);

  const shareText = market?.displayQuestion ?? "Check out this market";

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[ShareMarketModal] failed to copy link", err);
    }
  };

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setPreview(null);
      setIsGeneratingPreview(false);
      setPreviewError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !market?.pubkey) {
      return;
    }

    let cancelled = false;

    const attempt = async () => {
      setIsGeneratingPreview(true);
      setPreviewError(null);
      setPreview(null);

      // allow card to render
      await new Promise((r) => setTimeout(r, 30));

      const node = hiddenCardRef.current;
      if (!node) {
        if (!cancelled) {
          console.warn("[share] hidden card not ready, retrying…");
          setTimeout(() => {
            if (!cancelled) void attempt();
          }, 50);
        }
        return;
      }

      try {
        const result = await renderSharePreview(node);
        if (cancelled) return;
        setPreview(result);
        setPreviewError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("[share] capture failed", err);
          setPreviewError("failed to generate image");
        }
      } finally {
        if (!cancelled) setIsGeneratingPreview(false);
      }
    };

    void attempt();
    return () => {
      cancelled = true;
    };
  }, [open, market?.pubkey]);

  const canUseClipboardImage =
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    // @ts-expect-error ClipboardItem not always in lib.dom
    typeof window.ClipboardItem !== "undefined" &&
    typeof (navigator.clipboard as any).write === "function";

  const handleDownloadImage = useCallback(() => {
    if (!preview?.dataUrl && !preview?.blob) return;

    const url = preview?.dataUrl ?? URL.createObjectURL(preview!.blob!);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sillymarket-share.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (!preview?.dataUrl && preview?.blob) {
      URL.revokeObjectURL(url);
    }
  }, [preview]);

  const handleCopyImage = useCallback(async () => {
    if (!preview?.dataUrl && !preview?.blob) return;

    try {
      let blob = preview?.blob ?? null;
      if (!blob && preview?.dataUrl) {
        blob = await fetch(preview.dataUrl).then((res) => res.blob());
      }
      if (!blob) return;

      if (canUseClipboardImage && blob) {
        // @ts-expect-error ClipboardItem not typed in some configs
        const item = new ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
        console.log("[ShareMarketModal] image copied as blob");
        return;
      }

      if (navigator.clipboard && preview?.dataUrl) {
        await navigator.clipboard.writeText(preview.dataUrl);
        console.log("[ShareMarketModal] image data URL copied as text");
        return;
      }

      console.warn("[ShareMarketModal] Clipboard image not supported, falling back to download");
      handleDownloadImage();
    } catch (err) {
      console.error("[ShareMarketModal] copy image failed, falling back to download", err);
      handleDownloadImage();
    }
  }, [preview, canUseClipboardImage, handleDownloadImage]);

  if (!open || !market) return null;

  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;

  const hasPreview = !!preview?.dataUrl;
  const buttonsDisabled = isGeneratingPreview || !hasPreview;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="win95-window bg-background p-1 sm:max-w-lg share-market-dialog-content">
        {/* Hidden canonical share card */}
        <div ref={hiddenCardRef} className="share-image-hidden-root" aria-hidden="true">
          <SharePreviewMarketCard market={market} />
        </div>
        <div className="bg-primary text-primary-foreground px-2 py-2 font-black text-sm tracking-tight">
          share this market
        </div>
        <div className="win95-sunken bg-background p-4 space-y-4">
          {/* Link section */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">link</div>
            <Input readOnly value={shareUrl} className="font-mono text-xs" />
            <div className="flex items-center gap-2">
              <Button type="button" onClick={copyLink} className="text-sm font-bold">
                {copied ? "copied!" : "copy link"}
              </Button>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)} className="text-sm font-bold">
                close
              </Button>
            </div>
          </div>

          {/* Share image */}
          <div className="share-section">
            <div className="share-section-label">share image</div>
            <div className="share-image-status">
              {previewError ? (
                <span className="share-image-error">{previewError}</span>
              ) : isGeneratingPreview ? (
                "generating image…"
              ) : hasPreview ? (
                "image ready"
              ) : (
                "waiting for image…"
              )}
            </div>
            {hasPreview && preview?.dataUrl && (
              <div className="share-market-image-wrapper">
                <img
                  src={preview.dataUrl}
                  alt="Market share"
                  className="share-market-image"
                  style={{ maxWidth: "100%", height: "auto", display: "block" }}
                />
              </div>
            )}
            <div className="share-image-actions">
              <Button
                type="button"
                onClick={handleCopyImage}
                disabled={buttonsDisabled}
                className="text-sm font-bold"
              >
                copy image
              </Button>
              <Button
                type="button"
                onClick={handleDownloadImage}
                disabled={buttonsDisabled}
                className="text-sm font-bold"
              >
                download png
              </Button>
            </div>
          </div>

          {/* Share to */}
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">share to</div>
            <div className="flex items-center gap-2">
              <Button asChild variant="secondary" type="button" className="text-sm font-bold">
                <a href={twitterHref} target="_blank" rel="noreferrer">
                  Twitter/X
                </a>
              </Button>
              <Button asChild variant="secondary" type="button" className="text-sm font-bold">
                <a href={telegramHref} target="_blank" rel="noreferrer">
                  Telegram
                </a>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
