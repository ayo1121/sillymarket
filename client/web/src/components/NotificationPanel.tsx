import { useNavigate } from "react-router-dom";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Trophy, Clock, CheckCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Notification Panel Component
 * 
 * Displays list of notifications with:
 * - Icon based on notification type
 * - Mark as read / remove actions
 * - Click to navigate to relevant page
 * - Mark all read / clear all actions
 */
export const NotificationPanel = () => {
    const navigate = useNavigate();
    const { notifications, markAsRead, markAllAsRead, removeNotification, clearAll } =
        useNotificationsContext();

    const getIcon = (type: string) => {
        switch (type) {
            case "claimable_winnings":
                return <Trophy className="w-5 h-5 text-green-600" />;
            case "market_closing":
                return <Clock className="w-5 h-5 text-orange-600" />;
            case "market_resolved":
                return <CheckCircle className="w-5 h-5 text-blue-600" />;
            default:
                return null;
        }
    };

    const handleNotificationClick = (notification: any) => {
        markAsRead(notification.id);
        if (notification.actionUrl) {
            navigate(notification.actionUrl);
        }
    };

    return (
        <div className="max-h-[500px] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#e0e0e0] dark:border-[#333]">
                <h3 className="font-bold text-sm">Notifications</h3>
                {notifications.length > 0 && (
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={markAllAsRead}
                            className="text-xs h-7 px-2"
                        >
                            Mark all read
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearAll}
                            className="text-xs h-7 px-2"
                        >
                            Clear all
                        </Button>
                    </div>
                )}
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto flex-1">
                {notifications.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No notifications yet
                    </div>
                ) : (
                    <div className="divide-y divide-[#e0e0e0] dark:divide-[#333]">
                        {notifications.map((notification) => (
                            <div
                                key={notification.id}
                                className={cn(
                                    "p-4 hover:bg-[#f5f5f5] dark:hover:bg-[#252525] cursor-pointer transition-colors relative group",
                                    !notification.read && "bg-blue-50 dark:bg-blue-950/20"
                                )}
                                onClick={() => handleNotificationClick(notification)}
                            >
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeNotification(notification.id);
                                    }}
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a] rounded"
                                    aria-label="Remove notification"
                                >
                                    <X className="w-3 h-3" />
                                </button>

                                <div className="flex gap-3">
                                    <div className="flex-shrink-0 mt-0.5">{getIcon(notification.type)}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-sm mb-1">{notification.title}</div>
                                        <div className="text-xs text-muted-foreground mb-2">
                                            {notification.message}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">
                                            {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
