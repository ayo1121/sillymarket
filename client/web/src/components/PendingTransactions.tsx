import { useTransactionQueue } from '@/hooks/useTransactionQueue';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Pending Transactions Indicator
 * 
 * Shows count of pending/retrying transactions.
 * Displays as floating badge in bottom-left corner.
 * 
 * Status indicators:
 * - Pending: Orange badge with count
 * - Retrying: Blue badge with spinner
 * - Confirmed: Green checkmark (auto-hides after 3s)
 * - Failed: Red X
 */
export const PendingTransactions = () => {
    const { pendingCount, retryingCount, hasPending } = useTransactionQueue();

    if (!hasPending) return null;

    return (
        <div className="fixed bottom-24 left-4 z-40">
            <div className="bg-orange-600 text-white px-3 py-2 rounded-full shadow-lg flex items-center gap-2 text-xs font-bold">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>
                    {retryingCount > 0
                        ? `Retrying ${retryingCount} transaction${retryingCount > 1 ? 's' : ''}...`
                        : `${pendingCount} pending`}
                </span>
            </div>
        </div>
    );
};

/**
 * Transaction Status Badge
 * 
 * Shows status icon for individual transaction.
 * Used in transaction lists and modals.
 */
export const TransactionStatusBadge = ({ status }: { status: string }) => {
    const config = {
        pending: {
            icon: <Clock className="w-4 h-4" />,
            label: 'Pending',
            className: 'text-orange-600',
        },
        retrying: {
            icon: <Loader2 className="w-4 h-4 animate-spin" />,
            label: 'Retrying',
            className: 'text-blue-600',
        },
        confirmed: {
            icon: <CheckCircle className="w-4 h-4" />,
            label: 'Confirmed',
            className: 'text-green-600',
        },
        failed: {
            icon: <XCircle className="w-4 h-4" />,
            label: 'Failed',
            className: 'text-red-600',
        },
    };

    const { icon, label, className } = config[status as keyof typeof config] || config.pending;

    return (
        <div className={cn('flex items-center gap-1 text-xs font-semibold', className)}>
            {icon}
            <span>{label}</span>
        </div>
    );
};
