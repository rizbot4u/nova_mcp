# Nova MCP Bridge (`nova_mcp`)

A unified AI tool-use orchestration gateway connecting Large Language Models (LLMs) to centralized exchanges (CEX) and decentralized Web3 EVM rails via the Model Context Protocol (MCP).

## Overview

The **Nova MCP Bridge** exposes a single, high-performance REST endpoint (`/skills/execute`) that routes AI agent actions to two core execution engines:
1. **Bybit CEX Trading Rail:** Powered by `trading-mcp` across 380+ trading and account skills.
2. **Base Mainnet EVM Rail:** Direct smart contract integration for ERC-20 token operations (`$DKHYR`).

---

## Key Features

- **Unified API Gateway:** Single interface (`/skills/execute`) handling both CEX order execution and Web3 smart contract interactions.
- **Sub-Second Latency:** Persistent process pooling via `StdioClientTransport` eliminating cold-start process overhead.
- **Address Checksum Resilience:** Built-in EIP-55 address sanitization and normalization using `ethers.js`.
- **JSON Audit Logging:** Real-time structured request/response logging (`/tmp/nova_mcp_logs/skill_calls.log`) for full execution traceability.
- **Interactive API Docs:** Built-in Swagger UI available at `/docs`.

---

## Tech Stack

- **Runtime:** Node.js / Express
- **Protocol:** Model Context Protocol (MCP) via `@modelcontextprotocol/sdk`
- **Web3 Libraries:** `ethers.js` (v6), Alchemy JSON-RPC Provider
- **Blockchain Target:** Base Mainnet (`0x9991bE994829601F90328CCF9cee4D1A55ADae70`)
- **CEX Engine:** Bybit V5 API (`trading-mcp`)

---

## License

MIT License
