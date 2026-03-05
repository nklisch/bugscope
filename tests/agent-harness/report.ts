#!/usr/bin/env bun
/**
 * Agent harness report generator.
 *
 * Reads result.json files from trace directories and produces a publishable
 * markdown report and machine-readable JSON report.
 *
 * Usage:
 *   bun run test:agent:report                        # latest trace dir
 *   bun run test:agent:report --dir .traces/2026-03  # specific dir
 *   bun run test:agent:report --format json          # JSON output only
 *   bun run test:agent:report --out report.md        # write to file
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunResult, TokenUsage } from "./lib/config.js";
import { getTracesDir } from "./lib/trace.js";

// --- CLI arg parsing ---

function parseArgs(): { dir?: string; format: "markdown" | "json"; out?: string } {
	const args = process.argv.slice(2);
	const get = (flag: string) => {
		const i = args.indexOf(flag);
		return i !== -1 ? args[i + 1] : undefined;
	};
	const format = get("--format") === "json" ? "json" : "markdown";
	return { dir: get("--dir"), format, out: get("--out") };
}

// --- Result loading ---

async function loadResults(suiteDir: string): Promise<RunResult[]> {
	const results: RunResult[] = [];
	let agents: string[] = [];

	try {
		const entries = await readdir(suiteDir, { withFileTypes: true });
		agents = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return results;
	}

	for (const agent of agents) {
		const agentDir = join(suiteDir, agent);
		let scenarios: string[] = [];
		try {
			const entries = await readdir(agentDir, { withFileTypes: true });
			scenarios = entries.filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			continue;
		}

		for (const scenario of scenarios) {
			const resultPath = join(agentDir, scenario, "result.json");
			try {
				const raw = await readFile(resultPath, "utf-8");
				results.push(JSON.parse(raw) as RunResult);
			} catch {
				// Missing or malformed — skip
			}
		}
	}

	return results;
}

async function findLatestSuiteDir(): Promise<string> {
	const tracesDir = getTracesDir();
	const entries = await readdir(tracesDir, { withFileTypes: true });
	const dirs = entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort()
		.reverse();

	if (dirs.length === 0) {
		throw new Error(`No trace directories found in ${tracesDir}. Run bun run test:agent first.`);
	}
	return join(tracesDir, dirs[0]);
}

// --- Formatting helpers ---

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(0)}s`;
}

function formatTokens(tokens: TokenUsage | null): string {
	if (!tokens) return "n/a";
	return `${(tokens.total / 1000).toFixed(1)}k`;
}

function toolCallSummary(toolCalls: Record<string, number>): string {
	if (!toolCalls || Object.keys(toolCalls).length === 0) return "—";
	return Object.entries(toolCalls)
		.sort((a, b) => b[1] - a[1])
		.map(([tool, count]) => {
			const short = tool.replace(/^mcp__agent-lens__debug_/, "").replace(/^debug_/, "");
			return count > 1 ? `${short}(${count})` : short;
		})
		.join(", ");
}

// --- Markdown report ---

function generateMarkdown(results: RunResult[], suiteDir: string): string {
	if (results.length === 0) {
		return "# Agent Lens — Agent Test Report\n\nNo results found.\n";
	}

	const agentLensVersion = results[0]?.agentLensVersion ?? "unknown";
	const date = results[0]?.timestamp.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

	// Per-agent summaries
	const agentMap = new Map<string, RunResult[]>();
	for (const r of results) {
		const list = agentMap.get(r.agent) ?? [];
		list.push(r);
		agentMap.set(r.agent, list);
	}

	const lines: string[] = [];

	lines.push("# Agent Lens — Agent Test Report");
	lines.push("");
	lines.push(`**Date:** ${date}  `);
	lines.push(`**Agent Lens version:** ${agentLensVersion}  `);
	lines.push(`**Trace directory:** \`${suiteDir}\``);
	lines.push("");

	// Summary table
	lines.push("## Summary");
	lines.push("");
	lines.push("| Agent | Model | Version | Scenarios | Passed | Pass Rate | Avg Duration | Avg Tokens |");
	lines.push("|-------|-------|---------|-----------|--------|-----------|--------------|------------|");
	for (const [agent, runs] of agentMap) {
		const passed = runs.filter((r) => r.passed).length;
		const model = runs.find((r) => r.metrics.model)?.metrics.model ?? "unknown";
		const agentVersion = runs.find((r) => r.metrics.agentVersion)?.metrics.agentVersion ?? "unknown";
		const avgDuration = runs.reduce((a, r) => a + r.durationMs, 0) / runs.length;
		const tokenRuns = runs.filter((r) => r.metrics.tokens);
		const avgTokens = tokenRuns.length > 0 ? tokenRuns.reduce((a, r) => a + (r.metrics.tokens?.total ?? 0), 0) / tokenRuns.length : null;
		const passRate = Math.round((passed / runs.length) * 100);

		lines.push(`| ${agent} | ${model} | ${agentVersion} | ${runs.length} | ${passed} | ${passRate}% | ${formatDuration(avgDuration)} | ${avgTokens ? `${(avgTokens / 1000).toFixed(1)}k` : "n/a"} |`);
	}
	lines.push("");

	// Per-scenario results
	const scenarioNames = [...new Set(results.map((r) => r.scenario))].sort();

	lines.push("## Results by Scenario");
	lines.push("");
	for (const scenario of scenarioNames) {
		const scenarioResults = results.filter((x) => x.scenario === scenario);
		const meta = scenarioResults[0]?.scenarioMeta;
		lines.push(`### ${scenario}`);
		if (meta) {
			lines.push(`*${meta.language} — ${meta.description}*`);
		}
		lines.push("");
		lines.push("| Agent | Result | Duration | Turns | Tokens | Debug Tools Used |");
		lines.push("|-------|--------|----------|-------|--------|------------------|");
		for (const r of scenarioResults) {
			const resultLabel = r.passed ? "**PASS**" : "FAIL";
			lines.push(`| ${r.agent} | ${resultLabel} | ${formatDuration(r.durationMs)} | ${r.metrics.numTurns ?? "n/a"} | ${formatTokens(r.metrics.tokens)} | ${toolCallSummary(r.metrics.toolCalls)} |`);
		}
		lines.push("");

		// Show agent's result summary if available
		for (const r of scenarioResults) {
			if (r.resultSummary) {
				lines.push(`> **${r.agent}:** ${r.resultSummary}`);
				lines.push("");
			}
		}
	}

	// Tool usage
	const toolTotals = new Map<string, number>();
	for (const r of results) {
		for (const [tool, count] of Object.entries(r.metrics.toolCalls ?? {})) {
			toolTotals.set(tool, (toolTotals.get(tool) ?? 0) + count);
		}
	}

	if (toolTotals.size > 0) {
		lines.push("## Tool Usage");
		lines.push("");
		lines.push("| Tool | Total Calls | Avg per Run |");
		lines.push("|------|-------------|-------------|");
		const sorted = [...toolTotals.entries()].sort((a, b) => b[1] - a[1]);
		for (const [tool, total] of sorted) {
			const short = tool.replace(/^mcp__agent-lens__/, "");
			const avg = (total / results.length).toFixed(1);
			lines.push(`| ${short} | ${total} | ${avg} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// --- JSON report ---

interface Report {
	date: string;
	agentLensVersion: string;
	summary: {
		totalRuns: number;
		passed: number;
		failed: number;
		passRate: number;
	};
	agents: Array<{
		name: string;
		model: string | null;
		version: string | null;
		runs: number;
		passed: number;
		passRate: number;
		avgDurationMs: number;
		avgTokens: number | null;
	}>;
	results: RunResult[];
}

function generateJson(results: RunResult[]): Report {
	const passed = results.filter((r) => r.passed).length;

	const agentMap = new Map<string, RunResult[]>();
	for (const r of results) {
		const list = agentMap.get(r.agent) ?? [];
		list.push(r);
		agentMap.set(r.agent, list);
	}

	const agents = [...agentMap.entries()].map(([name, runs]) => {
		const agentPassed = runs.filter((r) => r.passed).length;
		const tokenRuns = runs.filter((r) => r.metrics.tokens);
		const avgTokens = tokenRuns.length > 0 ? Math.round(tokenRuns.reduce((a, r) => a + (r.metrics.tokens?.total ?? 0), 0) / tokenRuns.length) : null;
		return {
			name,
			model: runs.find((r) => r.metrics.model)?.metrics.model ?? null,
			version: runs.find((r) => r.metrics.agentVersion)?.metrics.agentVersion ?? null,
			runs: runs.length,
			passed: agentPassed,
			passRate: runs.length > 0 ? agentPassed / runs.length : 0,
			avgDurationMs: Math.round(runs.reduce((a, r) => a + r.durationMs, 0) / runs.length),
			avgTokens,
		};
	});

	return {
		date: results[0]?.timestamp.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
		agentLensVersion: results[0]?.agentLensVersion ?? "unknown",
		summary: {
			totalRuns: results.length,
			passed,
			failed: results.length - passed,
			passRate: results.length > 0 ? passed / results.length : 0,
		},
		agents,
		results,
	};
}

// --- Main ---

async function main(): Promise<void> {
	const { dir, format, out } = parseArgs();

	let suiteDir: string;
	if (dir) {
		suiteDir = resolve(getTracesDir(), dir);
	} else {
		suiteDir = await findLatestSuiteDir();
	}

	console.error(`[report] Loading results from: ${suiteDir}`);
	const results = await loadResults(suiteDir);
	console.error(`[report] Found ${results.length} result(s)`);

	let output: string;
	if (format === "json") {
		output = JSON.stringify(generateJson(results), null, 2);
	} else {
		output = generateMarkdown(results, suiteDir);
	}

	if (out) {
		await writeFile(resolve(out), output);
		console.error(`[report] Written to: ${out}`);
	} else {
		process.stdout.write(output);
	}

	// Also always write both formats to the trace dir
	const mdPath = join(suiteDir, "report.md");
	const jsonPath = join(suiteDir, "report.json");
	await writeFile(mdPath, generateMarkdown(results, suiteDir));
	await writeFile(jsonPath, JSON.stringify(generateJson(results), null, 2));
	console.error(`[report] Saved to: ${mdPath}`);
}

await main();
