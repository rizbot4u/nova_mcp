/**
 * Web3 Rail — DKHYR token actions on Base Mainnet
 * ================================================
 * Uses ethers.js to interact with DKHYR ERC-20 contract.
 */

import { ethers } from "ethers";

// DKHYR contract on Base Mainnet
const DKHYR_ADDRESS = "0x9991bE994829601F90328CCF9cee4D1A55ADae70";
const DKHYR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

let provider = null;
let wallet = null;
let contract = null;

export function initWeb3() {
  const rpcUrl = process.env.EVM_RPC_URL || "https://mainnet.base.org";
  const pk = process.env.TREASURY_PRIVATE_KEY;

  provider = new ethers.JsonRpcProvider(rpcUrl);

  // Read-only contract always available
  contract = new ethers.Contract(DKHYR_ADDRESS, DKHYR_ABI, provider);

  // Writable contract only if private key is set
  if (pk) {
    wallet = new ethers.Wallet(pk, provider);
    contract = new ethers.Contract(DKHYR_ADDRESS, DKHYR_ABI, wallet);
  }

  console.log("✅ Web3 rail initialized");
  console.log("   RPC:", rpcUrl);
  console.log("   DKHYR:", DKHYR_ADDRESS);
  console.log("   Write enabled:", !!wallet);
}

export async function handleTokenBalance(params) {
  const { address } = params;
  if (!address) throw new Error("address required");

  const raw = await contract.balanceOf(address);
  const decimals = await contract.decimals();
  const balance = ethers.formatUnits(raw, decimals);

  return {
    token: "DKHYR",
    address,
    balance,
    raw: raw.toString(),
  };
}

export async function handleTokenTransfer(params) {
  if (!wallet) throw new Error("Treasury private key not configured");

  const { to, amount } = params;
  if (!to || !amount) throw new Error("to and amount required");

  const decimals = await contract.decimals();
  const value = ethers.parseUnits(String(amount), decimals);

  const tx = await contract.transfer(to, value);
  const receipt = await tx.wait();

  return {
    token: "DKHYR",
    to,
    amount,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? "success" : "failed",
  };
}

export async function handleTokenInfo() {
  const [name, symbol, decimals, supply] = await Promise.all([
    contract.name(),
    contract.symbol(),
    contract.decimals(),
    contract.totalSupply(),
  ]);

  return {
    name,
    symbol,
    decimals,
    totalSupply: ethers.formatUnits(supply, decimals),
    contract: DKHYR_ADDRESS,
  };
}
