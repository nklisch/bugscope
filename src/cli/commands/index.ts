import { resolve as resolvePath } from "node:path";
import { defineCommand } from "citty";
import { listAdapters, registerAllAdapters } from "../../adapters/registry.js";
import { configToOptions, listConfigurations, parseLaunchJson } from "../../core/launch-json.js";
import { DaemonClient, ensureDaemon } from "../../daemon/client.js";
import type { BreakpointsListPayload, BreakpointsResultPayload, LaunchResultPayload, StatusResultPayload, StopResultPayload, ThreadInfoPayload, ViewportPayload } from "../../daemon/protocol.js";
import { STEP_DIRECTIONS, type StepDirection } from "../../core/enums.js";
import { getDaemonSocketPath } from "../../daemon/protocol.js";
import { listDetectors, registerAllDetectors } from "../../frameworks/index.js";

// Register adapters/detectors so we can derive descriptions from the live registry.
// Adapter instantiation is lightweight (no side effects until launch/attach is called).
registerAllAdapters();
registerAllDetectors();

function languageDescription(prefix = "Language"): string {
	const parts = listAdapters().map((a) => [a.id, ...(a.aliases ?? [])].join("/"));
	return `${prefix}. Supported: ${parts.join(", ")}`;
}

function frameworkDescription(): string {
	const ids = listDetectors().map((d) => d.id);
	return `Override framework auto-detection. Known: ${ids.join(", ")}. Use 'none' to disable.`;
}

import {
	formatBreakpointsList,
	formatBreakpointsSet,
	formatError,
	formatEvaluate,
	formatLaunch,
	formatStackTrace,
	formatStatus,
	formatStop,
	formatVariables,
	formatViewport,
	formatWatchExpressions,
	resolveOutputMode,
} from "../format.js";
import { parseBreakpointString, parseLocation, parseSourceRange } from "../parsers.js";

// --- Shared Args ---

const globalArgs = {
	json: {
		type: "boolean" as const,
		description: "Output as JSON instead of viewport text",
		default: false,
	},
	quiet: {
		type: "boolean" as const,
		description: "Viewport only, no banners or hints",
		default: false,
	},
	session: {
		type: "string" as const,
		description: "Target a specific session (required when multiple active)",
		alias: "s",
	},
};

type OutputMode = "text" | "json" | "quiet";

/**
 * Helper: create a DaemonClient, ensuring daemon is running first.
 */
async function getClient(): Promise<DaemonClient> {
	const socketPath = getDaemonSocketPath();
	await ensureDaemon(socketPath);
	return new DaemonClient({ socketPath, requestTimeoutMs: 60_000 });
}

/**
 * Helper: resolve session ID. If --session is provided, use it.
 * Otherwise, call daemon.sessions to auto-resolve if exactly one session exists.
 */
async function resolveSessionId(client: DaemonClient, explicitSession?: string): Promise<string> {
	if (explicitSession) {
		return explicitSession;
	}

	const sessions = await client.call<Array<{ id: string; status: string; language: string; actionCount: number }>>("daemon.sessions");

	if (sessions.length === 0) {
		throw new Error('No active sessions. Launch one with: agent-lens launch "<command>"');
	}

	if (sessions.length === 1) {
		return sessions[0].id;
	}

	const sessionList = sessions.map((s) => `  ${s.id} (${s.language}, ${s.status})`).join("\n");
	throw new Error(`Multiple active sessions. Use --session to specify one:\n${sessionList}`);
}

/**
 * Helper: wrap a CLI command with standard mode resolution, client lifecycle,
 * session resolution, error handling, and cleanup.
 *
 * For commands that don't need a session ID upfront (e.g. launch), pass
 * `{ needsSession: false }` and the handler receives `null` as sessionId.
 */
