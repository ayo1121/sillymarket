// src/lib/idl.ts
import type { Idl } from '@coral-xyz/anchor';
import { BorshCoder } from '@coral-xyz/anchor';

export async function loadYesNoIDL(): Promise<Idl | null> {
  try {
    const mod: any = await import('@/idl/yesno_bets.json');
    return (mod?.default ?? mod) as Idl;
  } catch {
    try {
      const res = await fetch('/idl/yesno_bets.json', { cache: 'no-store' });
      if (res.ok) return (await res.json()) as Idl;
    } catch {}
    return null;
  }
}
export function getCoderOrNull(idl: Idl | null) {
  try { return idl ? new BorshCoder(idl) : null; } catch { return null; }
}
