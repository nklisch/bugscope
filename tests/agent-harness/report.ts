#!/usr/bin/env bun
/**
 * Agent harness report generator.
 *
 * Reads result.json files from trace directories and produces:
 * - report.json — site-consumable JSON per suite run
 * - report.md  — publishable markdown
 * - index.json — top-level index across all suite runs (at traces root)
 *
 * Usage:
 *   bun run test:agent:report                        # latest trace dir
 *   bun run test:agent:report --dir .traces/2026-03  # specific dir
 *   bun run test:agent:report --format json          # JSON to stdout
 *   bun run test:agent:report --out report.md        # write to file
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { RunResult, TokenUsage, ToolEvent } from "./lib/config.js";
import { getTracesDir } from "./lib/trace.js";

// ============================================
// TYPES — site-consumable report shape
// ============================================

/** Slim per-result entry for the report (no raw validation output). */
interface ReportResult {
	scenario: string;
	agent: string;
	passed: boolean;
	durationMs: number;
	timedOut: boolean;
	metrics: {
		numTurns: number | null;
		tokens: TokenUsage | null;
		model: string | null;
		agentVersion: string | null;
		toolCalls: Record<string, number>;
	};
	filesChanged: string[];
	diff: string;
	sessionLog: string[];
	toolTimeline: ToolEvent[];
	resultSummary: string | null;
}

interface AgentSummary {
	name: string;
	model: string | null;
	version: string | null;
	runs: number;
	passed: number;
	passRate: number;
	avgDurationMs: number;
	avgTokens: number | null;
	totalTurns: number;
}

interface ScenarioInfo {
	name: string;
	description: string;
	language: string;
}

interface Report {
	id: string;
	date: string;
	timestamp: string;
	agentLensVersion: string;
	summary: {
		totalRuns: number;
		passed: number;
		failed: number;
		passRate: number;
	};
	agents: AgentSummary[];
	scenarios: ScenarioInfo[];
	results: ReportResult[];
}

/** Top-level index entry for one suite run. */
interface IndexEntry {
	id: string;
	date: string;
	timestamp: string;
	agentLensVersion: string;
	summary: Report["summary"];
	agents: string[];
	scenarios: string[];
}

interface Index {
	generated: string;
	runs: IndexEntry[];
}

// ============================================
// CLI
// ============================================

function parseArgs(): { dir?: string; format: "markdown" | "json"; out?: string } {
	const args = process.argv.slice(2);
	const get = (flag: string) => {
		const i = args.indexOf(flag);
		return i !== -1 ? args[i + 1] : undefined;
	};
	const format = get("--format") === "json" ? "json" : "markdown";
	return { dir: get("--dir"), format, out: get("--out") };
}

// ============================================
// LOADING
// ============================================

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
				// skip
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

// ============================================
// REPORT GENERATION
// ============================================

function slimResult(r: RunResult): ReportResult {
	return {
		scenario: r.scenario,
		agent: r.agent,
		passed: r.passed,
		durationMs: r.durationMs,
		timedOut: r.timedOut,
		metrics: r.metrics,
		filesChanged: r.filesChanged,
		diff: r.diff,
		sessionLog: r.sessionLog,
		toolTimeline: r.toolTimeline,
		resultSummary: r.resultSummary,
	};
}

function buildAgentSummaries(results: RunResult[]): AgentSummary[] {
	const agentMap = new Map<string, RunResult[]>();
	for (const r of results) {
		const list = agentMap.get(r.agent) ?? [];
		list.push(r);
		agentMap.set(r.agent, list);
	}

	return [...agentMap.entries()].map(([name, runs]) => {
		const passed = runs.filter((r) => r.passed).length;
		const tokenRuns = runs.filter((r) => r.metrics.tokens);
		const avgTokens = tokenRuns.length > 0 ? Math.round(tokenRuns.reduce((a, r) => a + (r.metrics.tokens?.total ?? 0), 0) / tokenRuns.length) : null;
		const totalTurns = runs.reduce((a, r) => a + (r.metrics.numTurns ?? 0), 0);
		return {
			name,
			model: runs.find((r) => r.metrics.model)?.metrics.model ?? null,
			version: runs.find((r) => r.metrics.agentVersion)?.metrics.agentVersion ?? null,
			runs: runs.length,
			passed,
			passRate: runs.length > 0 ? passed / runs.length : 0,
			avgDurationMs: Math.round(runs.reduce((a, r) => a + r.durationMs, 0) / runs.length),
			avgTokens,
			totalTurns,
		};
	});
}

