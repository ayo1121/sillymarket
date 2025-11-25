import { Helmet } from 'react-helmet-async';

interface SEOProps {
    title: string;
    description: string;
    image?: string;
    url?: string;
    type?: 'website' | 'article';
}

/**
 * SEO Component for Dynamic Meta Tags
 * 
 * Provides dynamic meta tags for:
 * - Page title
 * - Description
 * - Open Graph (Facebook, LinkedIn)
 * - Twitter Cards
 * - Canonical URL
 * 
 * Usage:
 * ```tsx
 * <SEO
 *   title="Market Question"
 *   description="Market description with probabilities"
 *   image="/api/og-image?marketId=123"
 *   url="/market/123"
 *   type="article"
 * />
 * ```
 */
export const SEO = ({ title, description, image, url, type = 'website' }: SEOProps) => {
    const siteUrl = window.location.origin;
    const fullUrl = url ? `${siteUrl}${url}` : window.location.href;
    const defaultImage = `${siteUrl}/og-default.png`;
    const ogImage = image || defaultImage;

    return (
        <Helmet>
            {/* Basic Meta Tags */}
            <title>{title} | sillymarket</title>
            <meta name="description" content={description} />

            {/* Open Graph */}
            <meta property="og:type" content={type} />
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={ogImage} />
            <meta property="og:url" content={fullUrl} />
            <meta property="og:site_name" content="sillymarket" />

            {/* Twitter Card */}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={ogImage} />

            {/* Canonical URL */}
            <link rel="canonical" href={fullUrl} />
        </Helmet>
    );
};
