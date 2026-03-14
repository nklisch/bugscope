import { mkdirSync } from "node:fs";
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
import { parseToolGroups, type ToolGroup } from "./tool-groups.js";
import { registerBrowserTools } from "./tools/browser.js";
import { registerTools } from "./tools/index.js";

export interface McpServerOptions {
	toolGroups?: Set<ToolGroup>;
}

/**
 * Create, configure, and start the MCP server on stdio.
 * Resolves when the transport disconnects.
 */
export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
	const toolGroups = options.toolGroups ?? parseToolGroups(process.env.KROMETRAIL_TOOLS);

	registerAllAdapters();
	registerAllDetectors();

	const server = new McpServer({
		name: "krometrail",
		version: "0.1.0",
	});

	let sessionManager: ReturnType<typeof createSessionManager> | undefined;
	if (toolGroups.has("debug")) {
		sessionManager = createSessionManager();
		registerTools(server, sessionManager);
	}

	let browserDb: BrowserDatabase | undefined;
	if (toolGroups.has("browser")) {
		const browserDataDir = process.env.KROMETRAIL_BROWSER_DATA_DIR ?? resolve(homedir(), ".krometrail", "browser");
		mkdirSync(browserDataDir, { recursive: true });
		browserDb = new BrowserDatabase(resolve(browserDataDir, "index.db"));
		const browserQueryEngine = new QueryEngine(browserDb, browserDataDir);
		registerBrowserTools(server, browserQueryEngine);
	}

	setupGracefulShutdown(() => {
		browserDb?.close();
		return sessionManager?.disposeAll() ?? Promise.resolve();
	});

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

// When run directly (bun run src/mcp/index.ts), start with env-based config
startMcpServer();
