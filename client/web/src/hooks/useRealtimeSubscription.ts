import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function useRealtimeBets(
    marketPubkey: string,
    onNewBet: (bet: any) => void,
) {
    useEffect(() => {
        if (!marketPubkey) return;

        const channel: RealtimeChannel = supabase
            .channel(`bets:${marketPubkey}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "bets",
                    filter: `market_pubkey=eq.${marketPubkey}`,
                },
                (payload) => {
                    console.log("[Realtime] New bet:", payload.new);
                    onNewBet(payload.new);
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [marketPubkey, onNewBet]);
}

export function useRealtimeNotifications(
    userPubkey: string | null | undefined,
    onNewNotification: (notif: any) => void,
) {
    useEffect(() => {
        if (!userPubkey) return;

        const channel: RealtimeChannel = supabase
            .channel(`notifications:${userPubkey}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "notifications",
                    filter: `user_pubkey=eq.${userPubkey}`,
                },
                (payload) => {
                    console.log("[Realtime] New notification:", payload.new);
                    onNewNotification(payload.new);
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userPubkey, onNewNotification]);
}
