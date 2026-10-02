#!/usr/bin/env node
/**
 * NOVA — Official Bybit MCP Probe (read-only)
 *
 * Purpose: prove we can start the official trading-mcp, connect over stdio,
 * list its tools, and call one harmless query tool.
 *
 * This does NOT touch bridge.js, does NOT execute trades, does NOT read NOVA's vault.
 * It uses the credentials from ~/nova_mcp/.env directly so we can isolate failures.
 *
 * Usage:
 *   cd ~/nova_mcp
 *   node scripts/probe_official_mcp.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 1. Load credentials from nova_mcp/.env (no dotenv dependency needed) ──
const envPath = resolve(__dirname, '..', '.env');
if (!existsSync(envPath)) {
  console.error(`❌ Missing .env at ${envPath}`);
  process.exit(1);
}

const envFromFile = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const BYBIT_API_KEY = envFromFile.BYBIT_API_KEY;
const BYBIT_API_SECRET = envFromFile.BYBIT_API_SECRET;

if (!BYBIT_API_KEY || !BYBIT_API_SECRET) {
  console.error('❌ BYBIT_API_KEY or BYBIT_API_SECRET missing in .env');
  process.exit(1);
}

// ── 2. Locate the official trading-mcp entrypoint ──
const TRADING_MCP = process.env.TRADING_MCP_PATH
  || '/home/nova/trading-mcp/dist/index.js';

if (!existsSync(TRADING_MCP)) {
  console.error(`❌ Official trading-mcp not found at ${TRADING_MCP}`);
  console.error(`   Set TRADING_MCP_PATH env var to override.`);
  process.exit(1);
}

console.log('═══════════════════════════════════════════════');
console.log('  NOVA — Official MCP Probe');
console.log('═══════════════════════════════════════════════');
console.log(`  trading-mcp : ${TRADING_MCP}`);
console.log(`  api key     : ${BYBIT_API_KEY.slice(0, 8)}…`);
console.log('');

// ── 3. Create the client and stdio transport ──
const client = new Client(
  { name: 'nova-mcp-probe', version: '0.1.0' },
  { capabilities: {} }
);

const transport = new StdioClientTransport({
  command: 'node',
  args: [TRADING_MCP],
  env: {
    ...process.env,
    BYBIT_API_KEY,
    BYBIT_API_SECRET,
  },
  stderr: 'inherit',   // let official MCP logs flow to our terminal
});

// ── 4. Connect ──
console.log('▶ Connecting to official trading-mcp over stdio…');
try {
  await client.connect(transport);
} catch (err) {
  console.error('❌ Failed to connect:', err.message);
  process.exit(1);
}

const server = client.getServerVersion?.();
const caps = client.getServerCapabilities?.();
console.log('✅ Connected');
console.log(`   server : ${server?.name ?? 'unknown'} ${server?.version ?? ''}`);
console.log(`   caps   : ${JSON.stringify(caps ?? {}, null, 0)}`);
console.log('');

// ── 5. listTools ──
console.log('▶ Calling listTools()…');
let tools = [];
try {
  const res = await client.listTools();
  tools = res.tools || [];
  console.log(`✅ ${tools.length} tools discovered\n`);
} catch (err) {
  console.error('❌ listTools failed:', err.message);
  await transport.close();
  process.exit(1);
}

// ── 6. Print names + descriptions (name-first, truncated descriptions) ──
console.log('─── Tools ─────────────────────────────────────');
for (const t of tools) {
  const name = t.name || '(unnamed)';
  const desc = (t.description || '').replace(/\s+/g, ' ').slice(0, 80);
  const hints = t.annotations || {};
  const flags = [];
  if (hints.readOnlyHint) flags.push('readOnly');
  if (hints.destructiveHint) flags.push('destructive');
  if (hints.idempotentHint) flags.push('idempotent');
  if (hints.openWorldHint) flags.push('openWorld');
  const flagStr = flags.length ? `  [${flags.join(',')}]` : '';
  console.log(`  • ${name}${flagStr}`);
  if (desc) console.log(`      ${desc}`);
}
console.log('');

// ── 7. Optional — pick a harmless read-only tool and call it ──
// Heuristic: first tool with readOnlyHint that looks like a market/query tool.
const READONLY_NAME_HINTS = ['ticker', 'price', 'market', 'instrument', 'time', 'info', 'server'];
const safeTool = tools.find(t => {
  const n = (t.name || '').toLowerCase();
  const isReadOnly = t.annotations?.readOnlyHint === true;
  const looksQuery = READONLY_NAME_HINTS.some(h => n.includes(h));
  return isReadOnly || looksQuery;
});

if (!safeTool) {
  console.log('ℹ️  No obvious read-only tool to call. Skipping callTool().');
} else {
  console.log(`▶ Calling read-only tool: ${safeTool.name}`);
  try {
    // Best-effort args — start empty, many query tools accept none.
    const call = await client.callTool({
      name: safeTool.name,
      arguments: {},
    });
    const out = JSON.stringify(call, null, 2);
    console.log('✅ callTool returned:');
    console.log(out.length > 2000 ? out.slice(0, 2000) + '\n… (truncated)' : out);
  } catch (err) {
    console.error(`⚠️  callTool(${safeTool.name}) failed: ${err.message}`);
    console.error('   This may be expected if the tool needs parameters.');
  }
}

// ── 8. Clean shutdown ──
console.log('\n▶ Closing transport…');
await transport.close();
console.log('✅ Done.');
process.exit(0);
