import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllAdapters } from "../adapters/registry.js";
import { createSessionManager } from "../core/session-manager.js";
import { setupGracefulShutdown } from "../core/shutdown.js";
import { registerAllDetectors } from "../frameworks/index.js";
import { registerTools } from "./tools/index.js";

registerAllAdapters();
registerAllDetectors();
const sessionManager = createSessionManager();

const server = new McpServer({
	name: "agent-lens",
	version: "0.1.0",
});

registerTools(server, sessionManager);
setupGracefulShutdown(() => sessionManager.disposeAll());

const transport = new StdioServerTransport();
await server.connect(transport);
