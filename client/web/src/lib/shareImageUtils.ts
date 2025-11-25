import QRCode from 'qrcode';

/**
 * Generate QR code data URL for market
 * 
 * Creates a QR code that links to the market URL.
 * Used in share modals and potentially in OG images.
 * 
 * @param marketUrl - Full URL to the market
 * @returns Data URL of QR code image
 */
export async function generateMarketQR(marketUrl: string): Promise<string> {
    try {
        return await QRCode.toDataURL(marketUrl, {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF',
            },
        });
    } catch (error) {
        console.error('Failed to generate QR code:', error);
        return '';
    }
}

/**
 * Get OG image URL for market
 * 
 * TODO: Serverless OG Image Generation
 * 
 * For production, implement serverless function to generate custom OG images:
 * 
 * Endpoint: GET /api/og-image?marketId={id}
 * 
 * Implementation options:
 * 1. **Vercel OG Image Generation**: https://vercel.com/docs/functions/edge-functions/og-image-generation
 *    - Uses React components to generate images
 *    - Edge runtime for fast generation
 *    - Example:
 *    ```typescript
 *    // api/og-image.tsx
 *    import { ImageResponse } from '@vercel/og';
 *    
 *    export const config = { runtime: 'edge' };
 *    
 *    export default async function handler(req: Request) {
 *      const { searchParams } = new URL(req.url);
 *      const marketId = searchParams.get('marketId');
 *      
 *      // Fetch market data
 *      const market = await fetchMarket(marketId);
 *      const qrCode = await generateMarketQR(`${siteUrl}/market/${marketId}`);
 *      
 *      return new ImageResponse(
 *        (
 *          <div style={{
 *            width: '100%',
 *            height: '100%',
 *            display: 'flex',
 *            flexDirection: 'column',
 *            backgroundColor: '#c0c0c0',
 *            padding: 60,
 *          }}>
 *            <h1 style={{ fontSize: 60, fontWeight: 900 }}>
 *              {market.question}
 *            </h1>
 *            <div style={{ display: 'flex', gap: 20, marginTop: 40 }}>
 *              {market.outcomes.map(outcome => (
 *                <div key={outcome.index}>
 *                  <div>{outcome.label}</div>
 *                  <div style={{ fontSize: 48 }}>{outcome.probPct}%</div>
 *                </div>
 *              ))}
 *            </div>
 *            <img src={qrCode} style={{ width: 150, marginTop: 'auto' }} />
 *          </div>
 *        ),
 *        { width: 1200, height: 630 }
 *      );
 *    }
 *    ```
 * 
 * 2. **Cloudflare Workers with Puppeteer**:
 *    - Use headless browser to render HTML
 *    - Cache generated images in R2
 * 
 * 3. **AWS Lambda with Sharp/Canvas**:
 *    - Use Sharp for image manipulation
 *    - Canvas for text rendering
 *    - Store in S3
 * 
 * Image should include:
 * - Market question (truncated if > 100 chars)
 * - Current probabilities for each outcome
 * - QR code to market URL
 * - sillymarket branding/logo
 * - Win95 aesthetic styling
 * 
 * @param marketId - Market ID or pubkey
 * @returns URL to OG image
 */
export function getMarketOGImageUrl(marketId: string): string {
    // TODO: Replace with actual OG image endpoint when implemented
    // return `/api/og-image?marketId=${marketId}`;

    // For now, use default image
    return `${window.location.origin}/og-default.png`;
}
