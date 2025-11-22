import type { BN } from "@coral-xyz/anchor";
type U64 = number | string | BN;
type MarketAccount = {
  cutoffTs?: number;
  state?: number;
  pools?: U64[];
  totalPool?: U64;
  imageUrl?: string;
  question?: string;
  title?: string;
};
const toNum = (v: any) => (typeof v === "object" && v?.toNumber ? v.toNumber() : Number(v ?? 0));
export function deriveView(a: MarketAccount) {
  const yes = toNum(a.pools?.[0]);
  const no = toNum(a.pools?.[1]);
  const tot = Math.max(1, toNum(a.totalPool));
  const yesPct = Math.round((yes / tot) * 100);
  const noPct = 100 - yesPct;
  const payout = (sidePool: number) => (sidePool ? (tot / sidePool).toFixed(2) + "x" : "—");
  return {
    idActive: a.state === 1,
    yesOdds: payout(yes),
    noOdds: payout(no),
    yesPercentage: yesPct,
    noPercentage: noPct,
    endDateISO: a.cutoffTs ? new Date(toNum(a.cutoffTs) * 1000).toISOString() : "",
    imageUrl: a.imageUrl || undefined,
    title: a.title || a.question || "yes/no market",
    volumeSOL: (toNum(a.totalPool) / 1e9).toFixed(3),
  };
}
