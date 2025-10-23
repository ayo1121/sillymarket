const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = anchor.web3;
const fs = require("fs");
const path = require("path");

const TOKEN_PROGRAM_ID = new PublicKey("9sjC1DmEhMXHwmSNaq3jQrfAFzfSrPBooDjDDjukuyoR");
const ATA_PROGRAM_ID = new PublicKey("451e5ALKCbNwqGYCZwvLHUR3WbxVXDwcMoJThamTwAAG");

function ata(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}

(async () => {
  try {
    const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
    const PROG_ID = new PublicKey(process.env.PROG_ID);
    const MARKET = new PublicKey(process.env.MARKET);
    const MINT = process.env.MINT ? new PublicKey(process.env.MINT) : null;
    const OWNER = process.env.OWNER ? new PublicKey(process.env.OWNER) : null;

    // Load IDL for decoding
    const idlPath = path.join("target", "idl", "yesno_bets.json");
    if (!fs.existsSync(idlPath)) {
      throw new Error(`IDL not found at ${idlPath}. Run: anchor build`);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    const coder = new anchor.BorshCoder(idl);

    const conn = new Connection(RPC, "confirmed");
    const ai = await conn.getAccountInfo(MARKET);
    if (!ai) {
      console.log("Market account NOT found on this cluster.");
      process.exit(1);
    }

    // Try common account names in IDL
    let m, tried = [];
    for (const name of ["Market", "market"]) {
      try { m = coder.accounts.decode(name, ai.data); break; }
      catch { tried.push(name); }
    }
    if (!m) throw new Error(`Could not decode Market (tried: ${tried.join(", ")})`);

    const toPk = (x) => (x && x.toBase58 ? x.toBase58() : String(x));
    const num = (x) => Number(x ?? 0);

    const betMint = m.betMint ?? m.mint;
    const cutoff = num(m.cutoffTs ?? m.cutoff);
    const resolved = !!m.resolved;
    const winningField = m.winningOutcome;
    const yesWins = (winningField !== undefined) ? Number(winningField) === 1 : !!m.yes_wins;
    const totalYes = num(m.totalYes ?? m.yes_pool);
    const totalNo = num(m.totalNo ?? m.no_pool);
    const vault = m.vault;
    const vaultAuth = m.vaultAuthority ?? null;

    // Derive vault authority PDA used by program
    const [vaultAuthDerived] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault-auth"), MARKET.toBuffer()],
      PROG_ID
    );

    // Mint decimals (if provided) for UI amounts
    let decimals = 6;
    if (MINT) {
      const pi = await conn.getParsedAccountInfo(MINT);
      const d = pi.value?.data?.parsed?.info?.decimals;
      if (typeof d === "number") decimals = d;
    }
    const toUi = (raw) => MINT ? (raw / 10 ** decimals) : raw;

    // Optional ATAs
    const vaultAta = MINT ? ata(vaultAuthDerived, MINT) : null;
    const ownerFee = (MINT && OWNER) ? ata(OWNER, MINT) : null;

    console.log("=== Market ===");
    console.log({
      market: MARKET.toBase58(),
      betMint: toPk(betMint),
      cutoff_unix: cutoff,
      cutoff_iso: cutoff ? new Date(cutoff * 1000).toISOString() : null,
      resolved,
      yesWins,
      totalYes_raw: totalYes,
      totalNo_raw: totalNo,
      totalYes_ui: toUi(totalYes),
      totalNo_ui: toUi(totalNo),
      vault: toPk(vault),
      vaultAuth_stored: vaultAuth ? toPk(vaultAuth) : null,
      vaultAuth_derived: vaultAuthDerived.toBase58(),
      vaultAta: vaultAta ? vaultAta.toBase58() : null,
      ownerFeeAta: ownerFee ? ownerFee.toBase58() : null,
    });

    if (vaultAta) {
      const vBal = await conn.getTokenAccountBalance(vaultAta).catch(()=>null);
      console.log("vault balance:", vBal?.value?.uiAmountString ?? "N/A");
    }
    if (ownerFee) {
      const oBal = await conn.getTokenAccountBalance(ownerFee).catch(()=>null);
      console.log("owner fee balance:", oBal?.value?.uiAmountString ?? "N/A");
    }
  } catch (e) {
    console.error("view_market error:", e.message || e);
    process.exit(1);
  }
})();
