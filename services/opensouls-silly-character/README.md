# Silly Character Soul Service

AI-powered chat mascot for SillyMarket using OpenAI's GPT-3.5-turbo.

## Quick Start (Local Development)

```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Create .env file
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY and SOUL_ENGINE_TOKEN

# Run development server
bun run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 4310, Railway sets automatically) |
| `OPENAI_API_KEY` | Yes | OpenAI API key for LLM calls |
| `SOUL_ENGINE_TOKEN` | Yes | Shared secret for authenticating requests from backend |

## API Endpoints

### Health Check
```bash
curl http://localhost:4310/health
# Response: { "ok": true, "configured": true }
```

### Chat
```bash
curl -X POST http://localhost:4310/chat \
  -H "Authorization: Bearer YOUR_SOUL_ENGINE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I create a market?"}'

# Response: { "sessionId": "session-...", "reply": "hey! to create a market..." }
```

## Railway Deployment

### Build Command
```
bun install
```

### Start Command
```
bun run start
```

### Environment Variables (set in Railway dashboard)
- `OPENAI_API_KEY` - Your OpenAI API key
- `SOUL_ENGINE_TOKEN` - Same token you use in the backend

Railway automatically sets `PORT`.

## Cost Estimates

OpenAI GPT-3.5-turbo pricing (as of 2024):
- Input: $0.0005 / 1K tokens
- Output: $0.0015 / 1K tokens

A typical chat message is ~100-300 tokens, so costs are very low:
- ~$0.0001 - $0.0005 per message
- ~$1 per 2,000-10,000 messages

## Security Notes

- Never expose `OPENAI_API_KEY` to the frontend
- `SOUL_ENGINE_TOKEN` should be a strong random string
- The service only accepts authenticated requests (except `/health`)
