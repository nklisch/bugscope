import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllAdapters } from "../adapters/registry.js";
import { QueryEngine } from "../browser/investigation/query-engine.js";
import { BrowserDatabase } from "../browser/storage/database.js";
import { createSessionManager } from "../core/session-manager.js";
import { setupGracefulShutdown } from "../core/shutdown.js";
import { registerAllDetectors } from "../frameworks/index.js";
import { registerBrowserTools } from "./tools/browser.js";
import { registerTools } from "./tools/index.js";

registerAllAdapters();
registerAllDetectors();
const sessionManager = createSessionManager();

const server = new McpServer({
	name: "agent-lens",
	version: "0.1.0",
});

registerTools(server, sessionManager);

// Browser investigation tools — instantiate QueryEngine pointing at the shared database.
// BrowserDatabase creates the file and schema if it doesn't exist, so this is always safe.
const browserDataDir = resolve(homedir(), ".agent-lens", "browser");
const browserDb = new BrowserDatabase(resolve(browserDataDir, "index.db"));
const browserQueryEngine = new QueryEngine(browserDb, browserDataDir);
registerBrowserTools(server, browserQueryEngine);

setupGracefulShutdown(() => {
	browserDb.close();
	return sessionManager.disposeAll();
});

const transport = new StdioServerTransport();
await server.connect(transport);
