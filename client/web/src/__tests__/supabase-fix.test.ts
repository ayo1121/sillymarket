import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertUser, createNotification } from '../integrations/supabase/writes';
import { supabase } from '../integrations/supabase/client';

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
}));

describe('Supabase Security Fixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('upsertUser should skip operation if no session exists (preventing 401)', async () => {
        // Mock no session
        (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        await upsertUser('test-pubkey');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping user upsert'));
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('createNotification should skip operation if no session exists (preventing 401)', async () => {
        // Mock no session
        (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        await createNotification({
            userPubkey: 'test-pubkey',
            type: 'test',
            title: 'test',
        });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping notification creation'));
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('upsertUser should proceed if session exists', async () => {
        // Mock session exists
        (supabase.auth.getSession as any).mockResolvedValue({ data: { session: { user: { id: 'test' } } } });

        await upsertUser('test-pubkey');

        expect(supabase.from).toHaveBeenCalledWith('users');
    });
});
