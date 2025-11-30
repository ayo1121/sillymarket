#!/bin/bash
# This script applies the shared config pattern to all test files

for file in tests/security-limits-overflow.spec.ts tests/security-resolution-claims.spec.ts tests/yesno_markets.spec.ts tests/yesno_markets.neg.spec.ts; do
  echo "Processing $file..."
  
  # Add cfg variable declaration after BET_AMOUNT or similar
  sed -i '/const BET_AMOUNT/a\    let cfg: PublicKey;' "$file" 2>/dev/null || true
  sed -i '/const MAX =/a\    let cfg: PublicKey;' "$file" 2>/dev/null || true
  
  # Remove individual config initializations (lines with Keypair.generate for cfg)
  # This is already done by previous sed commands
  
done

echo "Done!"
