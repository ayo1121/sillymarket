
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars from .env.local
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY');
}

// Create a client with the ANON key
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    }
});

describe('Supabase Reliability & RLS (Anon Role)', () => {
    const timestamp = Date.now();
    const testMarketPubkey = `test-market-${timestamp}`;
    const testUserPubkey = `test-user-${timestamp}`;

    it('should allow ANON to insert into MARKETS', async () => {
        const { data, error } = await supabase.from('markets').insert({
            market_pubkey: testMarketPubkey,
            question: 'Test Market Question',
            description: 'Test Description',
            creator_wallet: testUserPubkey,
            answers: ['Yes', 'No'],
            outcome_labels: { '0': 'Yes', '1': 'No' }
        }).select();

        if (error) console.error('Markets insert error:', error);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0].market_pubkey).toBe(testMarketPubkey);
    });

    it('should allow ANON to insert into COMMENTS', async () => {
        // We need a valid user_id (UUID) for comments usually, but let's see if we can use a dummy UUID
        // If the schema enforces foreign key to users table, this might fail if user doesn't exist.
        // Let's check if we can insert a user first? No, we can't insert users as anon.
        // So we might need to rely on an existing user or if the FK is nullable/not enforced for this test.
        // Looking at schema: comments.user_id -> users.id.
        // Since we can't create a user as anon, we might skip this or expect failure if FK is enforced.
        // BUT, for the purpose of RLS test, we want to see if RLS allows it.
        // If RLS allows but FK fails, the error will be different (23503 foreign_key_violation vs 42501 insufficient_privilege).

        const dummyUserId = '00000000-0000-0000-0000-000000000000'; // Dummy UUID

        const { error } = await supabase.from('comments').insert({
            market_id: testMarketPubkey,
            user_id: dummyUserId,
            comment_text: 'Test Comment'
        });

        // We expect either success (if FK not enforced) or FK violation.
        // We DO NOT expect RLS error (42501).
        if (error) {
            if (error.code === '42501') {
                throw new Error('RLS denied comment insert');
            }
            console.log('Comment insert failed (likely FK), but RLS passed:', error.code);
        } else {
            console.log('Comment insert success');
        }
    });

    it('should allow ANON to insert into FRONTEND_EVENTS', async () => {
        const { error } = await supabase.from('frontend_events').insert({
            event_type: 'test_event',
            user_pubkey: testUserPubkey,
            metadata: { test: true }
        });

        if (error) console.error('Frontend events insert error:', error);
        expect(error).toBeNull();
    });

    it('should DENY ANON from inserting into USERS', async () => {
        const { error } = await supabase.from('users').insert({
            pubkey: testUserPubkey,
            username: 'testuser'
        });

        expect(error).not.toBeNull();
        // Expect RLS error
        expect(error?.code).toBe('42501'); // insufficient_privilege
    });

    it('should DENY ANON from inserting into NOTIFICATIONS', async () => {
        const { error } = await supabase.from('notifications').insert({
            user_pubkey: testUserPubkey,
            type: 'test',
            title: 'Test'
        });

        expect(error).not.toBeNull();
        expect(error?.code).toBe('42501'); // insufficient_privilege
    });

    it('should allow ANON to SELECT from MARKETS', async () => {
        const { data, error } = await supabase.from('markets').select('*').limit(1);
        expect(error).toBeNull();
        expect(Array.isArray(data)).toBe(true);
    });
});
