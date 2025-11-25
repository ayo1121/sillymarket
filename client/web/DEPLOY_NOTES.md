# Deployment Notes

## Vercel Routing Configuration

### Modern Routing (Current)

This project uses **modern Vercel routing configuration** with `rewrites` only.

**File**: `vercel.json`

```json
{
  "rewrites": [
    {
      "source": "/sitemap.xml",
      "destination": "/api/sitemap"
    },
    {
      "source": "/(.*)",
      "destination": "/"
    }
  ]
}
```

### ⚠️ IMPORTANT: Do NOT Mix Routing Configurations

**Never add the legacy `routes` array alongside `rewrites`, `redirects`, or `headers`.**

This will cause the Vercel deployment error:
```
Mixed Routing Properties
https://vercel.com/docs/errors/error-list#mixed-routing-properties
```

### How It Works

1. **Sitemap Route**: `/sitemap.xml` → `/api/sitemap` (serverless function)
2. **SPA Fallback**: All other routes → `/` (index.html)

The second rewrite `/(.*) → /` handles SPA routing by serving `index.html` for all non-file routes (e.g., `/market/123`, `/my-bets`, `/profile/abc`).

Vercel automatically handles static files (JS, CSS, images) before applying rewrites, so they are served directly without hitting the SPA fallback.

### Serverless Function Location

- **Path**: `api/sitemap.ts`
- **Route**: `/api/sitemap`
- **Public URL**: `https://sillymarket.fun/sitemap.xml`

### Migration from Legacy Routes

**Before** (caused deployment error):
```json
{
  "rewrites": [
    { "source": "/sitemap.xml", "destination": "/api/sitemap" }
  ],
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/" }
  ]
}
```

**After** (modern, working):
```json
{
  "rewrites": [
    { "source": "/sitemap.xml", "destination": "/api/sitemap" },
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

The `{ "handle": "filesystem" }` is no longer needed because Vercel handles static files automatically before applying rewrites.

### Deployment Checklist

Before deploying:
- [x] Verify `vercel.json` has NO `routes` key
- [x] Verify `vercel.json` is valid JSON (no trailing commas)
- [x] Run `npm run build` locally to ensure it passes
- [x] Confirm serverless function exists at `api/sitemap.ts`

### References

- [Vercel Rewrites Documentation](https://vercel.com/docs/projects/project-configuration#rewrites)
- [Mixed Routing Properties Error](https://vercel.com/docs/errors/error-list#mixed-routing-properties)
