export function assertAmountStrToU64(amountStr: string, decimals: number): bigint {
  const clean = String(amountStr ?? '').trim();
  if (!clean) throw new Error('amount is required');
  const num = Number(clean);
  if (!Number.isFinite(num) || num <= 0) throw new Error('amount must be a positive number');

  // Convert to base units
  const pow = BigInt(10) ** BigInt(decimals);
  const units = BigInt(Math.floor(num * Number(pow)));
  if (units <= 0n) throw new Error('amount too small for mint decimals');
  return units;
}