async function runCommand(
	args: { json?: boolean; quiet?: boolean; session?: string },
	handler: (client: DaemonClient, sessionId: string, mode: OutputMode) => Promise<void>,
	opts?: { needsSession: false },
): Promise<void>;
async function runCommand(args: { json?: boolean; quiet?: boolean; session?: string }, handler: (client: DaemonClient, sessionId: string, mode: OutputMode) => Promise<void>): Promise<void>;
async function runCommand(
	args: { json?: boolean; quiet?: boolean; session?: string },
	handler: (client: DaemonClient, sessionId: string, mode: OutputMode) => Promise<void>,
	opts?: { needsSession?: false },
): Promise<void> {
	const mode = resolveOutputMode(args) as OutputMode;
	const client = await getClient();
	try {
		const sessionId = opts?.needsSession === false ? "" : await resolveSessionId(client, args.session);
		await handler(client, sessionId, mode);
	} catch (err) {
		process.stderr.write(`${formatError(err as Error, mode)}\n`);
		process.exit(1);
	} finally {
		client.dispose();
	}
}

// --- Session Lifecycle ---

export const launchCommand = defineCommand({
	meta: { name: "launch", description: "Launch a debug session" },
	args: {
		command: {
			type: "positional",
			description: "Command to debug, e.g. 'python app.py' or 'pytest tests/'",
			required: false,
		},
		break: {
			type: "string",
			description: "Set breakpoint(s), e.g. 'order.py:147' or 'order.py:147 when discount < 0'",
			alias: "b",
		},
		language: {
			type: "string",
			description: languageDescription("Override language detection"),
		},
		framework: {
			type: "string",
			description: frameworkDescription(),
		},
		"stop-on-entry": {
			type: "boolean",
			description: "Pause on first executable line",
			default: false,
		},
		config: {
			type: "string",
			description: "Path to launch.json file (default: .vscode/launch.json)",
		},
		"config-name": {
			type: "string",
			description: "Name of the configuration to use from launch.json",
			alias: "C",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(
			args,
			async (client, _sessionId, mode) => {
				const breakpoints = args.break ? [parseBreakpointString(args.break)] : undefined;

				if (args.config || args["config-name"]) {
					// Load from launch.json
					const configPath = args.config ? resolvePath(args.config) : resolvePath(process.cwd(), ".vscode/launch.json");
					const launchJson = await parseLaunchJson(configPath);
					if (!launchJson) {
						throw new Error(`launch.json not found at: ${configPath}`);
					}

					let configEntry: (typeof launchJson.configurations)[0];
					if (args["config-name"]) {
						const found = launchJson.configurations.find((c) => c.name === args["config-name"]);
						if (!found) {
							const available = listConfigurations(launchJson)
								.map((c) => `  "${c.name}"`)
								.join("\n");
							throw new Error(`Configuration "${args["config-name"]}" not found. Available:\n${available}`);
						}
						configEntry = found;
					} else {
						if (launchJson.configurations.length === 1) {
							configEntry = launchJson.configurations[0];
						} else {
							const available = listConfigurations(launchJson)
								.map((c) => `  "${c.name}"`)
								.join("\n");
							throw new Error(`Multiple configurations found. Use --config-name to select one:\n${available}`);
						}
					}

					const converted = configToOptions(configEntry, process.cwd());
					if (converted.type === "attach") {
						const result = await client.call<LaunchResultPayload>("session.attach", {
							language: args.language ?? converted.options.language,
							pid: converted.options.pid,
							port: converted.options.port,
							host: converted.options.host,
							breakpoints: breakpoints?.map((fb) => ({ file: fb.file, breakpoints: fb.breakpoints })),
						});
						process.stdout.write(`${formatLaunch(result, mode)}\n`);
					} else {
						const result = await client.call<LaunchResultPayload>("session.launch", {
							command: args.command ?? converted.options.command,
							language: args.language ?? converted.options.language,
							framework: args.framework,
							breakpoints: breakpoints?.map((fb) => ({ file: fb.file, breakpoints: fb.breakpoints })),
							stopOnEntry: args["stop-on-entry"],
							cwd: converted.options.cwd,
							env: converted.options.env,
						});
						process.stdout.write(`${formatLaunch(result, mode)}\n`);
					}
				} else {
					if (!args.command) {
						throw new Error('Usage: agent-lens launch "<command>" or agent-lens launch --config-name "<name>"');
					}
					const result = await client.call<LaunchResultPayload>("session.launch", {
						command: args.command,
						language: args.language,
						framework: args.framework,
						breakpoints: breakpoints?.map((fb) => ({
							file: fb.file,
							breakpoints: fb.breakpoints,
						})),
						stopOnEntry: args["stop-on-entry"],
					});
					process.stdout.write(`${formatLaunch(result, mode)}\n`);
				}
			},
			{ needsSession: false },
		);
	},
});

export const stopCommand = defineCommand({
	meta: { name: "stop", description: "Terminate a debug session" },
	args: { ...globalArgs },
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<StopResultPayload>("session.stop", { sessionId });
			process.stdout.write(`${formatStop(result, sessionId, mode)}\n`);
		});
	},
});

