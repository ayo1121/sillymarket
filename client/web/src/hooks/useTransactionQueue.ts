import { useState, useEffect } from 'react';
import { transactionQueue, QueuedTransaction } from '@/lib/transactionQueue';

/**
 * Hook to access transaction queue
 * 
 * Provides real-time updates of queued transactions.
 * Automatically subscribes to queue changes.
 * 
 * Usage:
 * ```tsx
 * const { transactions, pendingCount, hasPending } = useTransactionQueue();
 * ```
 */
export const useTransactionQueue = () => {
    const [transactions, setTransactions] = useState<QueuedTransaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadTransactions = async () => {
            const txs = await transactionQueue.getAll();
            setTransactions(txs);
            setLoading(false);
        };

        loadTransactions();

        // Subscribe to changes
        return transactionQueue.subscribe(() => {
            loadTransactions();
        });
    }, []);

    const pendingCount = transactions.filter(tx => tx.status === 'pending').length;
    const retryingCount = transactions.filter(tx => tx.status === 'retrying').length;
    const confirmedCount = transactions.filter(tx => tx.status === 'confirmed').length;
    const failedCount = transactions.filter(tx => tx.status === 'failed').length;

    return {
        transactions,
        loading,
        pendingCount,
        retryingCount,
        confirmedCount,
        failedCount,
        hasPending: pendingCount > 0 || retryingCount > 0,
    };
};
