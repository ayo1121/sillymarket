import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertUser, createNotification } from '../integrations/supabase/writes';
import { supabase } from '../integrations/supabase/client';
import * as clientModule from '../integrations/supabase/client';

// Mock Supabase client
vi.mock('../integrations/supabase/client', () => ({
    supabase: {
        auth: {
            getSession: vi.fn(),
        },
        from: vi.fn(() => ({
            upsert: vi.fn(() => Promise.resolve({ error: null })),
            insert: vi.fn(() => Promise.resolve({ error: null })),
        })),
    },
    isSupabaseConfigured: vi.fn(),
}));

describe('Supabase Security Fixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('upsertUser should skip operation when Supabase is not configured', async () => {
        // Mock not configured
        (clientModule.isSupabaseConfigured as any).mockReturnValue(false);
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        await upsertUser('test-pubkey');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Supabase not configured'));
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('createNotification should skip operation when Supabase is not configured', async () => {
        // Mock not configured
        (clientModule.isSupabaseConfigured as any).mockReturnValue(false);
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        await createNotification({
            userPubkey: 'test-pubkey',
            type: 'test',
            title: 'test',
        });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Supabase not configured'));
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('upsertUser should proceed if Supabase is configured', async () => {
        // Mock configured
        (clientModule.isSupabaseConfigured as any).mockReturnValue(true);
        (supabase.auth.getSession as any).mockResolvedValue({ data: { session: { user: { id: 'test' } } } });

        await upsertUser('test-pubkey');

        expect(supabase.from).toHaveBeenCalledWith('users');
    });
});
