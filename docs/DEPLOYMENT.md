# Deployment Guide - Environment Variables

**Purpose:** Complete guide for configuring environment variables across all deployment platforms.

---

## Overview

The YesNo Markets application uses three deployment platforms:

1. **Vercel** - Frontend (React/Vite app)
2. **Railway** - Backend API (Node.js/Express)
3. **Supabase** - Database & Storage (PostgreSQL + Edge Functions)

---

## Environment Variables Summary

### 🔵 Vercel (Frontend)

**Platform:** Vercel  
**Purpose:** Hosts the React frontend  
**Configuration:** Project Settings > Environment Variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | ✅ | `https://api.sillymarket.fun` | Backend API URL (Railway) |
| `VITE_RPC_URL` | ✅ | `https://mainnet.helius-rpc.com/?api-key=xxx` | Solana mainnet RPC endpoint |
| `VITE_PROGRAM_ID` | ✅ | `YourMainnetProgramId1111111111111111` | Deployed Anchor program ID |
| `VITE_SUPABASE_URL` | ✅ | `https://xxx.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Supabase anon key (safe for frontend) |
| `VITE_COMMITMENT` | ⚪ | `confirmed` | Solana transaction commitment level |
| `VITE_REQUIRE_WALLET` | ⚪ | `1` | Require wallet connection (1=yes, 0=no) |
| `VITE_DEBUG_DOCK` | ⚪ | `0` | Debug UI (0=disabled in production) |

**Security Notes:**
- ✅ **SAFE:** All `VITE_*` variables are exposed to the browser
- ✅ **SAFE:** Supabase publishable key is designed for frontend use
- ❌ **NEVER:** Use Supabase service_role key in frontend
- ❌ **NEVER:** Put secrets, private keys, or credentials in `VITE_*` variables

---

### 🟢 Railway (Backend)

**Platform:** Railway  
**Purpose:** Hosts the Node.js/Express API server  
**Configuration:** Project > Variables tab

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | ✅ | `production` | Environment mode |
| `APP_ORIGIN` | ✅ | `https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app` | Allowed CORS origins (comma-separated) |
| `DATABASE_URL` | ✅ | `postgres://postgres.xxx:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres` | Supabase connection string |
| `SESSION_SECRET` | ✅ | `Kx7j9mP2nQ5vW8zA3bC6dE1fG4hJ0kL9mN2oP5qR8sT1uV4wX7yZ0` | JWT signing secret (min 32 chars) |
| `PORT` | ⚪ | `8787` | Server port (Railway sets automatically) |

**Security Notes:**
- ✅ **SAFE:** Railway variables are server-side only
- ⚠️ **CRITICAL:** Generate `SESSION_SECRET` with `openssl rand -base64 32`
- ⚠️ **CRITICAL:** Never commit secrets to git
- ⚠️ **CRITICAL:** Use Supabase connection string with pooling enabled

**Generating SESSION_SECRET:**
```bash
# Option 1: OpenSSL
openssl rand -base64 32

# Option 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

### 🟣 Supabase (Database & Storage)

**Platform:** Supabase  
**Purpose:** PostgreSQL database, storage, and Edge Functions  
**Configuration:** Project Settings > API

| Variable | Location | Safe for Frontend? | Description |
|----------|----------|-------------------|-------------|
| `SUPABASE_URL` | Project Settings > API | ✅ Yes | Project URL |
| `SUPABASE_ANON_KEY` | Project Settings > API | ✅ Yes | Publishable key (use in frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API | ❌ **NO** | Admin key (backend/Edge Functions only!) |
| `DATABASE_URL` | Project Settings > Database | ❌ **NO** | Direct connection string (backend only) |

**Security Notes:**
- ✅ **Frontend:** Use `SUPABASE_ANON_KEY` (respects RLS policies)
- ❌ **Backend/Edge Functions:** Use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- ⚠️ **CRITICAL:** Never expose service_role key in frontend code
- ⚠️ **CRITICAL:** Enable RLS on all tables (see migrations)

**Connection Strings:**
- **Direct:** For backend server (Railway)
- **Pooling:** Recommended for serverless/high concurrency
- Get from: Project Settings > Database > Connection String

---

## Deployment Checklist

### Pre-Deployment

- [ ] Generate strong `SESSION_SECRET` (min 32 characters)
- [ ] Deploy Anchor program to mainnet
- [ ] Run Supabase migrations (RLS policies)
- [ ] Configure Supabase storage bucket policies
- [ ] Set up Helius/QuickNode mainnet RPC endpoint
- [ ] Register custom domains (optional)

### Vercel Deployment

1. **Connect Repository**
   - Import project from GitHub
   - Select `client/web` as root directory

2. **Set Environment Variables**
   - Add all `VITE_*` variables from table above
   - Set for "Production" environment
   - Verify `VITE_DEBUG_DOCK=0`

3. **Deploy**
   - Trigger deployment
   - Verify build succeeds
   - Test frontend at Vercel URL

4. **Custom Domain** (Optional)
   - Add domain in Vercel settings
   - Update DNS records
   - Add domain to Railway `APP_ORIGIN`

### Railway Deployment

1. **Create New Project**
   - Connect GitHub repository
   - Select `server` directory as root

2. **Set Environment Variables**
   - Add all variables from table above
   - Generate and set `SESSION_SECRET`
   - Set `NODE_ENV=production`
   - Set `APP_ORIGIN` with Vercel URLs

3. **Deploy**
   - Railway auto-deploys on push
   - Verify logs show "API listening"
   - Test health endpoint: `https://your-app.railway.app/health`

