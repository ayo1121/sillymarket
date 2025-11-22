#!/bin/bash
set -euo pipefail

echo "=== Backend-Frontend Integration Check ==="
echo ""

# Check server .env
echo "1. Checking server configuration..."
if [ -f "server/.env" ]; then
  if grep -q "DATABASE_URL=" server/.env && ! grep -q "localhost:5432" server/.env; then
    echo "   ✅ DATABASE_URL is configured (not localhost)"
  else
    echo "   ⚠️  DATABASE_URL may need Supabase connection string"
  fi
  if grep -q "SESSION_SECRET=" server/.env; then
    echo "   ✅ SESSION_SECRET is set"
  else
    echo "   ⚠️  SESSION_SECRET not found"
  fi
else
  echo "   ❌ server/.env not found"
fi

# Check frontend .env.local
echo ""
echo "2. Checking frontend configuration..."
if [ -f "client/web/.env.local" ]; then
  if grep -q "VITE_API_URL=" client/web/.env.local; then
    echo "   ✅ VITE_API_URL is configured"
  else
    echo "   ⚠️  VITE_API_URL not found - will default to http://localhost:8787"
  fi
else
  echo "   ⚠️  client/web/.env.local not found - will use defaults"
fi

# Check if server is running
echo ""
echo "3. Checking if server is running..."
if curl -s http://localhost:8787/health > /dev/null 2>&1; then
  echo "   ✅ Server is running on port 8787"
else
  echo "   ❌ Server is not running. Start it with: cd server && npm run dev"
fi

# Check if frontend is running
echo ""
echo "4. Checking if frontend is running..."
if curl -s http://localhost:8080 > /dev/null 2>&1; then
  echo "   ✅ Frontend is running on port 8080"
else
  echo "   ❌ Frontend is not running. Start it with: cd client/web && npm run dev"
fi

# Check CORS configuration match
echo ""
echo "5. Checking CORS configuration..."
if [ -f "server/.env" ] && [ -f "client/web/.env.local" ]; then
  SERVER_ORIGIN=$(grep "^APP_ORIGIN=" server/.env | cut -d'=' -f2 | tr -d '"' || echo "")
  FRONTEND_API=$(grep "^VITE_API_URL=" client/web/.env.local | cut -d'=' -f2 | tr -d '"' || echo "")
  
  if [ -n "$SERVER_ORIGIN" ] && [ -n "$FRONTEND_API" ]; then
    # Check if server's CORS origin matches expected frontend URL
    if [ "$SERVER_ORIGIN" = "http://localhost:8080" ]; then
      echo "   ✅ CORS origin configured for frontend (http://localhost:8080)"
    else
      echo "   ⚠️  CORS origin ($SERVER_ORIGIN) may not match frontend URL"
    fi
    
    # Verify API URL points to correct backend port
    BACKEND_PORT=$(echo "$FRONTEND_API" | sed 's/.*:\([0-9]*\).*/\1/')
    if [ "$BACKEND_PORT" = "8787" ]; then
      echo "   ✅ Frontend API URL points to correct backend port (8787)"
    else
      echo "   ⚠️  Frontend API URL port ($BACKEND_PORT) may not match backend (8787)"
    fi
  else
    echo "   ⚠️  Could not verify CORS configuration"
  fi
else
  echo "   ⚠️  Missing .env files for CORS check"
fi

# Check critical frontend env vars
echo ""
echo "6. Checking frontend environment variables..."
if [ -f "client/web/.env.local" ]; then
  MISSING_VARS=()
  [ ! -z "$(grep "^VITE_RPC_URL=" client/web/.env.local)" ] || MISSING_VARS+=("VITE_RPC_URL")
  [ ! -z "$(grep "^VITE_PROGRAM_ID=" client/web/.env.local)" ] || MISSING_VARS+=("VITE_PROGRAM_ID")
  [ ! -z "$(grep "^VITE_SUPABASE_URL=" client/web/.env.local)" ] || MISSING_VARS+=("VITE_SUPABASE_URL")
  [ ! -z "$(grep "^VITE_SUPABASE_PUBLISHABLE_KEY=" client/web/.env.local)" ] || MISSING_VARS+=("VITE_SUPABASE_PUBLISHABLE_KEY")
  
  if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo "   ✅ All critical frontend env vars are set"
  else
    echo "   ⚠️  Missing: ${MISSING_VARS[*]}"
  fi
  
  # Check for placeholders
  if grep -q "REPLACE_WITH" client/web/.env.local; then
    echo "   ⚠️  Found placeholders in .env.local (VITE_SUPABASE_PUBLISHABLE_KEY needs update)"
  fi
else
  echo "   ⚠️  client/web/.env.local not found"
fi

# Check database connection (if server is running)
echo ""
echo "7. Checking database connection..."
if curl -s http://localhost:8787/health > /dev/null 2>&1; then
  # Try to check if database is actually connected by hitting /me endpoint
  # This will fail if DB is not connected, but that's expected if DATABASE_URL has placeholders
  DB_STATUS=$(curl -s http://localhost:8787/me 2>&1 | head -1)
  if echo "$DB_STATUS" | grep -q "Cannot connect\|ECONNREFUSED\|ENETUNREACH"; then
    echo "   ⚠️  Database connection issue (expected if DATABASE_URL has placeholders)"
  else
    echo "   ✅ Database endpoint responding (connection status unknown)"
  fi
else
  echo "   ⚠️  Cannot check database (server not running)"
fi

echo ""
echo "=== Integration Check Complete ==="
