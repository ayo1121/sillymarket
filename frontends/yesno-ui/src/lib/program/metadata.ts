import { Connection, PublicKey } from '@solana/web3.js';
import { BorshCoder, type Idl } from '@coral-xyz/anchor';
import programIdl from '@/idl/yesno_bets.json';
import { PROGRAM_ID } from '@/lib/constants';

const idl = programIdl as unknown as Idl;
const coder = new BorshCoder(idl);

export interface MarketMetadata {
  question: string;
  category: string;
  market: PublicKey;
}

/**
 * Find the PDA for market metadata
 */
export function findMarketMetadataPda(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market-metadata'), market.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Fetch market metadata from blockchain
 * Returns null if metadata account doesn't exist or can't be decoded
 */
export async function fetchMarketMetadata(
  connection: Connection,
  marketPubkey: PublicKey
): Promise<MarketMetadata | null> {
  try {
    // Try to find metadata PDA (if contract uses PDA for metadata)
    const [metadataPda] = findMarketMetadataPda(marketPubkey);
    
    const accountInfo = await connection.getAccountInfo(metadataPda);
    
    if (!accountInfo || !accountInfo.data) {
      console.log(`No metadata found for market ${marketPubkey.toBase58()}`);
      return null;
    }

    // Decode the account data using Borsh coder
    const decoded = coder.accounts.decode('marketMetadata', accountInfo.data);
    
    return {
      question: decoded.question || '',
      category: decoded.category || '',
      market: new PublicKey(decoded.market),
    };
  } catch (error) {
    console.error('Error fetching market metadata:', error);
    return null;
  }
}

/**
 * Fetch metadata for multiple markets in parallel
 * Returns a map of market pubkey string -> metadata
 */
export async function fetchMultipleMarketMetadata(
  connection: Connection,
  marketPubkeys: PublicKey[]
): Promise<Map<string, MarketMetadata>> {
  const results = new Map<string, MarketMetadata>();
  
  // Fetch all metadata in parallel
  const promises = marketPubkeys.map(async (pubkey) => {
    const metadata = await fetchMarketMetadata(connection, pubkey);
    return { pubkey: pubkey.toBase58(), metadata };
  });
  
  const settled = await Promise.allSettled(promises);
  
  settled.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.metadata) {
      results.set(result.value.pubkey, result.value.metadata);
    }
  });
  
  return results;
}

/**
 * Get market name with fallback to localStorage
 * This provides backwards compatibility with existing markets
 */
export function getMarketNameWithFallback(
  metadata: MarketMetadata | null,
  marketPubkey: string,
  fallbackName?: string
): string {
  if (metadata?.question) {
    return metadata.question;
  }
  
  // Fall back to localStorage
  try {
    const stored = localStorage.getItem('ynb-market-names');
    if (stored) {
      const names = JSON.parse(stored);
      if (names[marketPubkey]) {
        return names[marketPubkey];
      }
    }
  } catch (e) {
    console.error('Error reading localStorage:', e);
  }
  
  return fallbackName || 'Unnamed Market';
}
