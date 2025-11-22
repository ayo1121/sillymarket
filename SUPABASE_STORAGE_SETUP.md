# Supabase Storage Setup Guide

This project uses **Supabase Storage** for market image uploads. Supabase is **NOT** used for authentication (we use wallet-based SIWS instead).

## Project Configuration

- **Supabase Project ID**: `ibuzpjefotihoagusrqz`
- **Project URL**: `https://ibuzpjefotihoagusrqz.supabase.co`
- **Storage Bucket**: `market-images`

## Setup Steps

### 1. Get Your Supabase Anon Key

1. Go to the Supabase dashboard: https://supabase.com/dashboard/project/ibuzpjefotihoagusrqz
2. Navigate to **Settings** → **API**
3. Find the **"anon" public** key in the "Project API keys" section
4. Copy the key (it starts with `eyJ...`)

### 2. Configure Frontend Environment

Edit `client/web/.env.local` and set:

```env
VITE_SUPABASE_URL=https://ibuzpjefotihoagusrqz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
```

Replace `your_anon_key_here` with the anon key you copied from the dashboard.

**Note**: The `.env.local` file is gitignored and should contain your real keys. The `.env` file is a template with placeholders.

### 3. Create Storage Bucket

1. In the Supabase dashboard, go to **Storage**
2. Click **"New bucket"**
3. Name it: `market-images`
4. Set it to **Public bucket** (or configure a policy that allows public read access)
5. Click **"Create bucket"**

### 4. Configure Bucket Policies (if not public)

If you didn't make the bucket public, you need to add policies:

1. Go to **Storage** → **Policies** → `market-images`
2. Add a policy for **SELECT** (read) that allows public access:
   - Policy name: `Public read access`
   - Allowed operation: `SELECT`
   - Target roles: `anon`, `authenticated`
   - Policy definition: `true` (allows all reads)

3. Add a policy for **INSERT** (upload) that allows authenticated users:
   - Policy name: `Authenticated uploads`
   - Allowed operation: `INSERT`
   - Target roles: `authenticated`
   - Policy definition: `true` (allows all uploads)

**Note**: Since we're using anon key, you may need to make the bucket public or adjust policies to allow anon uploads.

### 5. Restart Vite Dev Server

After updating `.env.local`, restart your Vite dev server:

```bash
cd client/web
# Stop the current server (Ctrl+C)
npm run dev
```

The new environment variables will be picked up on restart.

## Verification

1. Start the frontend: `cd client/web && npm run dev`
2. Navigate to the "Create Market" page
3. Try uploading an image
4. Check the browser console for any errors
5. If successful, the image URL should be a Supabase Storage URL like:
   `https://ibuzpjefotihoagusrqz.supabase.co/storage/v1/object/public/market-images/mkt/...`

## Troubleshooting

### "Supabase env vars not configured" error
- Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set in `.env.local`
- Make sure you restarted the Vite dev server after updating `.env.local`
- Verify the anon key is correct (not the service_role key)

### "Failed to upload image" error
- Check that the `market-images` bucket exists in your Supabase project
- Verify bucket policies allow uploads (or make the bucket public)
- Check browser console for detailed error messages
- Ensure the anon key has the correct permissions

### Image uploads but URL is not accessible
- Verify the bucket has public read access
- Check bucket policies allow SELECT operations for anon users
- Test the URL directly in a browser

## Important Notes

- **Never commit `.env.local`** - it contains your real Supabase keys
- The `.env` file is a template with placeholders and is safe to commit
- Supabase is **only** used for Storage (image uploads)
- Authentication is handled via wallet-based SIWS, not Supabase Auth
- The database connection in `server/.env` uses the same Supabase project but for PostgreSQL, not Storage