export const statusCommand = defineCommand({
	meta: { name: "status", description: "Check session status" },
	args: { ...globalArgs },
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<StatusResultPayload>("session.status", { sessionId });
			process.stdout.write(`${formatStatus(result, mode)}\n`);
		});
	},
});

// --- Execution Control ---

export const continueCommand = defineCommand({
	meta: { name: "continue", description: "Resume execution to next breakpoint" },
	args: {
		timeout: {
			type: "string",
			description: "Max wait time in ms",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<ViewportPayload>("session.continue", {
				sessionId,
				timeoutMs: args.timeout ? Number.parseInt(args.timeout, 10) : undefined,
			});
			process.stdout.write(`${formatViewport(result.viewport, mode)}\n`);
		});
	},
});

export const stepCommand = defineCommand({
	meta: { name: "step", description: "Step execution (over, into, or out)" },
	args: {
		direction: {
			type: "positional",
			description: "Step direction: over, into, or out",
			required: true,
		},
		count: {
			type: "string",
			description: "Number of steps",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const direction = args.direction as StepDirection;
			if (!(STEP_DIRECTIONS as readonly string[]).includes(direction)) {
				throw new Error(`Invalid step direction: ${direction}. Must be 'over', 'into', or 'out'.`);
			}
			const result = await client.call<ViewportPayload>("session.step", {
				sessionId,
				direction,
				count: args.count ? Number.parseInt(args.count, 10) : undefined,
			});
			process.stdout.write(`${formatViewport(result.viewport, mode)}\n`);
		});
	},
});

export const runToCommand = defineCommand({
	meta: { name: "run-to", description: "Run to a specific file:line" },
	args: {
		location: {
			type: "positional",
			description: "Target location, e.g. 'order.py:150'",
			required: true,
		},
		timeout: {
			type: "string",
			description: "Max wait time in ms",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const { file, line } = parseLocation(args.location);
			const result = await client.call<ViewportPayload>("session.runTo", {
				sessionId,
				file,
				line,
				timeoutMs: args.timeout ? Number.parseInt(args.timeout, 10) : undefined,
			});
			process.stdout.write(`${formatViewport(result.viewport, mode)}\n`);
		});
	},
});

// --- Breakpoints ---

export const breakCommand = defineCommand({
	meta: {
		name: "break",
		description: "Set breakpoints, exception breakpoints, or clear breakpoints",
	},
	args: {
		breakpoint: {
			type: "positional",
			description: "Breakpoint spec: 'file:line[,line] [when cond] [hit cond] [log msg]'",
		},
		exceptions: {
			type: "string",
			description: "Set exception breakpoint filter (e.g. 'uncaught', 'raised')",
		},
		clear: {
			type: "string",
			description: "Clear all breakpoints in a file",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			if (args.exceptions) {
				await client.call("session.setExceptionBreakpoints", {
					sessionId,
					filters: [args.exceptions],
				});
				process.stdout.write(mode === "json" ? `${JSON.stringify({ filters: [args.exceptions] }, null, 2)}\n` : `Exception breakpoints set: ${args.exceptions}\n`);
			} else if (args.clear) {
				await client.call("session.setBreakpoints", {
					sessionId,
					file: args.clear,
					breakpoints: [],
				});
				process.stdout.write(mode === "json" ? `${JSON.stringify({ cleared: args.clear }, null, 2)}\n` : `Breakpoints cleared: ${args.clear}\n`);
			} else if (args.breakpoint) {
				const parsed = parseBreakpointString(args.breakpoint);
				const result = await client.call<BreakpointsResultPayload>("session.setBreakpoints", {
					sessionId,
					file: parsed.file,
					breakpoints: parsed.breakpoints,
				});
				process.stdout.write(`${formatBreakpointsSet(parsed.file, result, mode)}\n`);
			} else {
				throw new Error("Usage: agent-lens break <file:line> | --exceptions <filter> | --clear <file>");
			}
		});
	},
});

