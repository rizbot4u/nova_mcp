#!/bin/bash
set -e
cd "$(dirname "$0")"

# Load all secrets + config from .env files
set -a
[ -f ~/trading-mcp/.env ] && source ~/trading-mcp/.env
[ -f ~/nova_mcp/.env ]    && source ~/nova_mcp/.env
set +a

# ---------- Required config (fail loudly if missing) ----------
: "${BRIDGE_SECRET:?BRIDGE_SECRET must be set in .env}"
: "${EVM_RPC_URL:?EVM_RPC_URL must be set in .env}"
: "${DKHYR_TOKEN_ADDRESS:?DKHYR_TOKEN_ADDRESS must be set in .env}"

# ---------- Bridge config ----------
export PORT="${PORT:-8001}"
export TRADING_MCP_PATH="${TRADING_MCP_PATH:-/home/nova/trading-mcp/dist/index.js}"
export BYBIT_TESTNET="${BYBIT_TESTNET:-true}"

# ---------- Redacted startup banner ----------
# Only show first 8 chars of anything sensitive, or a fingerprint.
echo "🔑 BYBIT_API_KEY:  ${BYBIT_API_KEY:0:8}...${BYBIT_API_KEY: -4}"
echo "🌐 EVM_RPC_URL:    <set> ($(echo -n "$EVM_RPC_URL" | wc -c) chars)"
echo "🪙 DKHYR:          ${DKHYR_TOKEN_ADDRESS:0:10}...${DKHYR_TOKEN_ADDRESS: -6}"
echo "🔒 BRIDGE_SECRET:  <set>"
echo "🚀 Starting bridge..."
echo ""

exec node bridge.js
