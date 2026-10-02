# Official MCP Probe — Phase 1 Result

**Date:** 2026-10-02
**Status:** ✅ PASSED

## What it proves

The NOVA stack can start the official Bybit trading MCP server, complete
the MCP handshake over stdio, discover its tools, and call a read-only
tool successfully — all without touching the existing `bridge.js` or
`bybit_direct.js` paths.

## Chain verified

    NOVA probe → MCP Client → stdio → trading-mcp → Bybit → response

## Key facts

- **Entry point:** /home/nova/.config/nvm/versions/node/v20.20.0/lib/node_modules/bybit-official-trading-server/dist/index.js
- **Server version:** trading-mcp 2.1.22
- **Tools discovered:** 384
- **Auth method:** HMAC-SHA256
- **Read-only test:** getAccountInfo returned retCode: 0, account mode REGULAR_MARGIN

## Notes for Phase 2

1. The MCP refuses to start on old versions. Pin to 2.1.22 or newer.
   If you see "Upgrade Required" it means the installed server is behind
   the current minimum. Fix with: npm install -g bybit-official-trading-server@latest

2. `stderr: 'inherit'` in StdioClientTransport is required for the
   version banner to appear on the terminal. Without it you see only
   "Connection closed" with no explanation.

3. Tools are annotated with hints: `readOnlyHint`, `destructiveHint`,
   `idempotentHint`, `openWorldHint`. Use these for policy gating in
   Phase 2. Never call a `destructiveHint` tool from the LLM without
   explicit approval.

4. `getAccountInfo` is a safe read-only tool. Use it as a health check
   in the bridge adapter.

## Known-good tool for the bridge adapter health check

- getAccountInfo  [readOnly,openWorld]
- getServerTime   [readOnly,openWorld]
- getTickers      [readOnly,openWorld] with {category: "spot", symbol: "BTCUSDT"}

## Next — Phase 2 (not started)

Phase 2 = NOVA Bridge adapter:
- Resolve tenant credentials from vault
- Create StdioClientTransport per call (or pool)
- Call the requested MCP tool
- Normalize the result
- Record a NOVA audit entry
- Keep the existing `bybit_direct.js` path intact alongside MCP

Do NOT touch `bridge.js` until Phase 2 design is settled and the
allowlist policy for destructive tools is defined.
