/// FILE: client/web/src/solana/program.ts
import { useMemo } from "react";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { WalletContextState, useWallet } from "@solana/wallet-adapter-react";
import { getConnection } from "./connection";
import rawIdl from "../idl/yesno_markets.json";

// Create a mutable copy of the IDL for patching
const idl = JSON.parse(JSON.stringify(rawIdl)) as anchor.Idl;

// Normalize IDL: attach type information to accounts if missing
function normalizeIdl(raw: any): anchor.Idl {
  const normalized: any = { ...raw };

  // If accounts exist but don't have type, attach from types array
  if (Array.isArray(normalized.accounts) && Array.isArray(normalized.types)) {
    const typeMap = new Map<string, any>();
    for (const t of normalized.types) {
      if (t && typeof t.name === "string") {
        typeMap.set(t.name, t);
      }
    }

    normalized.accounts = normalized.accounts.map((acc: any) => {
      if (!acc || acc.type) return acc; // Already has type
      const typeDef = typeMap.get(acc.name);
      if (typeDef && typeDef.type) {
        return { ...acc, type: typeDef.type };
      }
      // If no type found, add a reference
      return { ...acc, type: { defined: acc.name } };
    });
  }

  return normalized as anchor.Idl;
}


const PROGRAM_ID = new PublicKey(
  // support both new and old IDL formats
  ((idl as any).address ??
    (idl as any).metadata?.address ??
    import.meta.env.VITE_PROGRAM_ID) as string
);

export function getAnchorProgram(wallet: WalletContextState) {
  const connection = getConnection();

  const hasPk = !!wallet.publicKey;
  const hasSigner = !!wallet.signTransaction;
  const hasSignAll = !!wallet.signAllTransactions;

  if (!hasPk || !hasSigner || !hasSignAll) {
    console.warn("[yesno] getAnchorProgram: wallet not ready, using read-only provider", {
      hasPublicKey: hasPk,
      hasSigner,
      hasSignAll,
    });
  }

  // Provide a dummy wallet for read-only flows so the app can load without a connected wallet
  const dummy = anchor.web3.Keypair.generate();
  const readOnlyWallet: anchor.Wallet = {
    publicKey: dummy.publicKey,
    signTransaction: async () => {
      throw new Error("Wallet not connected");
    },
    signAllTransactions: async () => {
      throw new Error("Wallet not connected");
    },
  };

  // We'll log IDL summary after normalization and patching

  // Ensure wallet has all required signing methods
  if (!hasSignAll) {
    console.warn("[yesno] getAnchorProgram: wallet missing signAllTransactions");
  }

  // Create AnchorWallet wrapper that matches Anchor's expected interface
  const anchorWallet: anchor.Wallet = hasPk && hasSigner && hasSignAll
    ? {
      publicKey: wallet.publicKey!,
      signTransaction: wallet.signTransaction!,
      signAllTransactions: wallet.signAllTransactions!,
    }
    : readOnlyWallet;

  const provider = new anchor.AnchorProvider(
    connection,
    anchorWallet,
    { commitment: "confirmed" }
  );

  // Debug log to verify signer mapping
  if (import.meta.env.DEV && provider && wallet.publicKey && hasPk && hasSigner && hasSignAll) {
    console.log("[yesno] getAnchorProgram: signer debug", {
      walletPubkey: wallet.publicKey.toBase58(),
      providerWallet: provider.wallet.publicKey?.toBase58?.(),
      matches: wallet.publicKey.equals(provider.wallet.publicKey),
    });
  }

  try {
    // Use the raw IDL
    const rawIdl = idl as unknown as Idl;

    // Normalize for BorshCoder sizing etc.
    const normalizedIdl = normalizeIdl(rawIdl);

    // Ensure IDL has address set
    if (!(normalizedIdl as any).address) {
      (normalizedIdl as any).address = PROGRAM_ID.toBase58();
    }

    const accountsWithType = Array.isArray((normalizedIdl as any).accounts)
      ? (normalizedIdl as any).accounts.filter((acc: any) => acc.type).length
      : 0;
    const accountsCount = Array.isArray((normalizedIdl as any).accounts)
      ? (normalizedIdl as any).accounts.length
      : 0;
    if (import.meta.env.DEV) {
      console.log("[yesno] getAnchorProgram: IDL summary", {
        keys: Object.keys(normalizedIdl),
        hasAccounts: Array.isArray((normalizedIdl as any).accounts),
        accountsCount,
        hasTypes: Array.isArray((normalizedIdl as any).types),
        typesCount: Array.isArray((normalizedIdl as any).types)
          ? (normalizedIdl as any).types.length
          : 0,
        accountsWithType,
        allAccountsHaveType: accountsCount > 0 && accountsWithType === accountsCount,
      });
    }

    // Test coder creation to verify accounts can be processed
    try {
      const testCoder = new anchor.BorshCoder(normalizedIdl);
      const hasAccountsCoder = !!(testCoder as any).accounts;

      if (import.meta.env.DEV) {
        console.log("[yesno] BorshCoder test:", {
          hasAccountsCoder,
          accountsKeys: hasAccountsCoder ? Object.keys((testCoder as any).accounts || {}) : [],
        });
      }

      if (!hasAccountsCoder) {
        console.error("[yesno] BorshCoder.accounts is undefined - this will cause AccountClient errors");
        throw new Error("BorshCoder.accounts is undefined - IDL accounts missing type information");
      }
    } catch (coderErr: any) {
      console.error("[yesno] Failed to create BorshCoder:", coderErr);
      throw coderErr;
    }

    // Program constructor: (idl, provider) uses idl.address
    const program = new anchor.Program(normalizedIdl as anchor.Idl, provider);

    // Verify program has account namespace
    if (!(program as any).account) {
      console.warn("[yesno] Program.account namespace missing");
    }
    if (import.meta.env.DEV) {
      console.log("[yesno] ✅ Program initialized", {
        programId: program.programId.toBase58(),
        hasAccountNamespace: !!(program as any).account,
      });
    }

    return program;
  } catch (err: any) {
    console.error("[yesno] ❌ Failed to init Anchor program", {
      err,
      errorMessage: err?.message,
      errorStack: err?.stack,
      idlKeys: Object.keys(idl),
      hasAccounts: Array.isArray((idl as any).accounts),
      accountsCount: Array.isArray((idl as any).accounts)
        ? (idl as any).accounts.length
        : 0,
      hasTypes: Array.isArray((idl as any).types),
      typesCount: Array.isArray((idl as any).types)
        ? (idl as any).types.length
        : 0,
      accountsWithType: Array.isArray((idl as any).accounts)
        ? (idl as any).accounts.filter((acc: any) => acc.type).length
        : 0,
    });
    return null;
  }
}

