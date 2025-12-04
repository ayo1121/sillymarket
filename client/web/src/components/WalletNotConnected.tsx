import React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

interface WalletNotConnectedProps {
    title: string;
    message: string;
}

export const WalletNotConnected = ({ title, message }: WalletNotConnectedProps) => {
    const { connect, wallet } = useWallet();
    const { setVisible } = useWalletModal();

    const handleConnect = () => {
        if (wallet) {
            connect().catch(() => setVisible(true));
        } else {
            setVisible(true);
        }
    };

    return (
        <div className="bg-[#f5f5f5] dark:bg-[#1a1a1a] border border-[#d3d3d3] dark:border-[#333] rounded shadow-sm p-12 text-center flex flex-col items-center justify-center gap-4">
            <div className="bg-gray-200 dark:bg-gray-800 p-4 rounded-full">
                <Wallet className="w-8 h-8 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="space-y-2">
                <h3 className="text-xl font-bold text-[#111] dark:text-white">{title}</h3>
                <p className="text-muted-foreground dark:text-gray-400 max-w-xs mx-auto">
                    {message}
                </p>
            </div>
            <Button onClick={handleConnect} className="font-semibold mt-2">
                Connect Wallet
            </Button>
        </div>
    );
};
