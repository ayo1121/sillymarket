
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load env vars manually since we're running with ts-node
// Assuming we run from client/web root
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    console.log(`Loading env from ${envPath}`);
    dotenv.config({ path: envPath });
} else {
    console.log('No .env.local found, trying .env');
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

console.log('Config:', {
    url: SUPABASE_URL,
    keyLength: SUPABASE_KEY ? SUPABASE_KEY.length : 0,
    keyStart: SUPABASE_KEY ? SUPABASE_KEY.substring(0, 10) + '...' : 'MISSING'
});

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('your-project')) {
    console.error('❌ Invalid configuration');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testWrite() {
    console.log('Attempting to write to bets table...');

    const testBet = {
        market_pubkey: 'TestMarketPubkey11111111111111111111111111',
        bettor_pubkey: 'TestBettorPubkey11111111111111111111111111',
        outcome_index: 0,
        amount_lamports: 1000,
        amount_sol: 0.000001,
        tx_sig: `test-sig-${Date.now()}`,
        block_time: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('bets')
        .insert(testBet)
        .select();

    if (error) {
        console.error('❌ Write failed:', error);
    } else {
        console.log('✅ Write successful!', data);

        // Clean up
        console.log('Cleaning up bets...');
        await supabase.from('bets').delete().eq('tx_sig', testBet.tx_sig);
    }

    // Test Market Resolution
    console.log('Attempting to write to market_resolutions table...');
    const testRes = {
        market_pubkey: 'TestMarketPubkey11111111111111111111111111',
        winner_index: 0,
        auto_void: false,
        tx_sig: `test-res-sig-${Date.now()}`,
        block_time: new Date().toISOString()
    };
    const { error: resError } = await supabase.from('market_resolutions').insert(testRes);
    if (resError) console.error('❌ Resolution write failed:', resError);
    else {
        console.log('✅ Resolution write successful!');
        await supabase.from('market_resolutions').delete().eq('tx_sig', testRes.tx_sig);
    }

    // Test Claims
    console.log('Attempting to write to claims table...');
    const testClaim = {
        market_pubkey: 'TestMarketPubkey11111111111111111111111111',
        user_pubkey: 'TestBettorPubkey11111111111111111111111111',
        amount_lamports: 1000,
        tx_sig: `test-claim-sig-${Date.now()}`,
        block_time: new Date().toISOString()
    };
    const { error: claimError } = await supabase.from('claims').insert(testClaim);
    if (claimError) console.error('❌ Claim write failed:', claimError);
    else {
        console.log('✅ Claim write successful!');
        await supabase.from('claims').delete().eq('tx_sig', testClaim.tx_sig);
    }

    // Test Markets
    console.log('Attempting to write to markets table...');
    const testMarket = {
        market_pubkey: 'TestMarketPubkey11111111111111111111111111',
        question: 'Test Question?',
        answers: 'Yes/No',
        outcome_labels: { '0': 'Yes', '1': 'No' },
        creator_wallet: 'TestCreatorWallet11111111111111111111111111',
        creator_name: 'Test Creator'
    };
    // Note: markets table has unique constraint on market_pubkey, so we might need to delete first if it exists from previous run
    await supabase.from('markets').delete().eq('market_pubkey', testMarket.market_pubkey);

    const { error: marketError } = await supabase.from('markets').insert(testMarket);
    if (marketError) console.error('❌ Market write failed:', marketError);
    else {
        console.log('✅ Market write successful!');
        await supabase.from('markets').delete().eq('market_pubkey', testMarket.market_pubkey);
    }

    // Test Notifications
    console.log('Attempting to write to notifications table...');
    const testNotif = {
        user_pubkey: 'TestBettorPubkey11111111111111111111111111',
        type: 'test_notification',
        title: 'Test Notification',
        body: 'This is a test',
        metadata: { test: true },
        is_read: false
    };
    const { error: notifError } = await supabase.from('notifications').insert(testNotif);
    if (notifError) console.error('❌ Notification write failed:', notifError);
    else {
        console.log('✅ Notification write successful!');
        // Cleanup might be harder if no unique ID, but we can delete by user_pubkey + type for test
        await supabase.from('notifications').delete().match({
            user_pubkey: testNotif.user_pubkey,
            type: testNotif.type
        });
    }
}

testWrite();