/**
 * Get program and provider for actions that need both
 */
export function getAnchorProgramWithProvider(wallet: WalletContextState): {
  program: anchor.Program<anchor.Idl>;
  provider: anchor.AnchorProvider;
} | null {
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
    return null;
  }
  const program = getAnchorProgram(wallet);
  if (!program) return null;

  const provider = program.provider as anchor.AnchorProvider;
  return { program, provider };
}

/**
 * Returns a program + connection bound to the real wallet from WalletContextState.
 * This does NOT use any "wallet not ready" stub. It requires a connected wallet.
 */
export function getWritableProgram(
  wallet: WalletContextState
): {
  program: anchor.Program<any>;
  connection: Connection;
  authority: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
} {
  if (!wallet.publicKey) {
    throw new Error("[yesno] getWritableProgram: wallet has no publicKey");
  }
  if (!wallet.signTransaction) {
    throw new Error("[yesno] getWritableProgram: wallet has no signTransaction");
  }

  const authority = wallet.publicKey;

  // Use shared connection instance
  const connection = getConnection();

  // AnchorWallet wrapper over the wallet-adapter wallet
  const anchorWallet = {
    publicKey: authority,
    signTransaction: wallet.signTransaction.bind(wallet),
    signAllTransactions: wallet.signAllTransactions
      ? wallet.signAllTransactions.bind(wallet)
      : async (txs: Transaction[]) =>
        Promise.all(txs.map((tx) => wallet.signTransaction!(tx))),
  } as anchor.Wallet;

  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    preflightCommitment: "processed",
    commitment: "confirmed",
  });

  // Use the same programId and *patched* idl you already use
  const program = new anchor.Program(idl as anchor.Idl, provider);

  return {
    program,
    connection,
    authority,
    signTransaction: wallet.signTransaction.bind(wallet),
  };
}

export function useAnchorProgram() {
  const wallet = useWallet();

  return useMemo(() => {
    return getAnchorProgram(wallet);
  }, [wallet]);
}