function buildScenarioList(results: RunResult[]): ScenarioInfo[] {
	const seen = new Map<string, ScenarioInfo>();
	for (const r of results) {
		if (!seen.has(r.scenario)) {
			seen.set(r.scenario, {
				name: r.scenario,
				description: r.scenarioMeta?.description ?? "",
				language: r.scenarioMeta?.language ?? "",
			});
		}
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function generateReport(results: RunResult[], suiteId: string): Report {
	const passed = results.filter((r) => r.passed).length;
	const ts = results[0]?.timestamp ?? new Date().toISOString();

	return {
		id: suiteId,
		date: ts.slice(0, 10),
		timestamp: ts,
		agentLensVersion: results[0]?.agentLensVersion ?? "unknown",
		summary: {
			totalRuns: results.length,
			passed,
			failed: results.length - passed,
			passRate: results.length > 0 ? passed / results.length : 0,
		},
		agents: buildAgentSummaries(results),
		scenarios: buildScenarioList(results),
		results: results.map(slimResult),
	};
}

// ============================================
// INDEX GENERATION
// ============================================

async function generateIndex(tracesDir: string): Promise<Index> {
	const entries = await readdir(tracesDir, { withFileTypes: true });
	const dirs = entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();

	const runs: IndexEntry[] = [];

	for (const dir of dirs) {
		const reportPath = join(tracesDir, dir, "report.json");
		try {
			const raw = await readFile(reportPath, "utf-8");
			const report = JSON.parse(raw) as Report;
			runs.push({
				id: report.id,
				date: report.date,
				timestamp: report.timestamp,
				agentLensVersion: report.agentLensVersion,
				summary: report.summary,
				agents: report.agents.map((a) => a.name),
				scenarios: report.scenarios.map((s) => s.name),
			});
		} catch {
			// No report.json yet — try loading results directly
			const results = await loadResults(join(tracesDir, dir));
			if (results.length === 0) continue;
			const report = generateReport(results, dir);
			runs.push({
				id: dir,
				date: report.date,
				timestamp: report.timestamp,
				agentLensVersion: report.agentLensVersion,
				summary: report.summary,
				agents: report.agents.map((a) => a.name),
				scenarios: report.scenarios.map((s) => s.name),
			});
		}
	}

	return { generated: new Date().toISOString(), runs };
}

// ============================================
// MARKDOWN
// ============================================

function fmt(ms: number): string {
	return `${(ms / 1000).toFixed(0)}s`;
}

function fmtTokens(tokens: TokenUsage | null): string {
	if (!tokens) return "n/a";
	return `${(tokens.total / 1000).toFixed(1)}k`;
}

function fmtTools(toolCalls: Record<string, number>): string {
	if (!toolCalls || Object.keys(toolCalls).length === 0) return "—";
	return Object.entries(toolCalls)
		.sort((a, b) => b[1] - a[1])
		.map(([tool, count]) => {
			const short = tool.replace(/^mcp__agent-lens__debug_/, "").replace(/^debug_/, "");
			return count > 1 ? `${short}(${count})` : short;
		})
		.join(", ");
}

function generateMarkdown(report: Report): string {
	if (report.results.length === 0) {
		return "# Agent Lens — Agent Test Report\n\nNo results found.\n";
	}

	const lines: string[] = [];

	lines.push("# Agent Lens — Agent Test Report");
	lines.push("");
	lines.push(`**Date:** ${report.date}  `);
	lines.push(`**Agent Lens:** ${report.agentLensVersion}  `);
	lines.push(`**Pass rate:** ${Math.round(report.summary.passRate * 100)}% (${report.summary.passed}/${report.summary.totalRuns})`);
	lines.push("");

	// Agent summary
	lines.push("## Agents");
	lines.push("");
	lines.push("| Agent | Model | Version | Scenarios | Passed | Pass Rate | Avg Duration | Avg Tokens | Total Turns |");
	lines.push("|-------|-------|---------|-----------|--------|-----------|--------------|------------|-------------|");
	for (const a of report.agents) {
		lines.push(`| ${a.name} | ${a.model ?? "?"} | ${a.version ?? "?"} | ${a.runs} | ${a.passed} | ${Math.round(a.passRate * 100)}% | ${fmt(a.avgDurationMs)} | ${a.avgTokens ? `${(a.avgTokens / 1000).toFixed(1)}k` : "n/a"} | ${a.totalTurns} |`);
	}
	lines.push("");

	// Per-scenario
	lines.push("## Results");
	lines.push("");
	for (const scenario of report.scenarios) {
		const scenarioResults = report.results.filter((r) => r.scenario === scenario.name);
		lines.push(`### ${scenario.name}`);
		lines.push(`*${scenario.language} — ${scenario.description}*`);
		lines.push("");
		lines.push("| Agent | Result | Duration | Turns | Tokens | Debug Tools |");
		lines.push("|-------|--------|----------|-------|--------|-------------|");
		for (const r of scenarioResults) {
			lines.push(`| ${r.agent} | ${r.passed ? "**PASS**" : "FAIL"} | ${fmt(r.durationMs)} | ${r.metrics.numTurns ?? "n/a"} | ${fmtTokens(r.metrics.tokens)} | ${fmtTools(r.metrics.toolCalls)} |`);
		}
		lines.push("");

		for (const r of scenarioResults) {
			if (r.resultSummary) {
				lines.push(`> **${r.agent}:** ${r.resultSummary}`);
				lines.push("");
			}
		}
	}

	// Tool usage
	const toolTotals = new Map<string, number>();
	for (const r of report.results) {
		for (const [tool, count] of Object.entries(r.metrics.toolCalls ?? {})) {
			toolTotals.set(tool, (toolTotals.get(tool) ?? 0) + count);
		}
	}

	if (toolTotals.size > 0) {
		lines.push("## Tool Usage");
		lines.push("");
		lines.push("| Tool | Total Calls | Avg per Run |");
		lines.push("|------|-------------|-------------|");
		for (const [tool, total] of [...toolTotals.entries()].sort((a, b) => b[1] - a[1])) {
			const short = tool.replace(/^mcp__agent-lens__/, "");
			lines.push(`| ${short} | ${total} | ${(total / report.results.length).toFixed(1)} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
	const { dir, format, out } = parseArgs();
	const tracesDir = getTracesDir();

	let suiteDir: string;
	if (dir) {
		suiteDir = resolve(tracesDir, dir);
	} else {
		suiteDir = await findLatestSuiteDir();
	}

	const suiteId = basename(suiteDir);

	console.error(`[report] Loading results from: ${suiteDir}`);
	const results = await loadResults(suiteDir);
	console.error(`[report] Found ${results.length} result(s)`);

	const report = generateReport(results, suiteId);

	// Output requested format
	let output: string;
	if (format === "json") {
		output = JSON.stringify(report, null, 2);
	} else {
		output = generateMarkdown(report);
	}

	if (out) {
		await writeFile(resolve(out), output);
		console.error(`[report] Written to: ${out}`);
	} else {
		process.stdout.write(output);
	}

	// Always write both formats to the trace dir
	await writeFile(join(suiteDir, "report.json"), JSON.stringify(report, null, 2));
	await writeFile(join(suiteDir, "report.md"), generateMarkdown(report));

	// Rebuild the top-level index across all runs
	const index = await generateIndex(tracesDir);
	await writeFile(join(tracesDir, "index.json"), JSON.stringify(index, null, 2));
	console.error(`[report] Index updated: ${join(tracesDir, "index.json")} (${index.runs.length} runs)`);
}

await main();
