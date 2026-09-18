/**
 * Direct Bybit API client — no trading-mcp dependency.
 * Signs requests with HMAC-SHA256 (same approach as CCXT).
 */

import crypto from "crypto";

const BYBIT_BASE = "https://api.bybit.com";
const BROKER_CODE = process.env.BROKER_CODE || "Kr000820";

function getCreds() {
  return {
    apiKey: process.env.BYBIT_API_KEY || "",
    apiSecret: process.env.BYBIT_API_SECRET || "",
  };
}

function sign(timestamp, apiKey, recvWindow, params) {
  const raw = `${timestamp}${apiKey}${recvWindow}${params}`;
  return crypto
    .createHmac("sha256", getCreds().apiSecret)
    .update(raw)
    .digest("hex");
}

function authHeaders(timestamp, apiKey, recvWindow, signature) {
  return {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-SIGN": signature,
    "X-BAPI-RECV-WINDOW": recvWindow,
    "Content-Type": "application/json",
  };
}

// ---------- Market ----------
export async function getTicker(symbol, category = "linear") {
  const url = `${BYBIT_BASE}/v5/market/tickers?category=${category}&symbol=${symbol}`;
  const r = await fetch(url);
  return r.json();
}

// ---------- Account ----------
export async function getWalletBalance(accountType = "UNIFIED") {
  const { apiKey } = getCreds();
  const recvWindow = "5000";
  const timestamp = Date.now().toString();
  const params = `accountType=${accountType}`;
  const signature = sign(timestamp, apiKey, recvWindow, params);
  const url = `${BYBIT_BASE}/v5/account/wallet-balance?${params}`;

  const r = await fetch(url, {
    headers: authHeaders(timestamp, apiKey, recvWindow, signature),
  });
  return r.json();
}

// ---------- Trading ----------
export async function createOrder({
  symbol,
  side,
  orderType = "Limit",
  qty,
  price,
  category = "linear",
  positionIdx,
}) {
  const { apiKey } = getCreds();
  const recvWindow = "5000";
  const timestamp = Date.now().toString();
  const body = JSON.stringify({
    category,
    symbol,
    side,
    orderType,
    qty,
    ...(price ? { price } : {}),
    ...(positionIdx !== undefined ? { positionIdx } : {}),
    timeInForce: "GTC",
  });
  const signature = sign(timestamp, apiKey, recvWindow, body);
  const url = `${BYBIT_BASE}/v5/order/create`;

  const r = await fetch(url, {
    method: "POST",
    headers: authHeaders(timestamp, apiKey, recvWindow, signature),
    body,
  });
  return r.json();
}
