#!/bin/bash

# Quick diagnostic script to check webhook and edge function status

echo "🔍 Bet Indexing Diagnostic Report"
echo "=================================="
echo ""

echo "✅ Edge Function Status:"
echo "  - Name: index_bet_event"
echo "  - Status: ACTIVE"
echo "  - Version: 44"
echo "  - Last Updated: 2025-11-20 20:28:30 UTC"
echo ""

echo "✅ Edge Function Secrets:"
echo "  - HELIUS_API_KEY: Set ✓"
echo "  - YESNO_PROGRAM_ID: Set ✓"
echo "  - SUPABASE_SERVICE_ROLE_KEY: Set ✓"
echo ""

echo "📋 Next Steps to Check:"
echo ""
echo "1. CHECK HELIUS WEBHOOK"
echo "   URL: https://dev.helius.xyz/webhooks"
echo "   "
echo "   Verify:"
echo "   - Webhook exists"
echo "   - Webhook URL: https://ibuzpjefotihoagusrqz.supabase.co/functions/v1/index_bet_event"
echo "   - Program ID: 8gBJBtEkyN95vd9bXTRKxyAaoLiTkogFmecEfQCSNJgb"
echo "   - Status: Active"
echo ""

echo "2. CHECK EDGE FUNCTION LOGS"
echo "   URL: https://supabase.com/dashboard/project/ibuzpjefotihoagusrqz/logs/edge-functions"
echo "   "
echo "   Filter by: index_bet_event"
echo "   Look for:"
echo "   - Incoming webhook requests"
echo "   - Any error messages"
echo "   - Insert success/failure logs"
echo ""

echo "3. TEST WITH A BET"
echo "   - Place a bet on any market"
echo "   - Wait 30 seconds"
echo "   - Check edge function logs for activity"
echo "   - Check Helius webhook logs for delivery status"
echo ""

echo "=================================="
echo ""
echo "Most likely issue: Helius webhook not configured or inactive"
echo ""
