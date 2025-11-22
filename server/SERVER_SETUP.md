# Server Setup Guide

## Required Configuration

The server needs a **Supabase PostgreSQL connection string** to start.

## Quick Setup

### Option 1: Use the helper script
```bash
cd ~/yesno-anchor/yesno_markets/server
./setup-env.sh
```

### Option 2: Manual setup

1. **Get your Supabase connection string:**
   - Go to: https://supabase.com/dashboard/project/rbcbyhjfjkbebjyipjqd/settings/database
   - Scroll to "Connection string" section
   - Click on "URI" tab
   - Copy the connection string (looks like: `postgresql://postgres:[PASSWORD]@db.rbcbyhjfjkbebjyipjqd.supabase.co:5432/postgres`)

2. **Update `server/.env` file:**
   ```bash
   cd ~/yesno-anchor/yesno_markets/server
   nano .env  # or use your preferred editor
   ```

3. **Set these values:**
   ```env
   APP_ORIGIN=http://localhost:8080
   PORT=8787
   DATABASE_URL=postgresql://postgres:[YOUR_PASSWORD]@db.rbcbyhjfjkbebjyipjqd.supabase.co:5432/postgres
   SESSION_SECRET=your-random-secret-here
   ```

   **Note:** Replace `[YOUR_PASSWORD]` with your actual Supabase database password.

4. **Generate a SESSION_SECRET** (optional but recommended):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the output and use it as `SESSION_SECRET`.

## Start the Server

Once `.env` is configured:

```bash
cd ~/yesno-anchor/yesno_markets/server
npm run dev
```

You should see:
```
API on http://localhost:8787  (CORS: http://localhost:8080)
Database: connected
```

## Troubleshooting

### "Cannot connect to PostgreSQL" error
- Verify your `DATABASE_URL` is correct
- Check that your Supabase project is active
- Ensure the password in the connection string is correct (it's URL-encoded)

### "Migration failed" error
- The server will create tables automatically on first run
- If it fails, check the database connection string format

### Port 8787 already in use
- Change `PORT=8787` to a different port in `.env`
- Update `VITE_API_URL` in `client/web/.env.local` to match

## Dev setup summary

- **Frontend**: `http://localhost:8080` (Vite dev server)
- **Backend**: `http://localhost:8787` (Express API)
- **CORS**: `APP_ORIGIN` in `server/.env` must match the frontend origin (`http://localhost:8080`)
- **Frontend API URL**: `VITE_API_URL` in `client/web/.env.local` must be `http://localhost:8787`

