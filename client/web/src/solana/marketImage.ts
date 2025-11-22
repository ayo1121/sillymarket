import type { UIMarket } from "./marketMapping";

export function getMarketImageUrl(market: UIMarket | null | undefined): string | null {
  if (!market) return null;

  const candidates = [
    (market as any).imageUrl,
    (market as any).image_url,
    (market as any).image,
    (market as any).thumbnailUrl,
    (market as any).thumbnail_url,
  ].filter(Boolean) as string[];

  const url = candidates[0] ?? null;
  if (!url || url.toString().trim().length === 0) return null;
  return url.toString();
}
