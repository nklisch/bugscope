import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Create an MCP client connected to the krometrail server via stdio.
 * Spawns the server as a child process for e2e testing.
 */
export async function createTestClient(): Promise<{
	client: Client;
	cleanup: () => Promise<void>;
}> {
	const transport = new StdioClientTransport({
		command: "bun",
		args: ["run", "src/mcp/index.ts"],
	});

	const client = new Client({ name: "krometrail-test", version: "1.0.0" }, { capabilities: {} });

	await client.connect(transport);

	const cleanup = async () => {
		await client.close();
	};

	return { client, cleanup };
}

/**
 * Call an MCP tool and return the text content.
 * Throws if the tool returns an error.
 */
export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
	const result = await client.callTool({ name, arguments: args });

	const content = result.content as Array<{ type: string; text?: string }>;

	if (result.isError) {
		const text = content
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("\n");
		throw new Error(`Tool '${name}' returned error: ${text}`);
	}

	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}
