# Deployment Guide - sillymarket

Complete guide for deploying the sillymarket prediction-market app to production.

---

## Prerequisites

- **Railway account** (for backend API)
- **Vercel account** (for frontend)
- **GoDaddy domain** (sillymarket.fun)
- **Supabase project** (PostgreSQL database)
- **Deployed Solana program** (program ID)

---

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│                 │         │                  │         │                 │
│  sillymarket    │────────▶│  Railway API     │────────▶│  Supabase       │
│  .fun           │  HTTPS  │  api.sillymarket │  SQL    │  PostgreSQL     │
│  (Vercel)       │         │  .fun            │         │                 │
│                 │         │                  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
       │                            │
       │                            │
       └────────────────────────────┘
              Solana Devnet
           (Web3.js + Anchor)
```

---

## Part 1: Railway Backend Deployment

### Step 1: Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Connect your GitHub account and select your repository
5. Railway will detect the monorepo structure

### Step 2: Configure Build Settings

In the Railway dashboard for your service:

1. **Root Directory**: `server`
2. **Build Command**: `npm run build`
3. **Start Command**: `npm run start`
4. **Watch Paths**: `server/**`

### Step 3: Set Environment Variables

In Railway → Variables, add the following:

```bash
# Server Configuration
PORT=8787
NODE_ENV=production

# CORS Origins (comma-separated)
APP_ORIGIN=https://sillymarket.fun,https://www.sillymarket.fun,https://sillymarket.vercel.app

# Database (from Supabase)
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres

# Session Security (generate with: openssl rand -base64 32)
SESSION_SECRET=<your-generated-secret-here>
```

**How to get DATABASE_URL:**
1. Go to Supabase dashboard → Project Settings → Database
2. Copy the "Connection string" under "Connection pooling"
3. Replace `[YOUR-PASSWORD]` with your database password

**How to generate SESSION_SECRET:**
```bash
openssl rand -base64 32
```

### Step 4: Deploy

1. Railway will automatically deploy when you push to your main branch
2. Wait for build to complete (~2-3 minutes)
3. Railway will provide a URL like: `yesno-backend-production.up.railway.app`

### Step 5: Verify Backend

Test the health endpoint:

```bash
curl https://yesno-backend-production.up.railway.app/health
```

Expected response:
```json
{"ok":true}
```

### Step 6: Set Custom Domain

1. In Railway → Settings → Domains
2. Click **"Custom Domain"**
3. Enter: `api.sillymarket.fun`
4. Railway will provide CNAME instructions
5. **Important**: Note the CNAME value for DNS configuration (next section)

---

## Part 2: DNS Configuration (GoDaddy)

### Configure DNS Records

Log into GoDaddy DNS management and set:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | `76.76.21.21` | 600 |
| CNAME | www | `cname.vercel-dns.com` | 600 |
| CNAME | api | `<your-railway-service>.up.railway.app` | 600 |

**Critical:** Replace `<your-railway-service>` with the actual Railway CNAME from Step 6 above.

### Verify DNS Propagation

Wait 5-10 minutes, then test:

```bash
# Should return Railway backend
curl https://api.sillymarket.fun/health

# Should return Vercel frontend (after Vercel deployment)
curl https://sillymarket.fun
```

---

## Part 3: Vercel Frontend Deployment

### Step 1: Create Vercel Project

1. Go to [vercel.com](https://vercel.com)
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Vercel will detect it's a monorepo

### Step 2: Configure Build Settings

**Framework Preset**: `Vite`

**Root Directory**: `client/web`

**Build Command**: `npm run build`

**Output Directory**: `dist` (default, leave empty)

**Install Command**: `npm install` (default)

### Step 3: Set Environment Variables

In Vercel → Settings → Environment Variables, add:

```bash
# Backend API URL
VITE_API_URL=https://api.sillymarket.fun

# Solana Configuration
VITE_RPC_URL=https://api.devnet.solana.com
VITE_PROGRAM_ID=<your-deployed-solana-program-id>
VITE_COMMITMENT=confirmed
VITE_PRIORITY_MICROLAMPORTS=0

# Supabase Configuration
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-supabase-anon-key>

# Feature Flags
VITE_REQUIRE_WALLET=1
VITE_DEBUG_DOCK=0
```

**How to get Supabase credentials:**
1. Go to Supabase dashboard → Project Settings → API
2. Copy **Project URL** → use for `VITE_SUPABASE_URL`
3. Copy **anon/public key** → use for `VITE_SUPABASE_PUBLISHABLE_KEY`

**How to get Solana Program ID:**
- From your Anchor deployment: `anchor keys list`
- Or from `target/deploy/yesno_markets-keypair.json`

### Step 4: Deploy

1. Click **"Deploy"**
2. Vercel will build and deploy (~2-3 minutes)
3. Vercel will provide a URL like: `sillymarket.vercel.app`

### Step 5: Verify Frontend

1. Visit `https://sillymarket.vercel.app`
2. Check browser console for errors
3. Verify it loads without blank screen
4. Test wallet connection

### Step 6: Set Custom Domain

1. In Vercel → Settings → Domains
2. Add domain: `sillymarket.fun`
3. Add domain: `www.sillymarket.fun`
4. Vercel will verify DNS (may take a few minutes)

---

## Part 4: Post-Deployment Verification

### Backend Health Check

```bash
curl -i https://api.sillymarket.fun/health
```

Expected:
```
HTTP/2 200
content-type: application/json
{"ok":true}
```

### Frontend Load Check

```bash
curl -I https://sillymarket.fun
```

Expected:
```
HTTP/2 200
server: Vercel
```

### CORS Check

Open browser console at `https://sillymarket.fun` and check:
- ✅ No CORS errors
- ✅ API calls to `api.sillymarket.fun` succeed
- ✅ Wallet connection works

### Full Integration Test

1. **Visit**: https://sillymarket.fun
2. **Connect wallet**: Click connect button, approve in Phantom/Solflare
3. **Browse markets**: Markets should load from Solana
4. **Create comment**: Test backend API integration
5. **Place bet**: Test Solana transaction flow

---

## Troubleshooting

### Issue: Blank Screen on Vercel

**Symptoms**: White/blank page, no errors in build logs

**Solutions**:
1. Check browser console for JavaScript errors
2. Verify all `VITE_*` environment variables are set in Vercel
3. Check that `VITE_API_URL` points to correct Railway URL
4. Rebuild and redeploy after adding env vars

### Issue: "Cannot connect to server"

**Symptoms**: Frontend loads but API calls fail

**Solutions**:
1. Verify `api.sillymarket.fun` DNS points to Railway (not Vercel)
   ```bash
   curl https://api.sillymarket.fun/health
   ```
2. Check Railway logs for errors
3. Verify `APP_ORIGIN` in Railway includes `https://sillymarket.fun`
4. Check browser console for CORS errors

### Issue: CORS Errors

**Symptoms**: Browser console shows "blocked by CORS policy"

**Solutions**:
1. Verify `APP_ORIGIN` in Railway includes your frontend domain
2. Ensure `NODE_ENV=production` is set in Railway
3. Check that cookies are enabled in browser
4. Verify Railway backend is using HTTPS (not HTTP)

### Issue: Database Connection Failed

**Symptoms**: Railway logs show "Cannot connect to PostgreSQL"

**Solutions**:
1. Verify `DATABASE_URL` is correct in Railway
2. Check Supabase → Project Settings → Database → Connection pooling
3. Ensure password doesn't have special characters that need URL encoding
4. Test connection string locally first

### Issue: Wallet Connection Fails

**Symptoms**: Wallet popup doesn't appear or transactions fail

**Solutions**:
1. Verify `VITE_PROGRAM_ID` matches your deployed Solana program
2. Check `VITE_RPC_URL` is accessible
3. Ensure wallet extension is installed and unlocked
4. Check browser console for Solana errors

---

## Monitoring and Logs

### Railway Logs

View real-time backend logs:
1. Railway dashboard → Your service → Deployments
2. Click on latest deployment
3. View logs tab

### Vercel Logs

View frontend build and runtime logs:
1. Vercel dashboard → Your project → Deployments
2. Click on deployment
3. View build logs or runtime logs

### Supabase Logs

View database queries and errors:
1. Supabase dashboard → Logs
2. Filter by type (Postgres, API, etc.)

---

## Updating After Deployment

### Backend Updates

1. Push changes to GitHub
2. Railway auto-deploys from main branch
3. Monitor deployment in Railway dashboard
4. Verify with health check

### Frontend Updates

1. Push changes to GitHub
2. Vercel auto-deploys from main branch
3. Monitor deployment in Vercel dashboard
4. Clear browser cache and test

### Environment Variable Updates

**Railway:**
1. Update variables in Railway dashboard
2. Manually trigger redeploy (or push empty commit)

**Vercel:**
1. Update variables in Vercel dashboard
2. Redeploy from Vercel dashboard

---

## Security Checklist

- [ ] `SESSION_SECRET` is a strong random string (not "dev-secret")
- [ ] `DATABASE_URL` password is secure
- [ ] Supabase RLS policies are enabled
- [ ] `NODE_ENV=production` is set in Railway
- [ ] CORS origins only include your actual domains
- [ ] Supabase anon key is the public key (not service role key)
- [ ] `.env` files are in `.gitignore` (never commit secrets)

---

## Quick Reference

### Railway Environment Variables
```bash
PORT=8787
NODE_ENV=production
APP_ORIGIN=https://sillymarket.fun,https://www.sillymarket.fun
DATABASE_URL=<supabase-connection-string>
SESSION_SECRET=<random-secret>
```

### Vercel Environment Variables
```bash
VITE_API_URL=https://api.sillymarket.fun
VITE_RPC_URL=https://api.devnet.solana.com
VITE_PROGRAM_ID=<program-id>
VITE_SUPABASE_URL=<supabase-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<supabase-anon-key>
VITE_COMMITMENT=confirmed
VITE_REQUIRE_WALLET=1
VITE_DEBUG_DOCK=0
```

### Useful Commands
```bash
# Test backend health
curl https://api.sillymarket.fun/health

# Test frontend
curl -I https://sillymarket.fun

# Generate session secret
openssl rand -base64 32

# Check DNS
nslookup api.sillymarket.fun

# View Railway logs
railway logs

# View Vercel logs
vercel logs
```

---

## Support

- **Railway**: https://railway.app/help
- **Vercel**: https://vercel.com/support
- **Supabase**: https://supabase.com/docs
- **Solana**: https://docs.solana.com
