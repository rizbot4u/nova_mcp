/**
 * Nova Unified Bridge — Direct Bybit + DKHYR + per-tenant vault
 * ============================================================
 *  - /skills/*       : executes broker/web3 skills
 *  - /v1/keys/store  : stores per-tenant encrypted API keys
 *
 * Security:
 *   - /skills/execute and /v1/keys/store require header X-Bridge-Token
 *   - Binds to 127.0.0.1 (localhost only)
 *   - Refuses to start if BRIDGE_SECRET is unset
 *
 * Tenant credential resolution:
 *   - Body may include tenant_id (preferred) or org_id (fallback)
 *   - If the tenant has keys in the vault, they're used
 *   - Otherwise falls back to .env BYBIT_API_KEY / BYBIT_API_SECRET
 */

import express from "express";
import swaggerUi from "swagger-ui-express";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import {
  getTicker as bybitGetTicker,
  getWalletBalance as bybitGetBalance,
  createOrder as bybitCreateOrder,
} from "./bybit_direct.js";
import { getTenantKeys, storeTenantKeys } from "./vault.js";

const PORT = process.env.PORT || 8001;
const LOG_DIR = process.env.NOVA_LOG_DIR || "/tmp/nova_mcp_logs";
const SKILL_LOG = path.join(LOG_DIR, "skill_calls.log");
const EVM_RPC_URL =
  process.env.EVM_RPC_URL ||
  "https://base-mainnet.g.alchemy.com/v2/2mcrNfMkBxuSbN3D77b77pyfjFAv1k7Z";
const DKHYR_TOKEN_ADDRESS = "0x9991bE994829601F90328CCF9cee4D1A55ADae70";

// ---------- Risk limits ----------
const ORDER_LIMITS = {
  maxQtyPerSymbol: {
    BTCUSDT: 0.001,
    ETHUSDT: 0.02,
    default: 0.001,
  },
};

const TRANSFER_ALLOWLIST = [
  "0xa4ee963f223c193261d8545e4c4681ed3837af25",
  "0x084db36be9e2e6de5a9eadbdba6f26ee0c4f7113",
];

// ---------- Security: shared secret with Jarvis ----------
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
if (!BRIDGE_SECRET) {
  console.error("❌ BRIDGE_SECRET not set — refusing to start");
  console.error("   Add BRIDGE_SECRET=<64-char-hex> to your .env and re-run.");
  process.exit(1);
}

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logSkillCall(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    fs.appendFileSync(SKILL_LOG, line + "\n");
  } catch (e) {
    console.error("Log failed:", e.message);
  }
  console.log("🎯 [NOVA BRIDGE]:", line);
}

