import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UIMarket } from "@/solana/marketMapping";
import { renderSharePreview, type SharePreviewResult } from "../share/renderSharePreview";
import { SharePreviewMarketCard } from "@/components/share/SharePreviewMarketCard";
import { Download, Copy, Share2 } from "lucide-react";
import { logClick, logShare } from "@/lib/analytics";

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
      logShare(market.pubkey, 'copy_link');
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
    } else if (market) {
      // Track share modal open
      logClick('share_modal_open', { market_pubkey: market.pubkey });
    }
  }, [open, market?.pubkey]);

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
      <DialogContent className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#333] rounded shadow-[4px_4px_0_rgba(0,0,0,0.3)] p-0 sm:max-w-lg overflow-hidden">
        {/* Hidden canonical share card */}
        <div ref={hiddenCardRef} className="share-image-hidden-root" aria-hidden="true">
          <SharePreviewMarketCard market={market} />
        </div>

        {/* Header Bar - Windows95 style */}
        <div className="relative bg-[#ececec] dark:bg-[#242424] px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between border-b border-[#d3d3d3] dark:border-[#333] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(0,0,0,0.1)]">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-[#111] dark:text-white" />
            <span className="font-bold text-[#111] dark:text-white text-xs sm:text-sm uppercase tracking-wide">Share This Market</span>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="w-5 h-5 sm:w-6 sm:h-6 border border-[#111] dark:border-white bg-white dark:bg-[#2a2a2a] flex items-center justify-center text-[#111] dark:text-white text-sm sm:text-base font-bold hover:bg-[#111] hover:text-white dark:hover:bg-white dark:hover:text-[#111] transition-colors rounded-sm"
          >
            ✖
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5 relative">
          {/* Faint smiley watermark */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
            : )
          </div>

          <div className="relative z-10 space-y-5">
            {/* Link section */}
            <div className="space-y-2">
              <div className="text-xs text-[#666] dark:text-[#c7c7c7] uppercase tracking-wide font-bold">Market Link</div>
              <Input
                readOnly
                value={shareUrl}
                className="font-mono text-xs border-2 border-[#8b8b8b] dark:border-[#3a3a3a] bg-white dark:bg-[#1f1f1f] text-foreground shadow-[inset_1px_1px_2px_rgba(0,0,0,0.1)] focus:border-[#111]"
              />
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button
                  type="button"
                  onClick={copyLink}
                  className="font-bold shadow-md flex items-center gap-2 w-full sm:w-auto bg-[#111] text-white dark:bg-[#eee] dark:text-black hover:bg-[#333] dark:hover:bg-[#ccc] border-2 border-transparent"
                >
                  <Copy className="w-4 h-4" />
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="font-bold border-[#111] dark:border-[#444] text-[#111] dark:text-white hover:bg-[#e0e0e0] dark:hover:bg-[#2a2a2a] w-full sm:w-auto bg-[#f0f0f0] dark:bg-[#1f1f1f]"
                >
                  Close
                </Button>
              </div>
            </div>

            {/* Share image */}
            <div className="space-y-2">
              <div className="text-xs text-[#666] dark:text-[#c7c7c7] uppercase tracking-wide font-bold">Share Image</div>
              <div className="text-xs font-semibold text-[#111] dark:text-white mb-2">
                {previewError ? (
                  <span className="text-red-600">{previewError}</span>
                ) : isGeneratingPreview ? (
                  "Generating image…"
                ) : hasPreview ? (
                  "✓ Image ready"
                ) : (
                  "Waiting for image…"
                )}
              </div>
              {hasPreview && preview?.dataUrl && (
                <div className="border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-sm overflow-hidden bg-[#c0c0c0] dark:bg-[#1f1f1f] p-3">
                  <img
                    src={preview.dataUrl}
                    alt="Market share"
                    className="w-full h-auto block rounded"
                  />
                </div>
              )}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button
                  type="button"
                  onClick={handleCopyImage}
                  disabled={buttonsDisabled}
                  className="font-bold shadow-md flex items-center gap-2 w-full sm:w-auto bg-[#111] text-white dark:bg-[#eee] dark:text-black hover:bg-[#333] dark:hover:bg-[#ccc] border-2 border-transparent"
                >
                  <Copy className="w-4 h-4" />
                  Copy Image
                </Button>
                <Button
                  type="button"
                  onClick={handleDownloadImage}
                  disabled={buttonsDisabled}
                  variant="outline"
                  className="font-bold border-[#8b8b8b] dark:border-[#3a3a3a] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a] flex items-center gap-2 w-full sm:w-auto"
                >
                  <Download className="w-4 h-4" />
                  Download PNG
                </Button>
              </div>
            </div>

            {/* Share to */}
            <div className="space-y-2 pt-3 border-t-2 border-[#d3d3d3] dark:border-[#333]">
              <div className="text-xs text-[#666] dark:text-[#c7c7c7] uppercase tracking-wide font-bold">Share To</div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button
                  asChild
                  variant="secondary"
                  type="button"
                  className="font-bold shadow-sm w-full sm:w-auto"
                >
                  <a
                    href={twitterHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => logShare(market.pubkey, 'twitter')}
                  >
                    𝕏 Twitter
                  </a>
                </Button>
                <Button
                  asChild
                  variant="secondary"
                  type="button"
                  className="font-bold shadow-sm w-full sm:w-auto"
                >
                  <a href={telegramHref} target="_blank" rel="noreferrer">
                    📱 Telegram
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
