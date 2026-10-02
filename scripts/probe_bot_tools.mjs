import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MCP = process.env.TRADING_MCP_PATH;

if (!MCP) {
  throw new Error("TRADING_MCP_PATH is not set");
}

const client = new Client({
  name: "nova-bot-probe",
  version: "1.0.0",
});

const transport = new StdioClientTransport({
  command: "node",
  args: [MCP],
  env: {
    ...process.env,
  },
});

await client.connect(transport);

const { tools } = await client.listTools();

const wanted = [
  "validateGridInput",
  "createGridBot",
  "createDCABot",
  "createFGridBot",
  "createFMartBot",
  "createComboBot",
  "queryGridDetail",
  "closeGridBot",
  "closeDCABot",
  "closeFGridBot",
];

for (const name of wanted) {
  const tool = tools.find(t => t.name === name);

  console.log("\n==================================================");
  console.log(name);

  if (!tool) {
    console.log("NOT FOUND");
    continue;
  }

  console.log("description:", tool.description || "");
  console.log("inputSchema:");
  console.log(JSON.stringify(tool.inputSchema, null, 2));
  console.log("annotations:");
  console.log(JSON.stringify(tool.annotations || {}, null, 2));
}

await transport.close();