export const breakpointsCommand = defineCommand({
	meta: { name: "breakpoints", description: "List all active breakpoints" },
	args: { ...globalArgs },
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<BreakpointsListPayload>("session.listBreakpoints", { sessionId });
			process.stdout.write(`${formatBreakpointsList(result, mode)}\n`);
		});
	},
});

// --- State Inspection ---

export const evalCommand = defineCommand({
	meta: { name: "eval", description: "Evaluate an expression" },
	args: {
		expression: {
			type: "positional",
			description: "Expression to evaluate, e.g. 'cart.items[0].__dict__'",
			required: true,
		},
		frame: {
			type: "string",
			description: "Stack frame index (0 = current)",
		},
		depth: {
			type: "string",
			description: "Object expansion depth",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<string>("session.evaluate", {
				sessionId,
				expression: args.expression,
				frameIndex: args.frame ? Number.parseInt(args.frame, 10) : undefined,
				maxDepth: args.depth ? Number.parseInt(args.depth, 10) : undefined,
			});
			process.stdout.write(`${formatEvaluate(args.expression, result, mode)}\n`);
		});
	},
});

export const varsCommand = defineCommand({
	meta: { name: "vars", description: "Show variables" },
	args: {
		scope: {
			type: "string",
			description: "Variable scope: local, global, closure, or all",
		},
		filter: {
			type: "string",
			description: "Regex filter on variable names",
		},
		frame: {
			type: "string",
			description: "Stack frame index (0 = current)",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<string>("session.variables", {
				sessionId,
				scope: args.scope,
				frameIndex: args.frame ? Number.parseInt(args.frame, 10) : undefined,
				filter: args.filter,
			});
			process.stdout.write(`${formatVariables(result, mode)}\n`);
		});
	},
});

export const stackCommand = defineCommand({
	meta: { name: "stack", description: "Show call stack" },
	args: {
		frames: {
			type: "string",
			description: "Maximum frames to show",
		},
		source: {
			type: "boolean",
			description: "Include source context per frame",
			default: false,
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<string>("session.stackTrace", {
				sessionId,
				maxFrames: args.frames ? Number.parseInt(args.frames, 10) : undefined,
				includeSource: args.source,
			});
			process.stdout.write(`${formatStackTrace(result, mode)}\n`);
		});
	},
});

export const sourceCommand = defineCommand({
	meta: { name: "source", description: "View source code" },
	args: {
		target: {
			type: "positional",
			description: "File path, optionally with line range: 'file.py:15-30'",
			required: true,
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const { file, startLine, endLine } = parseSourceRange(args.target);
			const result = await client.call<string>("session.source", {
				sessionId,
				file,
				startLine,
				endLine,
			});
			if (mode === "json") {
				process.stdout.write(`${JSON.stringify({ file, source: result }, null, 2)}\n`);
			} else {
				process.stdout.write(`${result}\n`);
			}
		});
	},
});

// --- Session Intelligence ---

function collectExpressions(firstExpr: string, args: Record<string, unknown>): string[] {
	const extraArgs = args._ as string[] | undefined;
	return [firstExpr, ...(extraArgs ?? [])];
}

export const watchCommand = defineCommand({
	meta: { name: "watch", description: "Add watch expressions" },
	args: {
		expressions: {
			type: "positional",
			description: "Expression(s) to watch",
			required: true,
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const expressions = collectExpressions(args.expressions, args as Record<string, unknown>);
			const result = await client.call<string[]>("session.watch", { sessionId, expressions });
			process.stdout.write(`${formatWatchExpressions(result, mode)}\n`);
		});
	},
});

