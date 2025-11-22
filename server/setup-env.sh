#!/bin/bash
set -euo pipefail

echo "=== Server Environment Setup ==="
echo ""

ENV_FILE=".env"

# Check if .env already exists
if [ -f "$ENV_FILE" ]; then
  echo "⚠️  .env file already exists"
  read -p "Do you want to overwrite it? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Keeping existing .env file"
    exit 0
  fi
fi

# Default values
APP_ORIGIN="${APP_ORIGIN:-http://localhost:8080}"
PORT="${PORT:-8787}"

# Get DATABASE_URL
echo "📋 Supabase Database Connection"
echo ""
echo "To get your connection string:"
echo "1. Go to: https://supabase.com/dashboard/project/rbcbyhjfjkbebjyipjqd/settings/database"
echo "2. Scroll to 'Connection string' → 'URI' tab"
echo "3. Copy the connection string"
echo ""
read -p "Paste your DATABASE_URL (or press Enter to skip): " DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo "⚠️  DATABASE_URL not provided. You'll need to add it manually to .env"
  DATABASE_URL="postgres://user:pass@localhost:5432/yesno"
fi

# Generate SESSION_SECRET
if command -v node &> /dev/null; then
  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "✅ Generated random SESSION_SECRET"
else
  SESSION_SECRET="change-me-to-random-string-$(date +%s)"
  echo "⚠️  Using timestamp-based SESSION_SECRET (consider changing it)"
fi

# Write .env file
cat > "$ENV_FILE" << EOF
APP_ORIGIN=$APP_ORIGIN
PORT=$PORT
DATABASE_URL=$DATABASE_URL
SESSION_SECRET=$SESSION_SECRET
EOF

echo ""
echo "✅ Created $ENV_FILE with:"
echo "   - APP_ORIGIN=$APP_ORIGIN"
echo "   - PORT=$PORT"
echo "   - DATABASE_URL=${DATABASE_URL:0:50}..."
echo "   - SESSION_SECRET=***"
echo ""
echo "🚀 You can now start the server with: npm run dev"