function getFormattedPrivateKey() {
  let key = process.env.TREASURY_PRIVATE_KEY || "";
  key = key.trim().replace(/^["']|["']$/g, "");
  if (key && !key.startsWith("0x")) key = "0x" + key;
  return key;
}

// ---------- Web3 ----------
const provider = new ethers.JsonRpcProvider(EVM_RPC_URL);

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

async function handleTokenInfo() {
  const c = new ethers.Contract(DKHYR_TOKEN_ADDRESS, ERC20_ABI, provider);
  const [name, symbol, decimals, supply] = await Promise.all([
    c.name(),
    c.symbol(),
    c.decimals(),
    c.totalSupply(),
  ]);
  return {
    name,
    symbol,
    decimals: Number(decimals),
    totalSupply: ethers.formatUnits(supply, decimals),
    contract: DKHYR_TOKEN_ADDRESS,
    chain: "Base Mainnet",
  };
}

async function handleTokenBalance(params) {
  if (!params.address) throw new Error("'address' required");
  const c = new ethers.Contract(DKHYR_TOKEN_ADDRESS, ERC20_ABI, provider);
  const [balance, decimals] = await Promise.all([
    c.balanceOf(params.address),
    c.decimals(),
  ]);
  return {
    token: "DKHYR",
    address: params.address,
    rawBalance: balance.toString(),
    formattedBalance: ethers.formatUnits(balance, decimals),
  };
}

async function handleTokenTransfer(params) {
  const pk = getFormattedPrivateKey();
  if (!pk) throw new Error("TREASURY_PRIVATE_KEY not set");
  if (!params.confirm) throw new Error("Transfer requires confirm: true");
  if (!params.to_address || !params.amount)
    throw new Error("'to_address' and 'amount' required");

  const toLower = params.to_address.toLowerCase();
  if (!TRANSFER_ALLOWLIST.includes(toLower)) {
    throw new Error(
      `Transfer rejected: ${params.to_address} is not on the approved allowlist`
    );
  }

  const wallet = new ethers.Wallet(pk, provider);
  const c = new ethers.Contract(DKHYR_TOKEN_ADDRESS, ERC20_ABI, wallet);
  const decimals = await c.decimals();
  const value = ethers.parseUnits(params.amount.toString(), decimals);
  const tx = await c.transfer(params.to_address, value);
  const receipt = await tx.wait();
  return {
    status: "success",
    txHash: receipt.hash,
    from: wallet.address,
    to: params.to_address,
    amount: params.amount,
  };
}

// ---------- Broker rail (direct Bybit, per-tenant capable) ----------
async function handleBybitTicker(params) {
  const symbol = params.symbol || "BTCUSDT";
  const category = params.category || "linear";
  return bybitGetTicker(symbol, category);
}

async function handleBybitBalance(params, creds = null) {
  return bybitGetBalance(params.accountType || "UNIFIED", creds);
}

async function handleBybitOrder(params, creds = null) {
  if (!params.confirm) throw new Error("Order requires confirm: true");

  const qty = parseFloat(params.qty);
  const symbol = params.symbol;
  const maxQty =
    ORDER_LIMITS.maxQtyPerSymbol[symbol] ??
    ORDER_LIMITS.maxQtyPerSymbol.default;

  if (!qty || qty <= 0) throw new Error("Invalid qty");
  if (qty > maxQty) {
    throw new Error(
      `Order rejected: qty ${qty} exceeds max allowed ${maxQty} for ${symbol}`
    );
  }

  return bybitCreateOrder(
    {
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType || "Limit",
      qty: params.qty,
      price: params.price,
      category: params.category || "linear",
      positionIdx: params.positionIdx,
    },
    creds
  );
}

// ---------- Skill registry ----------
const SKILLS = {
  "bybit.ticker": { category: "broker", handler: handleBybitTicker },
  "bybit.order": { category: "broker", handler: handleBybitOrder },
  "bybit.balance": { category: "broker", handler: handleBybitBalance },
  "dkhyr.info": { category: "token", handler: handleTokenInfo },
  "dkhyr.balance": { category: "token", handler: handleTokenBalance },
  "dkhyr.transfer": { category: "token", handler: handleTokenTransfer },
};

// ---------- HTTP ----------
const app = express();
app.use(express.json());

// ---------- Swagger ----------
const swaggerDoc = {
  openapi: "3.0.0",
  info: { title: "Nova MCP Bridge", version: "1.4.0" },
  servers: [{ url: `http://127.0.0.1:${PORT}` }],
  components: {
    securitySchemes: {
      BridgeToken: { type: "apiKey", in: "header", name: "X-Bridge-Token" },
    },
  },
  paths: {
    "/": { get: { summary: "Health check", responses: { 200: { description: "OK" } } } },
    "/skills/list": {
      get: { summary: "List skills", responses: { 200: { description: "OK" } } },
    },
    "/skills/execute": {
      post: {
        summary: "Execute a skill (requires X-Bridge-Token)",
        security: [{ BridgeToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["skill_name"],
                properties: {
                  skill_name: {
                    type: "string",
                    enum: Object.keys(SKILLS),
                    example: "bybit.ticker",
                  },
                  tenant_id: { type: "string", example: "tenant_alpha" },
                  org_id: { type: "string", example: "org_1" },
                  actor: { type: "string", example: "jarvis" },
                  parameters: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Result" },
          401: { description: "Unauthorized — missing or invalid X-Bridge-Token" },
        },
      },
    },
    "/v1/keys/store": {
      post: {
        summary: "Store per-tenant API keys (requires X-Bridge-Token)",
        security: [{ BridgeToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tenant_id", "api_key", "api_secret"],
                properties: {
                  tenant_id: { type: "string", example: "tenant_alpha" },
                  api_key: { type: "string" },
                  api_secret: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Stored" }, 401: { description: "Unauthorized" } },
      },
    },
  },
};
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
app.get("/openapi.json", (req, res) => res.json(swaggerDoc));

app.get("/", (req, res) => {
  res.json({
    service: "Nova MCP Bridge",
    version: "1.4.0",
    rails: ["broker_bybit", "web3_dkhyr"],
    vault: "per-tenant encrypted keys",
    auth: "X-Bridge-Token required on /skills/execute and /v1/keys/store",
    docs: "/docs",
  });
});

app.get("/skills/list", (req, res) => {
  res.json({
    count: Object.keys(SKILLS).length,
    skills: Object.entries(SKILLS).map(([name, meta]) => ({
      name,
      category: meta.category,
      target: meta.handler.name,
    })),
  });
});

// ---------- Vault: store tenant keys ----------
app.post("/v1/keys/store", (req, res) => {
  const token = req.headers["x-bridge-token"];
  if (!token || token !== BRIDGE_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { tenant_id, api_key, api_secret } = req.body || {};
  if (!tenant_id || !api_key || !api_secret) {
    return res.status(400).json({ error: "tenant_id, api_key, api_secret required" });
  }

  try {
    storeTenantKeys(tenant_id, api_key, api_secret);
    logSkillCall({
      skill_name: "vault.store",
      org_id: tenant_id,
      actor: "api",
      tenant_id,
    });
    return res.json({ status: "success", tenant_id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------- Skills: execute ----------
app.post("/skills/execute", async (req, res) => {
  // ---- AUTH GUARD ----
  const token = req.headers["x-bridge-token"];
  if (!token || token !== BRIDGE_SECRET) {
    logSkillCall({
      skill_name: req.body?.skill_name || "unknown",
      org_id: "unauthorized",
      actor: "unknown",
      error: "unauthorized",
    });
    return res.status(401).json({ error: "unauthorized" });
  }

  const {
    skill_name,
    tenant_id,
    org_id = "default_org",
    actor = "api",
    parameters = {},
  } = req.body || {};

  const skill = SKILLS[skill_name];
  if (!skill) {
    logSkillCall({ skill_name, org_id, actor, error: "Unknown skill" });
    return res.status(404).json({ error: `Unknown skill: ${skill_name}` });
  }

  // Resolve tenant credentials (falls back to .env if tenant unknown)
  const activeTenant = tenant_id || org_id;
  const creds = getTenantKeys(activeTenant);

  try {
    const result = await skill.handler(parameters, creds);
    logSkillCall({
      skill_name,
      tenant_id: activeTenant,
      org_id,
      actor,
      has_tenant_creds: !!creds,
      parameters,
      result,
    });
    res.json({
      skill: skill_name,
      category: skill.category,
      tenant_id: activeTenant,
      org_id,
      actor,
      used_tenant_creds: !!creds,
      result,
    });
  } catch (err) {
    logSkillCall({ skill_name, tenant_id: activeTenant, org_id, actor, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---------- Bind to loopback ONLY ----------
app.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 Nova Bridge active on http://127.0.0.1:${PORT} (localhost only)`);
  console.log(`🔒 /skills/execute and /v1/keys/store require header: X-Bridge-Token`);
  console.log(`🗄️  Vault: per-tenant encrypted keys`);
  console.log(`📖 Swagger UI: http://127.0.0.1:${PORT}/docs`);
  console.log(`📝 Audit log: ${SKILL_LOG}`);
});