export const unwatchCommand = defineCommand({
	meta: { name: "unwatch", description: "Remove watch expressions" },
	args: {
		expressions: {
			type: "positional",
			description: "Expression(s) to stop watching",
			required: true,
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const expressions = collectExpressions(args.expressions, args as Record<string, unknown>);
			const result = await client.call<string[]>("session.unwatch", { sessionId, expressions });
			process.stdout.write(`${formatWatchExpressions(result, mode)}\n`);
		});
	},
});

export const logCommand = defineCommand({
	meta: { name: "log", description: "View session investigation log" },
	args: {
		detailed: {
			type: "boolean",
			description: "Show detailed log with timestamps",
			default: false,
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const result = await client.call<string>("session.sessionLog", {
				sessionId,
				format: args.detailed ? "detailed" : "summary",
			});
			if (mode === "json") {
				process.stdout.write(`${JSON.stringify({ log: result }, null, 2)}\n`);
			} else {
				process.stdout.write(`${result}\n`);
			}
		});
	},
});

export const outputCommand = defineCommand({
	meta: { name: "output", description: "View captured program output" },
	args: {
		stderr: {
			type: "boolean",
			description: "Show only stderr",
			default: false,
		},
		stdout: {
			type: "boolean",
			description: "Show only stdout",
			default: false,
		},
		"since-action": {
			type: "string",
			description: "Only show output since action N",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const stream = args.stderr ? "stderr" : args.stdout ? "stdout" : "both";
			const result = await client.call<string>("session.output", {
				sessionId,
				stream,
				sinceAction: args["since-action"] ? Number.parseInt(args["since-action"], 10) : undefined,
			});
			if (mode === "json") {
				process.stdout.write(`${JSON.stringify({ output: result, stream }, null, 2)}\n`);
			} else {
				process.stdout.write(result || "No output captured.\n");
			}
		});
	},
});

export const skillCommand = defineCommand({
	meta: { name: "skill", description: "Print the agent skill file to stdout" },
	args: {},
	async run() {
		const skillPath = new URL("../../../skill.md", import.meta.url);
		const content = await Bun.file(skillPath).text();
		process.stdout.write(content);
	},
});

// --- Attach ---

export const attachCommand = defineCommand({
	meta: { name: "attach", description: "Attach to a running process" },
	args: {
		language: {
			type: "string",
			description: languageDescription(),
			required: true,
		},
		pid: {
			type: "string",
			description: "Process ID",
		},
		port: {
			type: "string",
			description: "Debug server port",
		},
		host: {
			type: "string",
			description: "Debug server host",
		},
		break: {
			type: "string",
			description: "Set breakpoint(s), e.g. 'app.py:10'",
			alias: "b",
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(
			args,
			async (client, _sessionId, mode) => {
				const breakpoints = args.break ? [parseBreakpointString(args.break)] : undefined;
				const result = await client.call<LaunchResultPayload>("session.attach", {
					language: args.language,
					pid: args.pid ? Number.parseInt(args.pid, 10) : undefined,
					port: args.port ? Number.parseInt(args.port, 10) : undefined,
					host: args.host,
					breakpoints: breakpoints?.map((fb) => ({
						file: fb.file,
						breakpoints: fb.breakpoints,
					})),
				});
				if (mode === "json") {
					process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
				} else {
					process.stdout.write(`Session: ${result.sessionId}\nStatus: ${result.status}\nAttached to ${args.language} process.\n`);
				}
			},
			{ needsSession: false },
		);
	},
});

// --- Threads ---

export const threadsCommand = defineCommand({
	meta: { name: "threads", description: "List all threads in the debug session" },
	args: { ...globalArgs },
	async run({ args }) {
		await runCommand(args, async (client, sessionId, mode) => {
			const threads = await client.call<ThreadInfoPayload[]>("session.threads", { sessionId });
			if (mode === "json") {
				process.stdout.write(`${JSON.stringify(threads, null, 2)}\n`);
			} else {
				process.stdout.write(`Threads (${threads.length}):\n`);
				for (const t of threads) {
					process.stdout.write(`  ${t.stopped ? "→" : " "} Thread ${t.id}: ${t.name}${t.stopped ? " (stopped)" : " (running)"}\n`);
				}
			}
		});
	},
});

// --- Doctor (see doctor.ts) ---

export { doctorCommand } from "./doctor.js";
