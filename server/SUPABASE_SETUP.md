# Supabase Database Integration

## Quick Setup

Your Supabase project is already configured in the frontend. To connect the backend server:

### Step 1: Get Your Supabase Database Connection String

1. Go to: https://supabase.com/dashboard/project/rbcbyhjfjkbebjyipjqd/settings/database
2. Scroll to **"Connection string"** section
3. Select the **"URI"** tab
4. Copy the connection string

**For the server, use the direct connection (not the pooler):**
```
postgresql://postgres:[YOUR-PASSWORD]@db.rbcbyhjfjkbebjyipjqd.supabase.co:5432/postgres
```

Replace `[YOUR-PASSWORD]` with your actual database password.

### Step 2: Update Server .env

Edit `server/.env` and update the `DATABASE_URL`:

```bash
cd ~/yesno-anchor/yesno_markets/server
nano .env  # or use your preferred editor
```

Change this line:
```
DATABASE_URL=postgres://user:pass@localhost:5432/yesno
```

To your Supabase connection string:
```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.rbcbyhjfjkbebjyipjqd.supabase.co:5432/postgres
```

### Step 3: Start the Server

```bash
npm run dev
```

The server will:
- Connect to your Supabase PostgreSQL database
- Create the `users` and `siws_nonces` tables automatically
- Start accepting requests on port 8787

## Alternative: Use the Helper Script

```bash
cd ~/yesno-anchor/yesno_markets/server
./update-supabase-env.sh
```

This script will prompt you for the connection string and update `.env` automatically.

## Verification

Once the server starts, you should see:
```
API on http://localhost:8787  (CORS: http://localhost:8080)
Database: connected
```

If you see database connection errors, double-check your connection string and password.

