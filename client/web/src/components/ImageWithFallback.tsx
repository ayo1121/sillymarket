import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ImageWithFallbackProps {
    src: string;
    alt: string;
    className?: string;
    fallback?: string;
    loading?: 'lazy' | 'eager';
}

/**
 * Optimized Image Component
 * 
 * Features:
 * - WebP support with fallback
 * - Lazy loading (native browser)
 * - Error handling with fallback
 * - Fade-in animation on load
 * - Placeholder while loading
 * 
 * Usage:
 * ```tsx
 * <ImageWithFallback
 *   src="/market-image.jpg"
 *   alt="Market image"
 *   loading="lazy"
 * />
 * ```
 */
export const ImageWithFallback = ({
    src,
    alt,
    className,
    fallback = '/placeholder.svg',
    loading = 'lazy',
}: ImageWithFallbackProps) => {
    const [error, setError] = useState(false);
    const [loaded, setLoaded] = useState(false);

    // Convert to WebP if not already
    const webpSrc = src.endsWith('.webp') ? src : src.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    const imageSrc = error ? fallback : src;

    return (
        <picture>
            {/* WebP source (modern browsers) */}
            {!error && (
                <source srcSet={webpSrc} type="image/webp" />
            )}

            {/* Fallback image */}
            <img
                src={imageSrc}
                alt={alt}
                loading={loading}
                className={cn(
                    'transition-opacity duration-300',
                    loaded ? 'opacity-100' : 'opacity-0',
                    className
                )}
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
            />
        </picture>
    );
};
