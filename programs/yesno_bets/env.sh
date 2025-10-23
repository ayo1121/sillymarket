export RPC_URL=https://api.devnet.solana.com
export ANCHOR_PROVIDER_URL=$RPC_URL
export ANCHOR_WALLET=$HOME/.config/solana/id.json
export PROG_ID=$(solana address -k target/deploy/yesno_bets-keypair.json)
export OWNER=$(solana address)
export MINT=451e5ALKCbNwqGYCZwvLHUR3WbxVXDwcMoJThamTwAAG
echo "[env] PROG_ID=$PROG_ID"; echo "[env] OWNER=$OWNER"; echo "[env] MINT=$MINT"
export MARKET=FiChkDd8LNcD9mHA3SJvBj1rSdii91Wyep1V1oY42Zdm
