import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import { NotificationPanel } from "./NotificationPanel";
import { cn } from "@/lib/utils";

/**
 * Notification Bell Component
 * 
 * Displays notification icon with unread count badge.
 * Opens NotificationPanel popover on click.
 */
export const NotificationBell = () => {
    const { unreadCount } = useNotificationsContext();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    className={cn(
                        "relative min-h-[44px] px-3 sm:px-4 font-bold text-xs sm:text-sm border-2 transition-all win95-btn-press",
                        "bg-[#e0e0e0] dark:bg-[#2a2a2a] text-[#111] dark:text-white border-white/60 hover:bg-white dark:hover:bg-[#3a3a3a] hover:border-white"
                    )}
                    aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
                >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-80 sm:w-96 p-0 bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a]"
                align="end"
            >
                <NotificationPanel />
            </PopoverContent>
        </Popover>
    );
};
