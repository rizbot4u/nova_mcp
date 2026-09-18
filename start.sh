#!/bin/bash
cd "$(dirname "$0")"

# Load Bybit credentials
set -a
source ~/trading-mcp/.env
set +a

# Bridge config
export PORT=8001
export TRADING_MCP_PATH="/home/nova/trading-mcp/dist/index.js"
export BYBIT_TESTNET="true"

# Web3 (Base Mainnet)
export EVM_RPC_URL="https://base-mainnet.g.alchemy.com/v2/2mcrNfMkBxuSbN3D77b77pyfjFAv1k7Z"
export DKHYR_TOKEN_ADDRESS="0x9991bE994829601F90328CCF9cee4D1A55ADae70"

# Optional: enable writes (transfers) by uncommenting and setting:
# export TREASURY_PRIVATE_KEY="0x..."

echo "🔑 BYBIT_API_KEY: ${BYBIT_API_KEY:0:8}..."
echo "🌐 EVM_RPC_URL: $EVM_RPC_URL"
echo "🪙 DKHYR: $DKHYR_TOKEN_ADDRESS"
echo "🚀 Starting bridge..."

node bridge.js
