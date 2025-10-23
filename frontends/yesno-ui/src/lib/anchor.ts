// src/lib/anchor.ts
import type { Idl } from "@coral-xyz/anchor";
import { BorshCoder } from "@coral-xyz/anchor";
import { loadYesNoIDL } from "@/lib/idl";

/** Load the IDL once and return a BorshCoder + the IDL. */
export async function getCoder(): Promise<{ coder: BorshCoder; idl: Idl }> {
  const idl = await loadYesNoIDL();
  if (!idl) throw new Error("IDL not found");
  return { coder: new BorshCoder(idl), idl };
}
