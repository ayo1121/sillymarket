'use client';

import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  buildUpdateCutoffIx,
  buildEmergencyPauseIx,
  buildUpdateFeeReceiverIx,
  OWNER,
} from '@/lib/program/builders';

type AdminPanelProps = {
  marketPubkey: PublicKey;
  currentCutoff: number;
  isPaused: boolean;
  onSuccess?: () => void;
};

export function AdminPanel({ marketPubkey, currentCutoff, isPaused, onSuccess }: AdminPanelProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [showCutoffForm, setShowCutoffForm] = useState(false);
  const [showFeeReceiverForm, setShowFeeReceiverForm] = useState(false);
  const [newCutoff, setNewCutoff] = useState('');
  const [newFeeReceiver, setNewFeeReceiver] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isOwner = wallet.publicKey?.equals(OWNER);

  if (!isOwner || !wallet.publicKey) {
    return null;
  }

  const handleUpdateCutoff = useCallback(async () => {
    if (!wallet.publicKey || !newCutoff) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const cutoffDate = new Date(newCutoff);
      const cutoffTs = Math.floor(cutoffDate.getTime() / 1000);
      
      const ixs = await buildUpdateCutoffIx(connection, {
        owner: wallet.publicKey,
        market: marketPubkey,
        newCutoffTs: cutoffTs,
      });
      
      const tx = new Transaction().add(...ixs);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;
      
      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      
      setSuccess(`Cutoff updated successfully! TX: ${signature.slice(0, 8)}...`);
      setShowCutoffForm(false);
      setNewCutoff('');
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Failed to update cutoff');
    } finally {
      setLoading(false);
    }
  }, [wallet, connection, marketPubkey, newCutoff, onSuccess]);

  const handleTogglePause = useCallback(async () => {
    if (!wallet.publicKey) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const ixs = await buildEmergencyPauseIx(connection, {
        owner: wallet.publicKey,
        market: marketPubkey,
        pause: !isPaused,
      });
      
      const tx = new Transaction().add(...ixs);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;
      
      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      
      setSuccess(`Market ${!isPaused ? 'paused' : 'unpaused'} successfully! TX: ${signature.slice(0, 8)}...`);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Failed to toggle pause');
    } finally {
      setLoading(false);
    }
  }, [wallet, connection, marketPubkey, isPaused, onSuccess]);

  const handleUpdateFeeReceiver = useCallback(async () => {
    if (!wallet.publicKey || !newFeeReceiver) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const receiverPubkey = new PublicKey(newFeeReceiver);
      
      const ixs = await buildUpdateFeeReceiverIx(connection, {
        owner: wallet.publicKey,
        market: marketPubkey,
        newReceiver: receiverPubkey,
      });
      
      const tx = new Transaction().add(...ixs);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;
      
      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      
      setSuccess(`Fee receiver updated successfully! TX: ${signature.slice(0, 8)}...`);
      setShowFeeReceiverForm(false);
      setNewFeeReceiver('');
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Failed to update fee receiver');
    } finally {
      setLoading(false);
    }
  }, [wallet, connection, marketPubkey, newFeeReceiver, onSuccess]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="frame" style={{ marginTop: '1rem', padding: '1rem' }}>
      <div className="titlebar">
        <span>🔧 Admin Controls (Owner Only)</span>
      </div>
      
      <div style={{ padding: '1rem' }}>
        {error && (
          <div style={{ 
            backgroundColor: '#ff6b6b', 
            color: 'white', 
            padding: '0.5rem', 
            marginBottom: '0.5rem',
            border: '2px solid #c92a2a'
          }}>
            ❌ {error}
          </div>
        )}
        
        {success && (
          <div style={{ 
            backgroundColor: '#51cf66', 
            color: 'white', 
            padding: '0.5rem', 
            marginBottom: '0.5rem',
            border: '2px solid #2b8a3e'
          }}>
            ✅ {success}
          </div>
        )}
        
        <div style={{ marginBottom: '1rem' }}>
          <strong>Current Status:</strong>
          <div style={{ marginTop: '0.5rem' }}>
            <div>Cutoff: {formatDate(currentCutoff)}</div>
            <div>Market Status: {isPaused ? '⏸️ PAUSED' : '✅ Active'}</div>
          </div>
        </div>

        <div className="btn-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            className="btn95"
            onClick={() => setShowCutoffForm(!showCutoffForm)}
            disabled={loading}
          >
            {showCutoffForm ? '❌ Cancel' : '📅 Update Cutoff'}
          </button>

          {showCutoffForm && (
            <div style={{ padding: '0.5rem', border: '2px solid #000' }}>
              <label>
                New Cutoff Date/Time:
                <input
                  type="datetime-local"
                  value={newCutoff}
                  onChange={(e) => setNewCutoff(e.target.value)}
                  style={{ 
                    width: '100%', 
                    marginTop: '0.5rem',
                    padding: '0.25rem',
                    border: '2px solid #000'
                  }}
                />
              </label>
              <button
                className="btn95"
                onClick={handleUpdateCutoff}
                disabled={loading || !newCutoff}
                style={{ marginTop: '0.5rem', width: '100%' }}
              >
                {loading ? 'Updating...' : 'Confirm Update'}
              </button>
            </div>
          )}

          <button
            className="btn95"
            onClick={handleTogglePause}
            disabled={loading}
            style={{ 
              backgroundColor: isPaused ? '#51cf66' : '#ff6b6b',
              color: 'white'
            }}
          >
            {loading ? 'Processing...' : isPaused ? '▶️ Unpause Market' : '⏸️ Pause Market'}
          </button>

          <button
            className="btn95"
            onClick={() => setShowFeeReceiverForm(!showFeeReceiverForm)}
            disabled={loading}
          >
            {showFeeReceiverForm ? '❌ Cancel' : '💰 Update Fee Receiver'}
          </button>

          {showFeeReceiverForm && (
            <div style={{ padding: '0.5rem', border: '2px solid #000' }}>
              <label>
                New Fee Receiver Address:
                <input
                  type="text"
                  value={newFeeReceiver}
                  onChange={(e) => setNewFeeReceiver(e.target.value)}
                  placeholder="Enter Solana address"
                  style={{ 
                    width: '100%', 
                    marginTop: '0.5rem',
                    padding: '0.25rem',
                    border: '2px solid #000'
                  }}
                />
              </label>
              <button
                className="btn95"
                onClick={handleUpdateFeeReceiver}
                disabled={loading || !newFeeReceiver}
                style={{ marginTop: '0.5rem', width: '100%' }}
              >
                {loading ? 'Updating...' : 'Confirm Update'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
