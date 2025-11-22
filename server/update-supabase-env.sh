#!/bin/bash
# Helper script to update server .env with Supabase connection string

set -euo pipefail

ENV_FILE=".env"
PROJECT_ID="rbcbyhjfjkbebjyipjqd"

echo "=========================================="
echo "Supabase Database Connection Setup"
echo "=========================================="
echo ""
echo "Your Supabase project: $PROJECT_ID"
echo "Dashboard: https://supabase.com/dashboard/project/$PROJECT_ID/settings/database"
echo ""
echo "To get your database connection string:"
echo "1. Go to the dashboard link above"
echo "2. Scroll to 'Connection string' section"
echo "3. Select 'URI' tab"
echo "4. Copy the connection string"
echo ""
echo "The connection string should look like:"
echo "  postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"
echo ""
echo "OR for direct connection (recommended for server):"
echo "  postgresql://postgres:[PASSWORD]@db.$PROJECT_ID.supabase.co:5432/postgres"
echo ""

if [ -f "$ENV_FILE" ]; then
  echo "Current DATABASE_URL in .env:"
  grep "^DATABASE_URL=" "$ENV_FILE" || echo "  (not set)"
  echo ""
fi

read -p "Enter your Supabase database connection string (or press Enter to skip): " DB_URL

if [ -n "$DB_URL" ]; then
  if grep -q "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
    # Update existing DATABASE_URL
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" "$ENV_FILE"
    else
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" "$ENV_FILE"
    fi
    echo "✅ Updated DATABASE_URL in $ENV_FILE"
  else
    # Append new DATABASE_URL
    echo "DATABASE_URL=$DB_URL" >> "$ENV_FILE"
    echo "✅ Added DATABASE_URL to $ENV_FILE"
  fi
  echo ""
  echo "You can now start the server with: npm run dev"
else
  echo "Skipped. You can manually edit $ENV_FILE and set DATABASE_URL"
fi

