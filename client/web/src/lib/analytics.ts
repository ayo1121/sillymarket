// Analytics event logging utility
// Sends events to backend for analytics tracking

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface EventProperties {
    [key: string]: string | number | boolean | null | undefined;
}

/**
 * Log an analytics event to the backend
 * 
 * @param eventType - Type of event (e.g., 'page_view', 'click', 'bet_modal_open')
 * @param properties - Optional event-specific properties
 * @param marketPubkey - Optional related market public key
 */
export async function logEvent(
    eventType: string,
    properties?: EventProperties,
    marketPubkey?: string
): Promise<void> {
    try {
        const page = window.location.pathname;

        await fetch(`${API_URL}/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // Include cookies for session tracking
            body: JSON.stringify({
                eventType,
                eventProperties: properties,
                page,
                marketPubkey,
            }),
        });

        // Fire and forget - don't wait for response or handle errors
        // This ensures analytics doesn't block user interactions
    } catch (error) {
        // Silently fail - analytics should never break the app
        console.debug('[Analytics] Failed to log event:', eventType, error);
    }
}

/**
 * Log a page view event
 * 
 * @param pageName - Name of the page being viewed
 * @param properties - Optional page-specific properties
 */
export function logPageView(pageName: string, properties?: EventProperties): void {
    logEvent('page_view', { ...properties, page_name: pageName });
}

/**
 * Log a click event
 * 
 * @param elementName - Name/identifier of the clicked element
 * @param properties - Optional click-specific properties
 */
export function logClick(elementName: string, properties?: EventProperties): void {
    logEvent('click', { ...properties, element: elementName });
}

/**
 * Log a bet modal open event
 * 
 * @param marketPubkey - Market public key
 * @param outcomeIndex - Selected outcome index
 */
export function logBetModalOpen(marketPubkey: string, outcomeIndex: number): void {
    logEvent('bet_modal_open', { outcome_index: outcomeIndex }, marketPubkey);
}

/**
 * Log a share event
 * 
 * @param marketPubkey - Market public key being shared
 * @param shareMethod - Method used to share (e.g., 'twitter', 'copy_link')
 */
export function logShare(marketPubkey: string, shareMethod: string): void {
    logEvent('share', { share_method: shareMethod }, marketPubkey);
}

/**
 * Log a notification interaction
 * 
 * @param action - Action taken (e.g., 'open', 'dismiss', 'click')
 * @param notificationType - Type of notification
 */
export function logNotification(action: string, notificationType: string): void {
    logEvent('notification', { action, notification_type: notificationType });
}