4. **Custom Domain** (Optional)
   - Add custom domain in Railway settings
   - Update Vercel `VITE_API_URL`
   - Update Railway `APP_ORIGIN`

### Supabase Configuration

1. **Run Migrations**
   ```bash
   cd client/web
   npx supabase db push
   ```

2. **Verify RLS Policies**
   - Check Table Editor > each table > RLS enabled
   - Verify policies match migration files

3. **Configure Storage**
   - Enable RLS on `storage.objects`
   - Verify `market-images` bucket policies

4. **Copy API Keys**
   - Copy `SUPABASE_URL` to Vercel
   - Copy `SUPABASE_ANON_KEY` to Vercel
   - Copy `DATABASE_URL` to Railway
   - **Never** expose `SERVICE_ROLE_KEY` in frontend

---

## Post-Deployment Verification

### Frontend (Vercel)
- [ ] App loads without errors
- [ ] Wallet connection works
- [ ] Can view markets
- [ ] RPC endpoint responds
- [ ] Supabase data loads

### Backend (Railway)
- [ ] `/health` endpoint returns 200
- [ ] CORS allows Vercel origin
- [ ] Database connection works
- [ ] SIWS authentication works
- [ ] Rate limiting active

### Database (Supabase)
- [ ] RLS policies enforced
- [ ] Frontend can read markets/bets
- [ ] Frontend cannot write markets/bets
- [ ] Storage policies working
- [ ] Migrations applied

---

## Environment Variable Security

### ✅ Safe for Frontend (VITE_*)
- API URLs
- RPC endpoints
- Program IDs
- Supabase URL and anon key
- Public configuration flags

### ❌ Backend Only (Never in Frontend)
- `SESSION_SECRET`
- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Private keys
- API secrets

### 🔒 Security Best Practices
1. **Never commit** `.env` or `.env.local` files
2. **Rotate secrets** if accidentally exposed
3. **Use strong random** values for `SESSION_SECRET`
4. **Separate** development and production environments
5. **Audit** environment variables regularly

---

## Troubleshooting

### Frontend Issues
- **"Failed to fetch"**: Check `VITE_API_URL` matches Railway URL
- **"Network error"**: Verify RPC endpoint is accessible
- **"Program not found"**: Check `VITE_PROGRAM_ID` is correct
- **Supabase errors**: Verify URL and anon key are correct

### Backend Issues
- **CORS errors**: Add Vercel URL to `APP_ORIGIN`
- **Database errors**: Check `DATABASE_URL` connection string
- **Auth errors**: Verify `SESSION_SECRET` is set
- **Rate limit not working**: Check rate limiter configuration

### Supabase Issues
- **RLS errors**: Verify policies are applied
- **Connection errors**: Check database is online
- **Storage errors**: Verify bucket policies

---

## Quick Reference

### Get Supabase Connection String
1. Supabase Dashboard
2. Project Settings > Database
3. Connection String > Direct (for Railway)
4. Copy and set as `DATABASE_URL`

### Get Supabase API Keys
1. Supabase Dashboard
2. Project Settings > API
3. Copy `URL` → `VITE_SUPABASE_URL`
4. Copy `anon public` → `VITE_SUPABASE_PUBLISHABLE_KEY`

### Generate SESSION_SECRET
```bash
openssl rand -base64 32
```

### Test Deployment
```bash
# Frontend
curl https://sillymarket.fun

# Backend health
curl https://api.sillymarket.fun/health

# Backend CORS
curl -H "Origin: https://sillymarket.fun" https://api.sillymarket.fun/health
```

---

**Last Updated:** 2025-11-22  
**Status:** Production Ready
