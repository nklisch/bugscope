import { registerDriver } from "../lib/agents.js";
import type { AgentDriver, AgentMetrics, AgentRunOptions, AgentRunResult } from "../lib/config.js";
import { spawnCapture } from "../lib/spawn.js";

/**
 * Format a stream-json event as a compact log line.
 */
function formatEvent(data: Record<string, unknown>): string | null {
	switch (data.type) {
		case "system":
			if (data.subtype === "init") return `[init] model=${data.model} tools=${(data.tools as string[])?.length ?? 0}`;
			return null;
		case "assistant": {
			const msg = data.message as { content?: Array<{ type: string; text?: string; name?: string }> } | undefined;
			for (const block of msg?.content ?? []) {
				if (block.type === "tool_use" && block.name) return `[tool] ${block.name}`;
				if (block.type === "text" && block.text) {
					const preview = block.text.slice(0, 120).replace(/\n/g, " ");
					return `[text] ${preview}${block.text.length > 120 ? "…" : ""}`;
				}
			}
			return null;
		}
		case "result":
			return `[done] turns=${data.num_turns} cost=$${data.cost_usd ?? "?"}`;
		default:
			return null;
	}
}

/**
 * Parse metrics from Claude Code stream-json output.
 */
function parseClaudeMetrics(stdout: string): Partial<AgentMetrics> {
	const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
	let model: string | null = null;
	const toolCalls: Record<string, number> = {};

	for (const line of lines) {
		try {
			const data = JSON.parse(line) as Record<string, unknown>;

			if (data.type === "system" && data.subtype === "init" && typeof data.model === "string") {
				model = data.model;
			}

			if (data.type === "assistant" && data.message) {
				const msg = data.message as { content?: Array<{ type: string; name?: string }> };
				for (const block of msg.content ?? []) {
					if (block.type === "tool_use" && block.name) {
						toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
					}
				}
			}

			if (data.type === "result") {
				const usage = data.usage as Record<string, number> | undefined;
				const cost = typeof data.total_cost_usd === "number" ? data.total_cost_usd : typeof data.cost_usd === "number" ? data.cost_usd : null;
				return {
					costUsd: cost,
					numTurns: typeof data.num_turns === "number" ? data.num_turns : null,
					tokensInput: usage?.input_tokens ?? null,
					tokensOutput: usage?.output_tokens ?? null,
					model,
					toolCalls,
				};
			}
		} catch {
			// Skip malformed lines
		}
	}

	return { model, toolCalls };
}

const claudeCode: AgentDriver = {
	name: "claude-code",

	async available() {
		try {
			const result = await spawnCapture("claude", ["--version"]);
			return result.exitCode === 0;
		} catch {
			return false;
		}
	},

	async version() {
		try {
			const result = await spawnCapture("claude", ["--version"]);
			return result.stdout.trim().split("\n")[0] ?? "unknown";
		} catch {
			return "unknown";
		}
	},

	async run(options: AgentRunOptions): Promise<AgentRunResult> {
		const start = Date.now();
		const args: string[] = ["-p", options.prompt, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"];

		if (options.skillContent) {
			args.push("--append-system-prompt", options.skillContent);
		}

		if (options.maxBudgetUsd !== undefined) {
			args.push("--max-budget-usd", String(options.maxBudgetUsd));
		}

		const sessionLog: string[] = [];

		const result = await spawnCapture("claude", args, {
			cwd: options.workDir,
			env: options.env,
			timeoutMs: options.timeoutMs,
			cleanEnv: true,
			onStdoutLine(line) {
				try {
					const data = JSON.parse(line) as Record<string, unknown>;
					const formatted = formatEvent(data);
					if (formatted) {
						sessionLog.push(formatted);
						console.error(`  claude-code │ ${formatted}`);
					}
				} catch {
					// not JSON, ignore
				}
			},
		});

		return {
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			timedOut: result.timedOut,
			durationMs: Date.now() - start,
			sessionLog,
		};
	},

	parseMetrics(result: AgentRunResult): AgentMetrics {
		const parsed = parseClaudeMetrics(result.stdout);
		return {
			costUsd: parsed.costUsd ?? null,
			numTurns: parsed.numTurns ?? null,
			tokensInput: parsed.tokensInput ?? null,
			tokensOutput: parsed.tokensOutput ?? null,
			model: parsed.model ?? null,
			agentVersion: null,
			toolCalls: parsed.toolCalls ?? {},
		};
	},
};

registerDriver(() => claudeCode);
