# Silly Character - OpenSouls AI Helper

This service provides an AI-powered chat mascot for SillyMarket using the OpenSouls framework.

## Prerequisites

- **Bun** runtime (https://bun.sh)
- **OpenAI API key** (https://platform.openai.com/api-keys) - Required for the LLM

## Setup

### 1. Install Dependencies

```bash
cd services/opensouls-silly-character
bun install
```

### 2. Set Environment Variables

Create a `.env` file:
```bash
# Required: Your OpenAI API key
OPENAI_API_KEY=sk-your-key-here

# Required: Shared secret for authenticating requests from the main backend
SOUL_ENGINE_TOKEN=your-secret-token

# Optional: Port (default 4310)
PORT=4310
```

### 3. Run the Soul (Development)

In one terminal, start the soul engine:
```bash
cd souls/silly-character
bunx soul-engine dev
```

In another terminal, start the HTTP wrapper:
```bash
bun run dev
```

## API Endpoints

### Health Check
```bash
curl http://localhost:4310/health
# Response: { "ok": true }
```

### Chat
```bash
curl -X POST http://localhost:4310/chat \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I create a market?"}'

# Response: { "sessionId": "...", "reply": "hey! to create a market..." }
```

## LLM API Costs

OpenSouls uses OpenAI's API. Approximate costs (as of 2024):
- **GPT-3.5-turbo**: ~$0.002 per 1K tokens
- **GPT-4**: ~$0.01-0.03 per 1K tokens

A typical chat message is ~100-500 tokens, so costs are minimal for moderate usage.

## File Structure

```
services/opensouls-silly-character/
├── server.ts              # HTTP wrapper server
├── package.json           # Service dependencies
├── README.md              # This file
└── souls/
    └── silly-character/
        ├── package.json   # Soul dependencies
        └── soul/
            ├── initialProcess.ts           # Main mental process
            ├── cognitiveSteps/
            │   └── externalDialog.ts       # Dialog generation
            └── staticMemories/
                └── core.md                 # Personality & guardrails
```

## Production Deployment

For production, you'll need to:
1. Deploy the soul to OpenSouls Cloud (or self-host soul-engine-cloud)
2. Set `local: false` in server.ts
3. Use a proper organization slug and API token

See OpenSouls documentation for cloud deployment options.
