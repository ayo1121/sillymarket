import { openDB, DBSchema, IDBPDatabase } from 'idb';

/**
 * Transaction Queue for Offline Support
 * 
 * Stores pending transactions in IndexedDB and retries when online.
 * 
 * Features:
 * - Persistent storage across sessions
 * - Status tracking (pending → retrying → confirmed/failed)
 * - Automatic retry on network restoration
 * - Real-time updates via listeners
 * 
 * TODO: Background Sync API Integration
 * 
 * When supported, use Background Sync API for automatic retries:
 * 
 * ```typescript
 * // Register background sync
 * if ('serviceWorker' in navigator && 'sync' in registration) {
 *   const registration = await navigator.serviceWorker.ready;
 *   await registration.sync.register('sync-transactions');
 * }
 * 
 * // In service worker (sw.js):
 * self.addEventListener('sync', (event) => {
 *   if (event.tag === 'sync-transactions') {
 *     event.waitUntil(retryPendingTransactions());
 *   }
 * });
 * ```
 * 
 * Browser support: https://caniuse.com/background-sync
 * Currently supported: Chrome, Edge, Opera
 * Not supported: Firefox, Safari (use polling fallback)
 */

export interface QueuedTransaction {
    id: string;
    type: 'place_bet' | 'resolve_market' | 'claim_winnings' | 'create_market';
    params: any;
    status: 'pending' | 'retrying' | 'confirmed' | 'failed';
    createdAt: number;
    lastAttempt?: number;
    attempts: number;
    error?: string;
    txSignature?: string;
}

interface TransactionQueueDB extends DBSchema {
    transactions: {
        key: string;
        value: QueuedTransaction;
        indexes: { 'by-status': string };
    };
}

class TransactionQueue {
    private db: IDBPDatabase<TransactionQueueDB> | null = null;
    private listeners: Set<() => void> = new Set();

    async init() {
        if (this.db) return;

        this.db = await openDB<TransactionQueueDB>('transaction-queue', 1, {
            upgrade(db) {
                const store = db.createObjectStore('transactions', { keyPath: 'id' });
                store.createIndex('by-status', 'status');
            },
        });
    }

    /**
     * Add transaction to queue
     */
    async enqueue(
        type: QueuedTransaction['type'],
        params: any
    ): Promise<string> {
        if (!this.db) await this.init();

        const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const transaction: QueuedTransaction = {
            id,
            type,
            params,
            status: 'pending',
            createdAt: Date.now(),
            attempts: 0,
        };

        await this.db!.put('transactions', transaction);
        this.notifyListeners();

        console.log('[TransactionQueue] Enqueued:', id, type);
        return id;
    }

    /**
     * Get all pending transactions
     */
    async getPending(): Promise<QueuedTransaction[]> {
        if (!this.db) await this.init();
        return this.db!.getAllFromIndex('transactions', 'by-status', 'pending');
    }

    /**
     * Get all transactions
     */
    async getAll(): Promise<QueuedTransaction[]> {
        if (!this.db) await this.init();
        return this.db!.getAll('transactions');
    }

    /**
     * Get transaction by ID
     */
    async get(id: string): Promise<QueuedTransaction | undefined> {
        if (!this.db) await this.init();
        return this.db!.get('transactions', id);
    }

    /**
     * Update transaction status
     */
    async updateStatus(
        id: string,
        status: QueuedTransaction['status'],
        updates?: Partial<QueuedTransaction>
    ) {
        if (!this.db) await this.init();

        const tx = await this.db!.get('transactions', id);
        if (!tx) {
            console.warn('[TransactionQueue] Transaction not found:', id);
            return;
        }

        const updated = {
            ...tx,
            status,
            ...updates,
            lastAttempt: Date.now(),
            attempts: tx.attempts + 1,
        };

        await this.db!.put('transactions', updated);
        this.notifyListeners();

        console.log('[TransactionQueue] Updated:', id, status);
    }

    /**
     * Mark transaction as confirmed
     */
    async confirm(id: string, txSignature: string) {
        await this.updateStatus(id, 'confirmed', { txSignature });
    }

    /**
     * Mark transaction as failed
     */
    async fail(id: string, error: string) {
        await this.updateStatus(id, 'failed', { error });
    }

    /**
     * Remove transaction from queue
     */
    async remove(id: string) {
        if (!this.db) await this.init();
        await this.db!.delete('transactions', id);
        this.notifyListeners();

        console.log('[TransactionQueue] Removed:', id);
    }

    /**
     * Clear all confirmed transactions
     */
    async clearConfirmed() {
        if (!this.db) await this.init();
        const all = await this.getAll();
        const confirmed = all.filter(tx => tx.status === 'confirmed');

        for (const tx of confirmed) {
            await this.remove(tx.id);
        }
    }

    /**
   * Subscribe to queue changes
   */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener());
    }
}

export const transactionQueue = new TransactionQueue();
