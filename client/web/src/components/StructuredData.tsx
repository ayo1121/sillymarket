import { Helmet } from 'react-helmet-async';

interface MarketStructuredDataProps {
    market: {
        displayQuestion: string;
        description?: string;
        createdAt: Date;
        closesAt: Date;
        creatorLabel: string;
        pubkey: string;
    };
}

/**
 * Market Structured Data Component
 * 
 * Adds JSON-LD Event schema for market pages.
 * Enables Google rich snippets and better SEO.
 * 
 * Schema: https://schema.org/Event
 */
export const MarketStructuredData = ({ market }: MarketStructuredDataProps) => {
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: market.displayQuestion,
        description: market.description || market.displayQuestion,
        startDate: market.createdAt.toISOString(),
        endDate: market.closesAt.toISOString(),
        eventStatus: 'https://schema.org/EventScheduled',
        organizer: {
            '@type': 'Person',
            name: market.creatorLabel,
        },
        url: `${window.location.origin}/market/${market.pubkey}`,
    };

    return (
        <Helmet>
            <script type="application/ld+json">
                {JSON.stringify(structuredData)}
            </script>
        </Helmet>
    );
};

/**
 * Organization Structured Data Component
 * 
 * Adds JSON-LD Organization schema for homepage.
 * Improves brand recognition in search results.
 * 
 * Schema: https://schema.org/Organization
 */
export const OrganizationStructuredData = () => {
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'sillymarket',
        description: 'Prediction markets on Solana - the silliest outcome is always the most likely',
        url: window.location.origin,
        logo: `${window.location.origin}/logo.png`,
    };

    return (
        <Helmet>
            <script type="application/ld+json">
                {JSON.stringify(structuredData)}
            </script>
        </Helmet>
    );
};
