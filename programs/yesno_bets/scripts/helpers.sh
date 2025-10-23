mkmarket () {
  local mint="${1:-$MINT}"
  local prog="${2:-$PROG_ID}"
  local cutoff="${3:-600}"

  if [[ -z "$mint" || -z "$prog" ]]; then
    echo "usage: mkmarket <MINT (optional, defaults \$MINT)> <PROG_ID (optional, defaults \$PROG_ID)> <CUTOFF_SECONDS (optional, default 600)>" >&2
    return 2
  fi

  # run the create script and show its output
  local out
  out=$(node scripts/create_market_quick2.js --mint "$mint" --prog "$prog" --cutoff-seconds "$cutoff")
  echo "$out"

  # extract and export MARKET
  local m
  m=$(printf "%s\n" "$out" | awk -F': ' '/^Market[[:space:]]*:/{print $2}' | tr -d '[:space:]')
  if [[ -n "$m" ]]; then
    export MARKET="$m"
    echo "👉 Exported MARKET=$MARKET"
  else
    echo "❌ Could not parse Market pubkey from output." >&2
    return 1
  fi
}
