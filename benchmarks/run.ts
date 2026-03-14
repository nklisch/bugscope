#!/usr/bin/env bun
/**
 * Krometrail Performance Benchmark Suite
 *
 * Measures tokens/session, actions-to-diagnosis, and per-tool latency.
 * Run with: bun run benchmarks/run.ts
 */

import { resolve } from "node:path";
import { registerAllAdapters } from "../src/adapters/registry.js";
import { estimateTokens } from "../src/core/compression.js";
import { createSessionManager } from "../src/core/session-manager.js";

registerAllAdapters();

// --- Types ---

interface BenchmarkScenario {
	name: string;
	language: string;
	command: string;
	fixture: string;
	actions: BenchmarkAction[];
}

type BenchmarkAction =
	| { type: "launch"; breakpoints: Array<{ file: string; line: number }> }
	| { type: "continue" }
	| { type: "step"; direction: "over" | "into" | "out"; count?: number }
	| { type: "evaluate"; expression: string }
	| { type: "variables" }
	| { type: "stop" };

interface BenchmarkResult {
	scenario: string;
	language: string;
	totalViewportTokens: number;
	viewportCount: number;
	avgTokensPerViewport: number;
	actionCount: number;
	actionLatencies: Array<{ action: string; latencyMs: number }>;
	avgLatencyMs: number;
	totalTimeMs: number;
	success: boolean;
	error?: string;
}

// --- Fixtures ---

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");
const DISCOUNT_BUG = resolve(import.meta.dirname, "../tests/fixtures/python/discount-bug.py");
const DEEP_STACK = resolve(FIXTURES_DIR, "deep-stack.py");
const LONG_LOOP = resolve(FIXTURES_DIR, "long-loop.py");

const SCENARIOS: BenchmarkScenario[] = [
	{
		name: "discount-bug-10-actions",
		language: "python",
		command: `python3 ${DISCOUNT_BUG}`,
		fixture: DISCOUNT_BUG,
		actions: [
			{ type: "launch", breakpoints: [{ file: DISCOUNT_BUG, line: 13 }] },
			{ type: "continue" },
			{ type: "step", direction: "into" },
			{ type: "evaluate", expression: "discount" },
			{ type: "evaluate", expression: "tier" },
			{ type: "evaluate", expression: "tier_multipliers" },
			{ type: "step", direction: "out" },
			{ type: "continue" },
			{ type: "variables" },
			{ type: "stop" },
		],
	},
	{
		name: "deep-stack-inspection",
		language: "python",
		command: `python3 ${DEEP_STACK}`,
		fixture: DEEP_STACK,
		actions: [{ type: "launch", breakpoints: [{ file: DEEP_STACK, line: 4 }] }, { type: "continue" }, { type: "variables" }, { type: "stop" }],
	},
	{
		name: "simple-loop-10-steps",
		language: "python",
		command: `python3 ${LONG_LOOP}`,
		fixture: LONG_LOOP,
		actions: [
			{ type: "launch", breakpoints: [{ file: LONG_LOOP, line: 10 }] },
			{ type: "continue" },
			{ type: "step", direction: "over" },
			{ type: "step", direction: "over" },
			{ type: "step", direction: "over" },
			{ type: "step", direction: "over" },
			{ type: "step", direction: "over" },
			{ type: "variables" },
			{ type: "continue" },
			{ type: "stop" },
		],
	},
];

// --- Runner ---

