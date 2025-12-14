/**
 * Market Cutoff Service
 * 
 * Handles closing betting on markets by:
 * 1. Updating Supabase market status to 'cutoff'
 * 2. Calling on-chain set_bets_open(false) instruction
 */

import { pool } from './app.js';
import { getAnchorProgram } from './anchorClient.js';
import { PublicKey } from '@solana/web3.js';

// Log helper
function logError(context: string, err: any) {
    const safeError = {
        message: err?.message || 'Unknown error',
        code: err?.code,
        name: err?.name,
    };
    console.error(`[MarketCutoffService/${context}]`, safeError);
}

export interface MarketCutoffParams {
    marketPubkey: string;
}

/**
 * Cut off a market - disables betting
 * 
 * This function is idempotent - if the market is already cutoff, it does nothing.
 * 
 * @param params.marketPubkey - The on-chain market public key
 */
export async function cutoffMarket(params: MarketCutoffParams): Promise<void> {
    const { marketPubkey } = params;

    console.log(`[MarketCutoffService] Cutting off market: ${marketPubkey}`);

    try {
        // 1) Check current status and update Supabase if needed
        const checkResult = await pool.query(
            `SELECT status FROM markets WHERE market_pubkey = $1`,
            [marketPubkey]
        );

        if (checkResult.rowCount === 0) {
            console.warn(`[MarketCutoffService] Market not found in Supabase: ${marketPubkey}`);
            return;
        }

        const currentStatus = checkResult.rows[0].status;
        if (currentStatus === 'cutoff' || currentStatus === 'resolved') {
            console.log(`[MarketCutoffService] Market already ${currentStatus}, skipping: ${marketPubkey}`);
            return;
        }

        // 2) Update Supabase status to 'cutoff'
        await pool.query(
            `UPDATE markets SET status = 'cutoff' WHERE market_pubkey = $1`,
            [marketPubkey]
        );
        console.log(`[MarketCutoffService] Updated Supabase status to 'cutoff' for: ${marketPubkey}`);

        // 3) Call on-chain set_bets_open(false)
        try {
            const { program } = getAnchorProgram();
            // Verify public keys
            const marketPk = new PublicKey(marketPubkey);

            // Find config PDA
            const [configPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("config")],
                program.programId
            );

            console.log(`[MarketCutoffService] Calling set_bets_open(false) on-chain...`);

            // Call the instruction
            const tx = await program.methods
                .setBetsOpen(false)
                .accounts({
                    config: configPda,
                    market: marketPk,
                    // authority is inferred from provider.wallet
                })
                .rpc();

            console.log(`[MarketCutoffService] On-chain cutoff success. Tx: ${tx}`);

        } catch (anchorErr: any) {
            console.error(`[MarketCutoffService] On-chain update failed: ${anchorErr.message}`);
            // We swallow this error so we don't crash the worker, 
            // but Supabase status IS updated so frontend respects it.
            // We can retry or alert in production.
            // We can retry or alert in production.
        }

    } catch (err) {
        logError('cutoffMarket', err);
        throw err;
    }
}

/**
 * Update a market's status to 'resolved'
 * Called when market resolution is detected
 */
export async function markMarketResolved(marketPubkey: string): Promise<void> {
    try {
        await pool.query(
            `UPDATE markets SET status = 'resolved' WHERE market_pubkey = $1 AND status != 'resolved'`,
            [marketPubkey]
        );
        console.log(`[MarketCutoffService] Marked market as resolved: ${marketPubkey}`);
    } catch (err) {
        logError('markMarketResolved', err);
        throw err;
    }
}
