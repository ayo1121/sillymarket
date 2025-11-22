// Auto-generated from IDL. Do not edit.
import { Program, Idl, web3 } from "@coral-xyz/anchor";
import type { Address } from "@coral-xyz/anchor";
type AnyProgram = Program<Idl>;

export async function claim_winnings(program: AnyProgram, accounts: Record<string, Address>, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["claim_winnings"]();
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function close_position(program: AnyProgram, accounts: Record<string, Address>, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["close_position"]();
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function create_market(program: AnyProgram, accounts: Record<string, Address>, arg0: any, arg1: any, arg2: any, arg3: any, arg4: any, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["create_market"](arg0, arg1, arg2, arg3, arg4);
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function initialize(program: AnyProgram, accounts: Record<string, Address>, arg0: any, arg1: any, arg2: any, arg3: any, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["initialize"](arg0, arg1, arg2, arg3);
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function place_bet(program: AnyProgram, accounts: Record<string, Address>, arg0: any, arg1: any, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["place_bet"](arg0, arg1);
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function resolve(program: AnyProgram, accounts: Record<string, Address>, arg0: any, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["resolve"](arg0);
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function set_authority(program: AnyProgram, accounts: Record<string, Address>, arg0: any, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["set_authority"](arg0);
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function set_fee_wallet(program: AnyProgram, accounts: Record<string, Address>, arg0: any, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["set_fee_wallet"](arg0);
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}

export async function void_expired(program: AnyProgram, accounts: Record<string, Address>, opts?: { preIxs?: web3.TransactionInstruction[]; postIxs?: web3.TransactionInstruction[] }) {
  let b = (program.methods as any)["void_expired"]();
  b = b.accounts(accounts);
  if (opts?.preIxs?.length) b = b.preInstructions(opts.preIxs);
  if (opts?.postIxs?.length) b = b.postInstructions(opts.postIxs);
  return b.rpc({ commitment: "confirmed" });
}
