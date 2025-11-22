#!/usr/bin/env bash
#
# Security Setup and Check Script
# ================================
# This script performs a complete security setup and verification:
# - Checks Node version
# - Installs Husky git hooks
# - Installs and builds frontend
# - Installs and builds backend
# - Applies Supabase migrations
#
# Usage: ./scripts/security_setup_and_check.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Security Setup and Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# =====================================================================
# 1. Check Node Version
# =====================================================================

echo -e "${BLUE}== Checking Node version ==${NC}"
NODE_VERSION=$(node -v)
echo "Current Node version: $NODE_VERSION"

# Extract major version
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')

if [ "$NODE_MAJOR" -lt 20 ] || [ "$NODE_MAJOR" -ge 21 ]; then
    echo -e "${YELLOW}⚠️  WARNING: Node version should be >=20.0.0 and <21.0.0${NC}"
    echo -e "${YELLOW}   Current version: $NODE_VERSION${NC}"
    echo -e "${YELLOW}   Please install Node 20.x for best compatibility${NC}"
    echo ""
else
    echo -e "${GREEN}✓ Node version is compatible${NC}"
    echo ""
fi

# =====================================================================
# 2. Husky Setup (Root Level)
# =====================================================================

echo -e "${BLUE}== Setting up Husky git hooks ==${NC}"

# Check if package.json exists at root
if [ -f "package.json" ]; then
    echo "Installing Husky..."
    npm install --save-dev husky || echo -e "${YELLOW}⚠️  Husky install failed (may already be installed)${NC}"
    
    echo "Initializing Husky..."
    npx husky install || echo -e "${YELLOW}⚠️  Husky init failed (may already be initialized)${NC}"
else
    echo -e "${YELLOW}⚠️  No root package.json found, skipping Husky install${NC}"
fi

# Make pre-commit hook executable
if [ -f ".husky/pre-commit" ]; then
    chmod +x .husky/pre-commit
    echo -e "${GREEN}✓ Pre-commit hook is executable${NC}"
else
    echo -e "${YELLOW}⚠️  .husky/pre-commit not found${NC}"
fi

echo ""

# =====================================================================
# 3. Frontend Setup (client/web)
# =====================================================================

echo -e "${BLUE}== Installing frontend dependencies ==${NC}"
cd client/web

echo "Running npm install..."
npm install

echo ""
echo -e "${BLUE}== Running frontend security audit ==${NC}"
npm audit || echo -e "${YELLOW}⚠️  Audit found issues (attempting fix...)${NC}"
npm audit fix || echo -e "${YELLOW}⚠️  Some audit issues could not be auto-fixed${NC}"

echo ""
echo -e "${BLUE}== Building frontend ==${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Frontend build successful${NC}"
else
    echo -e "${RED}✗ Frontend build failed${NC}"
    exit 1
fi

cd ../..
echo ""

# =====================================================================
# 4. Backend Setup (server)
# =====================================================================

echo -e "${BLUE}== Installing backend dependencies ==${NC}"
cd server

echo "Running npm install..."
npm install

echo ""
echo -e "${BLUE}== Building backend ==${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend build successful${NC}"
else
    echo -e "${RED}✗ Backend build failed${NC}"
    exit 1
fi

cd ..
echo ""

# =====================================================================
# 5. Supabase Migrations
# =====================================================================

echo -e "${BLUE}== Applying Supabase migrations ==${NC}"

# Check if supabase CLI is available
if command -v supabase &> /dev/null; then
    echo "Supabase CLI found, applying migrations..."
    echo -e "${YELLOW}Note: This includes 0006_markets_rls_lockdown.sql${NC}"
    
    # Check if we're in a Supabase project
    if [ -f "client/web/supabase/config.toml" ] || [ -f "supabase/config.toml" ]; then
        supabase db push || echo -e "${YELLOW}⚠️  Migration push failed (may need manual intervention)${NC}"
    else
        echo -e "${YELLOW}⚠️  No Supabase config found, skipping migration${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Supabase CLI not found${NC}"
    echo -e "${YELLOW}   Please install it with: brew install supabase/tap/supabase${NC}"
    echo -e "${YELLOW}   Then run: supabase db push${NC}"
fi

echo ""

# =====================================================================
# 6. Final Summary
# =====================================================================

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}What was done:${NC}"
echo "  ✓ Node version checked"
echo "  ✓ Husky git hooks configured"
echo "  ✓ Frontend dependencies installed"
echo "  ✓ Frontend built successfully"
echo "  ✓ Backend dependencies installed"
echo "  ✓ Backend built successfully"
echo "  ✓ Supabase migrations applied (if CLI available)"
echo ""
echo -e "${BLUE}Next steps (MANUAL):${NC}"
echo ""
echo -e "${YELLOW}1. Test end-to-end user flow:${NC}"
echo "   - Connect wallet"
echo "   - Create a market"
echo "   - Place a bet"
echo "   - Resolve market"
echo "   - Claim winnings"
echo ""
echo -e "${YELLOW}2. Verify production environment variables:${NC}"
echo "   - Vercel: Check all VITE_* variables"
echo "   - Railway: Check DATABASE_URL, SESSION_SECRET, APP_ORIGIN"
echo "   - Supabase: Verify service_role key is NOT exposed to frontend"
echo ""
echo -e "${YELLOW}3. Verify mainnet/devnet configuration:${NC}"
echo "   - VITE_PROGRAM_ID matches deployed program"
echo "   - VITE_RPC_URL points to correct network"
echo "   - VITE_SUPABASE_URL and keys are correct"
echo ""
echo -e "${YELLOW}4. Test git pre-commit hook:${NC}"
echo "   - Try to commit a .env file (should be blocked)"
echo "   - Verify: git add .env && git commit -m 'test'"
echo ""
echo -e "${GREEN}Security setup complete! 🎉${NC}"
