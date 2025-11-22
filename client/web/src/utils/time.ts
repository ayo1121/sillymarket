/**
 * Time formatting utilities
 */

/**
 * Format time remaining until a date
 * @param closesAt - Date when the market closes
 * @returns Formatted string like "in 12m", "in 3h 12m", "in 1d 3h", or "Closed"
 */
export function formatTimeRemaining(closesAt: Date): string {
  const now = new Date();
  const diffMs = closesAt.getTime() - now.getTime();

  // Already closed
  if (diffMs <= 0) {
    return "Closed";
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Less than 1 hour: show minutes and seconds
  if (diffHours < 1) {
    const seconds = diffSeconds % 60;
    if (diffMinutes === 0) {
      return `in ${seconds}s`;
    }
    if (seconds > 0) {
      return `in ${diffMinutes}m ${seconds}s`;
    }
    return `in ${diffMinutes}m`;
  }

  // Less than 24 hours: show hours and minutes
  if (diffDays < 1) {
    const minutes = diffMinutes % 60;
    if (minutes > 0) {
      return `in ${diffHours}h ${minutes}m`;
    }
    return `in ${diffHours}h`;
  }

  // 1 day or more: show days and hours
  const hours = diffHours % 24;
  if (hours > 0) {
    return `in ${diffDays}d ${hours}h`;
  }
  return `in ${diffDays}d`;
}

/**
 * Format time ago from a date
 * @param date - Date in the past
 * @returns Formatted string like "2 mins ago", "3h ago", "2d ago", or "just now"
 */
export function formatTimeAgo(date: Date | null): string {
  if (!date) {
    return "just now";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    return "just now";
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? "min" : "mins"} ago`;
  }

  if (diffHours < 24) {
    return `${diffHours}${diffHours === 1 ? "h" : "h"} ago`;
  }

  if (diffDays < 7) {
    return `${diffDays}${diffDays === 1 ? "d" : "d"} ago`;
  }

  // For older dates, show formatted date
  return date.toLocaleDateString();
}


