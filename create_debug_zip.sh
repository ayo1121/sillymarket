#!/usr/bin/env bash
# Prepare a sanitized yesno_full_debug.zip for sharing with ChatGPT by zipping key project folders while excluding build artifacts, dependencies, and secrets.

set -euo pipefail

script_dir="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

zip_name="yesno_full_debug.zip"

# Remove existing archive if present
rm -f "$zip_name"

# Collect existing directories to include
declare -a targets=(
  "yesno_markets"
  "yesno_anchor"
  "server"
  "client/web"
  "scripts"
  "supabase"
)

declare -a includes=()
for dir in "${targets[@]}"; do
  if [ -d "$dir" ]; then
    includes+=("$dir")
  else
    echo "Skipping missing path: $dir"
  fi
done

if [ "${#includes[@]}" -eq 0 ]; then
  echo "No target directories found. Nothing to zip."
  exit 0
fi

zip -r "$zip_name" "${includes[@]}" \
  -x "**/node_modules/*" \
  -x "**/.git/*" \
  -x "**/dist/*" \
  -x "**/build/*" \
  -x "**/.next/*" \
  -x "**/.turbo/*" \
  -x "**/.svelte-kit/*" \
  -x "**/coverage/*" \
  -x "**/target/*" \
  -x "**/.DS_Store" \
  -x "**/*.log" \
  -x "**/.env*"

echo "Created $zip_name"
echo "Run: bash create_debug_zip.sh && then upload yesno_full_debug.zip to ChatGPT"