async function runScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
	const sessionManager = createSessionManager();
	const actionLatencies: Array<{ action: string; latencyMs: number }> = [];
	let totalViewportTokens = 0;
	let viewportCount = 0;
	let sessionId: string | null = null;
	const startTime = performance.now();

	try {
		for (const action of scenario.actions) {
			const t0 = performance.now();

			if (action.type === "launch") {
				const result = await sessionManager.launch({
					command: scenario.command,
					language: scenario.language,
					breakpoints: action.breakpoints.map((bp) => ({
						file: bp.file,
						breakpoints: [{ line: bp.line }],
					})),
				});
				sessionId = result.sessionId;
				if (result.viewport) {
					totalViewportTokens += estimateTokens(result.viewport);
					viewportCount++;
				}
			} else if (action.type === "continue" && sessionId) {
				const viewport = await sessionManager.continue(sessionId, 15_000);
				if (viewport) {
					totalViewportTokens += estimateTokens(viewport);
					viewportCount++;
				}
			} else if (action.type === "step" && sessionId) {
				const viewport = await sessionManager.step(sessionId, action.direction, action.count);
				if (viewport) {
					totalViewportTokens += estimateTokens(viewport);
					viewportCount++;
				}
			} else if (action.type === "evaluate" && sessionId) {
				const result = await sessionManager.evaluate(sessionId, action.expression);
				totalViewportTokens += estimateTokens(result);
				viewportCount++;
			} else if (action.type === "variables" && sessionId) {
				const result = await sessionManager.getVariables(sessionId);
				totalViewportTokens += estimateTokens(result);
				viewportCount++;
			} else if (action.type === "stop" && sessionId) {
				await sessionManager.stop(sessionId);
				sessionId = null;
			}

			const latencyMs = performance.now() - t0;
			actionLatencies.push({ action: action.type, latencyMs });
		}

		const totalTimeMs = performance.now() - startTime;
		const avgLatencyMs = actionLatencies.reduce((s, a) => s + a.latencyMs, 0) / actionLatencies.length;

		return {
			scenario: scenario.name,
			language: scenario.language,
			totalViewportTokens,
			viewportCount,
			avgTokensPerViewport: viewportCount > 0 ? Math.round(totalViewportTokens / viewportCount) : 0,
			actionCount: scenario.actions.length,
			actionLatencies,
			avgLatencyMs: Math.round(avgLatencyMs),
			totalTimeMs: Math.round(totalTimeMs),
			success: true,
		};
	} catch (err) {
		if (sessionId) {
			try {
				await sessionManager.stop(sessionId);
			} catch {}
		}
		return {
			scenario: scenario.name,
			language: scenario.language,
			totalViewportTokens,
			viewportCount,
			avgTokensPerViewport: 0,
			actionCount: scenario.actions.length,
			actionLatencies,
			avgLatencyMs: 0,
			totalTimeMs: Math.round(performance.now() - startTime),
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

function formatBenchmarkTable(results: BenchmarkResult[]): string {
	const lines: string[] = ["# Krometrail Benchmark Results", ""];
	lines.push(`${"Scenario".padEnd(36)} ${"Lang".padEnd(8)} ${"Actions".padEnd(8)} ${"Tokens".padEnd(8)} ${"Tok/View".padEnd(9)} ${"Avg ms".padEnd(8)} ${"Total ms".padEnd(10)} Status`);
	lines.push("-".repeat(105));

	for (const r of results) {
		const status = r.success ? "OK" : `FAIL: ${r.error?.slice(0, 40)}`;
		lines.push(
			`${r.scenario.padEnd(36)} ${r.language.padEnd(8)} ${String(r.actionCount).padEnd(8)} ${String(r.totalViewportTokens).padEnd(8)} ${String(r.avgTokensPerViewport).padEnd(9)} ${String(r.avgLatencyMs).padEnd(8)} ${String(r.totalTimeMs).padEnd(10)} ${status}`,
		);
	}

	lines.push("");
	lines.push("## Per-Action Latencies");
	for (const r of results) {
		if (r.success) {
			lines.push(`\n### ${r.scenario}`);
			for (const a of r.actionLatencies) {
				lines.push(`  ${a.action.padEnd(12)} ${String(Math.round(a.latencyMs)).padStart(6)} ms`);
			}
		}
	}

	return lines.join("\n");
}

// --- Main ---

async function main() {
	console.log("Running Krometrail benchmarks...\n");

	const results: BenchmarkResult[] = [];
	for (const scenario of SCENARIOS) {
		process.stdout.write(`  Running: ${scenario.name} ... `);
		const result = await runScenario(scenario);
		results.push(result);
		if (result.success) {
			process.stdout.write(`OK (${result.totalViewportTokens} tokens, ${result.totalTimeMs}ms)\n`);
		} else {
			process.stdout.write(`SKIP: ${result.error?.slice(0, 60)}\n`);
		}
	}

	console.log("");
	console.log(formatBenchmarkTable(results));

	// Write JSON results
	const resultsPath = resolve(import.meta.dirname, "results.json");
	await Bun.write(resultsPath, JSON.stringify(results, null, 2));
	console.log(`\nResults written to: ${resultsPath}`);
}

main().catch((err) => {
	console.error("Benchmark failed:", err);
	process.exit(1);
});
