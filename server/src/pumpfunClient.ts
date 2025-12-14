/**
 * Pump.fun API Client
 * 
 * Fetches coin data from the Pump.fun public API to check livestream status.
 * Used by the cutoff worker to detect when Pump.fun streams end.
 */

export interface PumpfunCoin {
    is_currently_live?: boolean | null;
    livestream_id?: number | null;
    [key: string]: any;
}

const PUMPFUN_API_BASE = 'https://frontend-api-v3.pump.fun';

/**
 * Fetch coin data from Pump.fun API
 * @param mint - Solana mint address of the Pump.fun token
 * @returns PumpfunCoin object with livestream status
 * @throws Error if API request fails
 */
export async function fetchPumpfunCoin(mint: string): Promise<PumpfunCoin> {
    const url = `${PUMPFUN_API_BASE}/coins-v2/${mint}`;

    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Origin: 'https://pump.fun',
        },
    });

    if (!res.ok) {
        throw new Error(`Pump.fun coins-v2 error ${res.status}: ${res.statusText}`);
    }

    return res.json() as Promise<PumpfunCoin>;
}

/**
 * Check if a Pump.fun livestream is currently active
 * @param mint - Solana mint address of the Pump.fun token
 * @returns true if stream is live, false otherwise (including missing/null values)
 */
export async function isPumpfunStreamLive(mint: string): Promise<boolean> {
    const coin = await fetchPumpfunCoin(mint);
    // Only return true if explicitly true - any other value (false, null, undefined) is not live
    return coin.is_currently_live === true;
}
