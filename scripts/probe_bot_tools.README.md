# Bot Tools Probe

**Date:** 2026-10-02
**Status:** Working

Probes the official Bybit MCP for bot-family tools (grid, DCA, FMart,
Combo, and their close/query counterparts). Read-only discovery —
does not create or close any bot.

## Tool families covered

- Grid (spot):    createGridBot, validateGridInput, queryGridDetail, closeGridBot
- DCA:            createDCABot, closeDCABot
- Futures grid:   createFGridBot, validateGridInput, closeFGridBot
- Futures Mart:   createFMartBot, closeFMartBot
- Combo:          createComboBot, closeComboBot

## Purpose

Establishes the exact tool names and argument shapes we will wrap in
the Phase 2 NOVA Bridge MCP adapter. Not a runtime component — a
discovery probe.

## Notes for Phase 2

- validateGridInput is read-only and safe to call from the LLM without approval.
- createGridBot, createDCABot, createFGridBot, createFMartBot, createComboBot
  are all marked destructiveHint: true by the official MCP. They MUST
  require confirm:true at the bridge.
- closeGridBot and family are also destructiveHint: true — same treatment.
- queryGridDetail requires an existing grid ID. Add it to evals as a
  fixture-dependent test once a grid is created.

## How to run

    cd ~/nova_mcp
    TRADING_MCP_PATH="$(npm root -g)/bybit-official-trading-server/dist/index.js" \
      node scripts/probe_bot_tools.mjs
