/**
 * Nova Unified Bridge — Direct Bybit + DKHYR
 * ==========================================
 * Replaces trading-mcp dependency with direct Bybit API calls.
 * Keeps the /skills/* interface identical.
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

const PORT = process.env.PORT || 8001;
const LOG_DIR = "/tmp/nova_mcp_logs";
const SKILL_LOG = path.join(LOG_DIR, "skill_calls.log");
const EVM_RPC_URL =
  process.env.EVM_RPC_URL ||
  "https://base-mainnet.g.alchemy.com/v2/2mcrNfMkBxuSbN3D77b77pyfjFAv1k7Z";
const DKHYR_TOKEN_ADDRESS = "0x9991bE994829601F90328CCF9cee4D1A55ADae70";

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
  if (!params.to_address || !params.amount)
    throw new Error("'to_address' and 'amount' required");
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

// ---------- Broker rail (direct Bybit) ----------
async function handleBybitTicker(params) {
  const symbol = params.symbol || "BTCUSDT";
  const category = params.category || "linear";
  return bybitGetTicker(symbol, category);
}

async function handleBybitBalance(params) {
  return bybitGetBalance(params.accountType || "UNIFIED");
}

async function handleBybitOrder(params) {
  if (!params.confirm) throw new Error("Order requires confirm: true");
  return bybitCreateOrder({
    symbol: params.symbol,
    side: params.side,
    orderType: params.orderType || "Limit",
    qty: params.qty,
    price: params.price,
    category: params.category || "linear",
  });
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
  info: { title: "Nova MCP Bridge", version: "1.2.0" },
  servers: [{ url: `http://localhost:${PORT}` }],
  paths: {
    "/": { get: { summary: "Health check", responses: { 200: { description: "OK" } } } },
    "/skills/list": {
      get: { summary: "List skills", responses: { 200: { description: "OK" } } },
    },
    "/skills/execute": {
      post: {
        summary: "Execute a skill",
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
                  org_id: { type: "string", example: "org_1" },
                  actor: { type: "string", example: "api" },
                  parameters: { type: "object" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Result" } },
      },
    },
  },
};
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
app.get("/openapi.json", (req, res) => res.json(swaggerDoc));

app.get("/", (req, res) => {
  res.json({
    service: "Nova MCP Bridge",
    version: "1.2.0",
    rails: ["broker_bybit", "web3_dkhyr"],
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

app.post("/skills/execute", async (req, res) => {
  const {
    skill_name,
    org_id = "default_org",
    actor = "api",
    parameters = {},
  } = req.body || {};
  const skill = SKILLS[skill_name];

  if (!skill) {
    logSkillCall({ skill_name, org_id, actor, error: "Unknown skill" });
    return res.status(404).json({ error: `Unknown skill: ${skill_name}` });
  }

  try {
    const result = await skill.handler(parameters);
    logSkillCall({ skill_name, org_id, actor, parameters, result });
    res.json({
      skill: skill_name,
      category: skill.category,
      org_id,
      actor,
      result,
    });
  } catch (err) {
    logSkillCall({ skill_name, org_id, actor, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Nova Bridge active on http://0.0.0.0:${PORT}`);
  console.log(`📖 Swagger UI: http://localhost:${PORT}/docs`);
  console.log(`📝 Audit log: ${SKILL_LOG}`);
});
