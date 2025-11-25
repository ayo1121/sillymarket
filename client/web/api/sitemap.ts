/**
 * Vercel Serverless Function: Sitemap Generation
 * 
 * Generates sitemap.xml for https://sillymarket.fun
 * 
 * Includes:
 * - Static pages (/, /create-market, /my-bets, /terms-of-service)
 * - Dynamic market pages (/market/:pubkey)
 * 
 * Data source: Supabase markets table (reuses existing backend infrastructure)
 * Fallback: Returns valid sitemap with static pages only if market fetch fails
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE_URL = 'https://sillymarket.fun';

// Static pages configuration
const STATIC_PAGES = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    { path: '/create-market', changefreq: 'weekly', priority: '0.8' },
    { path: '/my-bets', changefreq: 'weekly', priority: '0.7' },
    { path: '/terms-of-service', changefreq: 'monthly', priority: '0.5' },
];

/**
 * Fetch markets from Supabase
 * Reuses the same backend table that the frontend queries
 */
async function fetchMarketsFromSupabase(): Promise<Array<{ market_pubkey: string; updated_at?: string }>> {
    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
            console.warn('[Sitemap] Supabase credentials not found in environment');
            return [];
        }

        // Fetch markets from Supabase markets table
        const response = await fetch(`${supabaseUrl}/rest/v1/markets?select=market_pubkey,updated_at`, {
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error('[Sitemap] Supabase fetch failed:', response.status, response.statusText);
            return [];
        }

        const markets = await response.json();
        console.log(`[Sitemap] Fetched ${markets.length} markets from Supabase`);
        return markets;
    } catch (error) {
        console.error('[Sitemap] Error fetching markets:', error);
        return [];
    }
}

/**
 * Generate sitemap XML
 */
function generateSitemapXML(markets: Array<{ market_pubkey: string; updated_at?: string }>): string {
    const staticUrls = STATIC_PAGES.map(page => `
  <url>
    <loc>${BASE_URL}${page.path}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('');

    const marketUrls = markets.map(market => {
        const lastmod = market.updated_at
            ? `\n    <lastmod>${new Date(market.updated_at).toISOString()}</lastmod>`
            : '';

        return `
  <url>
    <loc>${BASE_URL}/market/${market.market_pubkey}</loc>${lastmod}
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
  </url>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Static Pages -->${staticUrls}
  
  <!-- Dynamic Market Pages -->${marketUrls}
</urlset>`;
}

/**
 * Vercel serverless function handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        // Fetch markets from Supabase
        const markets = await fetchMarketsFromSupabase();

        // Generate sitemap XML (always returns valid XML, even if markets array is empty)
        const sitemap = generateSitemapXML(markets);

        // Set appropriate headers
        res.setHeader('Content-Type', 'text/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

        // Return sitemap
        res.status(200).send(sitemap);
    } catch (error) {
        console.error('[Sitemap] Unexpected error:', error);

        // Fallback: Return sitemap with static pages only
        const fallbackSitemap = generateSitemapXML([]);
        res.setHeader('Content-Type', 'text/xml; charset=utf-8');
        res.status(200).send(fallbackSitemap);
    }
}
