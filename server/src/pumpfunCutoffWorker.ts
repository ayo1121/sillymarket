/**
 * Pump.fun Cutoff Worker
 * 
 * Polls Supabase for markets with cutoff_mode = 'pumpfun_stream_end' and status = 'open'.
 * For each such market, checks if the Pump.fun stream is still live.
 * If the stream has ended, triggers the cutoff process.
 */

import { pool } from './app.js';
import { isPumpfunStreamLive } from './pumpfunClient.js';
import { cutoffMarket } from './marketCutoffService.js';

// Configuration from environment
const POLL_INTERVAL_SECS = parseInt(process.env.PUMPFUN_CUTOFF_POLL_INTERVAL_SECS || '30', 10);

let isRunning = false;
let intervalHandle: NodeJS.Timeout | null = null;

function logInfo(msg: string) {
    console.log(`[PumpfunCutoffWorker] ${msg}`);
}

function logError(context: string, err: any) {
    const safeError = {
        message: err?.message || 'Unknown error',
        code: err?.code,
        name: err?.name,
    };
    console.error(`[PumpfunCutoffWorker/${context}]`, safeError);
}

interface OpenPumpfunMarket {
    market_pubkey: string;
    pumpfun_mint: string;
}

/**
 * Query Supabase for markets that need Pump.fun stream monitoring
 */
async function getOpenPumpfunMarkets(): Promise<OpenPumpfunMarket[]> {
    const result = await pool.query<OpenPumpfunMarket>(
        `SELECT market_pubkey, pumpfun_mint 
         FROM markets 
         WHERE cutoff_mode = 'pumpfun_stream_end' 
           AND status = 'open' 
           AND pumpfun_mint IS NOT NULL`
    );
    return result.rows;
}

/**
 * Single poll tick - check all open Pump.fun markets
 */
async function pollTick(): Promise<void> {
    try {
        const markets = await getOpenPumpfunMarkets();

        if (markets.length === 0) {
            // No markets to check - this is normal
            return;
        }

        logInfo(`Checking ${markets.length} open Pump.fun market(s)`);

        for (const market of markets) {
            try {
                const isLive = await isPumpfunStreamLive(market.pumpfun_mint);

                if (!isLive) {
                    logInfo(`Stream ended for market ${market.market_pubkey} (mint: ${market.pumpfun_mint})`);
                    await cutoffMarket({ marketPubkey: market.market_pubkey });
                }
            } catch (err) {
                // Log error but continue with other markets
                logError(`checkMarket:${market.market_pubkey}`, err);
            }
        }
    } catch (err) {
        logError('pollTick', err);
    }
}

/**
 * Start the Pump.fun cutoff worker
 * Polls at the configured interval
 */
export function startPumpfunCutoffWorker(): void {
    if (isRunning) {
        logInfo('Worker already running, skipping start');
        return;
    }

    isRunning = true;
    logInfo(`Starting worker with ${POLL_INTERVAL_SECS}s interval`);

    // Run immediately on start
    pollTick().catch(err => logError('initialPoll', err));

    // Then poll at interval
    intervalHandle = setInterval(() => {
        pollTick().catch(err => logError('intervalPoll', err));
    }, POLL_INTERVAL_SECS * 1000);
}

/**
 * Stop the Pump.fun cutoff worker
 */
export function stopPumpfunCutoffWorker(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    isRunning = false;
    logInfo('Worker stopped');
}

/**
 * Check if worker is currently running
 */
export function isWorkerRunning(): boolean {
    return isRunning;
}
