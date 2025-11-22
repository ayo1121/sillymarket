/**
 * Test database setup and teardown utilities
 */

import { Pool } from 'pg';

let testPool: Pool | null = null;

export async function setupTestDatabase() {
    // Create a test database connection
    const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

    if (!DATABASE_URL) {
        console.warn('No TEST_DATABASE_URL set, skipping database setup');
        return;
    }

    testPool = new Pool({
        connectionString: DATABASE_URL,
    });

    // Run migrations or create test tables
    try {
        // Create test tables (same as production schema)
        await testPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pubkey text NOT NULL UNIQUE,
        username text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

        await testPool.query(`
      CREATE TABLE IF NOT EXISTS siws_nonces (
        nonce text PRIMARY KEY,
        pubkey text NOT NULL,
        message text NOT NULL,
        issued_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
    `);

        await testPool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        market_id text NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_text text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

        console.log('Test database setup complete');
    } catch (error) {
        console.error('Error setting up test database:', error);
        throw error;
    }
}

export async function cleanupTestDatabase() {
    if (!testPool) {
        return;
    }

    try {
        // Clean up test data
        await testPool.query('TRUNCATE TABLE comments CASCADE');
        await testPool.query('TRUNCATE TABLE siws_nonces CASCADE');
        await testPool.query('TRUNCATE TABLE users CASCADE');

        // Close connection
        await testPool.end();
        testPool = null;

        console.log('Test database cleanup complete');
    } catch (error) {
        console.error('Error cleaning up test database:', error);
    }
}

export function getTestPool(): Pool | null {
    return testPool;
}
