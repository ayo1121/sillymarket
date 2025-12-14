# Silly Character Deployment Guide

This guide explains how to deploy the optional "Silly Character" AI chat mascot feature.

> **⚠️ This feature is OFF by default.** Your website works perfectly without it.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Vercel       │     │  Railway #1     │     │  Railway #2     │
│   (Frontend)    │────▶│   (Backend)     │────▶│ (Soul Service)  │
│                 │     │                 │     │                 │
│ VITE_ENABLE_    │     │ ENABLE_SILLY_   │     │ OPENAI_API_KEY  │
│ SILLY_CHARACTER │     │ CHARACTER       │     │ SOUL_ENGINE_    │
│                 │     │ SOUL_ENGINE_URL │     │ TOKEN           │
│                 │     │ SOUL_ENGINE_    │     │                 │
│                 │     │ TOKEN           │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Prerequisites

1. **OpenAI API Key** - Get one at https://platform.openai.com/api-keys (~$0.0005 per chat message)
2. **Railway account** - For hosting the soul service
3. **A random secret token** - Generate with: `openssl rand -base64 32`

---

## Step 1: Deploy Soul Service (Railway)

### Create New Railway Service

1. Go to Railway and create a new project
2. Select "Deploy from GitHub repo" or "Empty project"
3. If using GitHub, point to `services/opensouls-silly-character/`

### Configure Build Settings

| Setting | Value |
|---------|-------|
| Root Directory | `services/opensouls-silly-character` |
| Build Command | `bun install` |
| Start Command | `bun run start` |

### Set Environment Variables

| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | `sk-your-openai-key` |
| `SOUL_ENGINE_TOKEN` | `your-random-secret-token` |

Railway automatically sets `PORT`.

### Get the Service URL

After deployment, copy the Railway URL (e.g., `https://silly-character-production.up.railway.app`)

---

## Step 2: Configure Backend (Railway)

Add these environment variables to your **existing backend** Railway service:

| Variable | Value |
|----------|-------|
| `ENABLE_SILLY_CHARACTER` | `true` |
| `SOUL_ENGINE_URL` | `https://silly-character-production.up.railway.app` (your soul service URL) |
| `SOUL_ENGINE_TOKEN` | `your-random-secret-token` (same as soul service) |

---

## Step 3: Configure Frontend (Vercel)

Add this environment variable to your Vercel project:

| Variable | Value |
|----------|-------|
| `VITE_ENABLE_SILLY_CHARACTER` | `true` |

> **🚫 NEVER add `OPENAI_API_KEY` to Vercel** - it would be exposed to browsers!

---

## Verification

### Test Soul Service Health

```bash
curl https://your-soul-service.up.railway.app/health
# Expected: { "ok": true, "configured": true }
```

### Test Backend Route (Disabled State)

```bash
curl -X POST https://your-backend.up.railway.app/api/silly-character/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'

# If disabled: { "disabled": true, "sessionId": "disabled", "reply": "Silly Character is currently offline." }
# If enabled: { "sessionId": "session-...", "reply": "hey there! 👋 ..." }
```

---

## Disabling the Feature

To disable the feature at any time:

1. **Backend**: Set `ENABLE_SILLY_CHARACTER=false` (or remove it)
2. **Frontend**: Set `VITE_ENABLE_SILLY_CHARACTER=false` (or remove it)

The soul service can remain running - it simply won't receive requests.

---

## Cost Estimates

OpenAI GPT-3.5-turbo pricing:
- ~$0.0001 - $0.0005 per chat message
- ~$1 per 2,000-10,000 messages

Railway:
- Hobby plan: $5/month includes enough compute for this service
- Usage-based: ~$0.000463/min when active

---

## Troubleshooting

### Widget not appearing
- Check `VITE_ENABLE_SILLY_CHARACTER=true` in Vercel
- Redeploy frontend after adding env var

### "Silly Character is currently offline"
- Check `ENABLE_SILLY_CHARACTER=true` in backend
- Check `SOUL_ENGINE_URL` and `SOUL_ENGINE_TOKEN` are set correctly

### Chat returns error messages
- Check soul service `/health` endpoint
- Check `OPENAI_API_KEY` is valid in soul service
- Check Railway logs for errors

---

## Security Checklist

- [ ] `OPENAI_API_KEY` is ONLY in soul service (never in frontend/backend)
- [ ] `SOUL_ENGINE_TOKEN` matches between backend and soul service
- [ ] No `.env` files are committed to git
- [ ] Soul service `/chat` endpoint requires auth (returns 401 without token)
