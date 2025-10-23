// scripts/list_positions.js
/* eslint-disable no-console */
"use strict";

const minimist = require("minimist");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = require("@solana/web3.js");
const { getMint } = require("@solana/spl-token");

// Prefer Anchor's bs58 helper; fall back to bs58 pkg if needed
const b58 =
  (anchor.utils && anchor.utils.bytes && anchor.utils.bytes.bs58) ||
  require("bs58");

function accountDiscriminator(name) {
  // 8-byte discriminator = sha256("account:<name>")[0..7]
  return crypto
    .createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .slice(0, 8);
}

(async () => {
  const argv = minimist(process.argv.slice(2), {
    string: ["prog", "market", "rpc", "decimals"],
    boolean: ["json"],
    alias: { p: "prog", m: "market", d: "decimals" },
    default: {
      rpc:
        process.env.ANCHOR_PROVIDER_URL ||
        process.env.RPC_URL ||
        "https://api.devnet.solana.com",
      prog: process.env.PROG_ID,
      market: process.env.MARKET,
    },
  });

  if (!argv.prog || !argv.market) {
    console.error(
      "Usage: node scripts/list_positions.js --prog <PROGRAM_ID> --market <MARKET_PUBKEY> [--decimals N] [--json]"
    );
    process.exit(1);
  }

  const connection = new Connection(argv.rpc, "confirmed");
  const programId = new PublicKey(argv.prog);
  const marketPk = new PublicKey(argv.market);

  // Load IDL directly; no Program() construction (avoids 'size' error)
  const idl = require("../target/idl/yesno_bets.json");
  const coder = new anchor.BorshAccountsCoder(idl);

  // Find proper IDL account names regardless of case
  const findAcctName = (want) => {
    const lower = String(want).toLowerCase();
    return (idl.accounts || []).find((a) => a.name?.toLowerCase() === lower)?.name;
  };
  const marketName = findAcctName("market");
  const positionName = findAcctName("position");
  if (!marketName || !positionName) {
    throw new Error(
      `IDL missing accounts. market='${marketName}' position='${positionName}'`
    );
  }

  // Discriminator for Position
  const POS_DISC = accountDiscriminator(positionName);

  // Try to detect the mint + decimals from the Market account
  let mintPk = null;
  let decimals =
    argv.decimals !== undefined ? Number(argv.decimals) : undefined;

  try {
    const mi = await connection.getAccountInfo(marketPk, "confirmed");
    if (mi?.data) {
      const m = coder.decode(marketName, mi.data);
      const mintStr =
        m.betMint?.toBase58?.() ||
        m.bet_mint?.toBase58?.() ||
        (m.betMint && new PublicKey(m.betMint).toBase58?.()) ||
        (m.bet_mint && new PublicKey(m.bet_mint).toBase58?.()) ||
        (m.mint && new PublicKey(m.mint).toBase58?.());
      if (mintStr) mintPk = new PublicKey(mintStr);
    }
  } catch (_) {
    // ignore
  }

  if (decimals === undefined && mintPk) {
    try {
      const mintInfo = await getMint(connection, mintPk);
      decimals = mintInfo.decimals;
    } catch {
      // ignore, fallback below
    }
  }
  if (decimals === undefined) decimals = 6; // fallback

  // Query all Position accounts for this market.
  // We don't assume PDA seed order, so try both offsets:
  // - offset=8 (market first)
  // - offset=8+32 (bettor first, then market)
  const offsets = [8, 8 + 32];
  const seen = new Set();
  const hits = [];

  for (const off of offsets) {
    const gpas = await connection.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: b58.encode(POS_DISC) } },
        { memcmp: { offset: off, bytes: marketPk.toBase58() } },
      ],
    });

    for (const acc of gpas) {
      const key = acc.pubkey.toBase58();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(acc);
    }
  }

  const atomsToUi = (atoms) => {
    const bn = BigInt(atoms?.toString?.() ?? atoms);
    const denom = BigInt(10) ** BigInt(decimals);
    const whole = bn / denom;
    const fracRaw = (bn % denom).toString().padStart(decimals, "0");
    const frac = fracRaw.replace(/0+$/, "");
    return frac.length ? `${whole}.${frac}` : whole.toString();
  };

  const rows = hits.map(({ pubkey, account }) => {
    const p = coder.decode(positionName, account.data);

    const bettor =
      new PublicKey(p.bettor).toBase58?.() || p.bettor.toBase58();
    const mk =
      new PublicKey(p.market).toBase58?.() || p.market.toBase58();

    // normalize side (0=no, 1=yes)
    let sideNum = 0;
    if (typeof p.side === "number") sideNum = p.side;
    else if (p.side && typeof p.side === "object") {
      sideNum = "yes" in p.side ? 1 : 0;
    }

    const stakedAtoms = p.staked?.toString?.() ?? `${p.staked}`;

    return {
      position: pubkey.toBase58(),
      bettor,
      market: mk,
      side: sideNum,
      staked_atoms: stakedAtoms,
      staked_ui: atomsToUi(p.staked),
      claimed: !!p.claimed,
    };
  });

  if (argv.json) {
    console.log(
      JSON.stringify(
        {
          rpc: argv.rpc,
          program: programId.toBase58(),
          market: marketPk.toBase58(),
          mint: mintPk ? mintPk.toBase58() : null,
          decimals,
          count: rows.length,
          positions: rows,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("=== list_positions ===");
  console.log("RPC       :", argv.rpc);
  console.log("Program   :", programId.toBase58());
  console.log("Market    :", marketPk.toBase58());
  if (mintPk) console.log("Mint      :", mintPk.toBase58());
  console.log("Decimals  :", decimals);
  console.log("");

  if (!rows.length) {
    console.log("(no positions found for this market)");
    return;
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    pad("Position", 44),
    pad("Bettor", 44),
    pad("Side", 5),
    pad("Staked (ui)", 14),
    pad("Claimed", 7)
  );
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      pad(r.position, 44),
      pad(r.bettor, 44),
      pad(r.side, 5),
      pad(r.staked_ui, 14),
      pad(r.claimed, 7)
    );
  }
})();
