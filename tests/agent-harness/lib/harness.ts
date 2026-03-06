import { appendFile, chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentDriver, AgentRunResult, RunMode, RunResult, Scenario, ValidationResult, Workspace } from "./config.js";
import { spawnCapture } from "./spawn.js";

const MCP_SERVER_PATH = resolve(import.meta.dirname, "../../../src/mcp/index.ts");
const CLI_ENTRY_PATH = resolve(import.meta.dirname, "../../../src/cli/index.ts");
const SKILL_DIR = resolve(import.meta.dirname, "../../../skill");

// Read agent-lens version once at module load
async function readAgentLensVersion(): Promise<string> {
	try {
		const pkg = JSON.parse(await readFile(resolve(import.meta.dirname, "../../../package.json"), "utf-8")) as { version: string };
		return pkg.version;
	} catch {
		return "unknown";
	}
}

const AGENT_LENS_VERSION = await readAgentLensVersion();

// --- Shell helper ---

async function exec(cmd: string, cwd: string, env?: Record<string, string>) {
	return spawnCapture("bash", ["-c", cmd], { cwd, env });
}

const GIT_ENV = {
	GIT_AUTHOR_NAME: "agent-harness",
	GIT_AUTHOR_EMAIL: "harness@agent-lens.test",
	GIT_COMMITTER_NAME: "agent-harness",
	GIT_COMMITTER_EMAIL: "harness@agent-lens.test",
};

async function initGitRepo(workDir: string): Promise<void> {
	await exec("git init -q && git add -A && git commit -q -m 'initial' --no-gpg-sign", workDir, GIT_ENV);
}

async function captureGitDiff(workDir: string): Promise<{ diff: string; filesChanged: string[] }> {
	const diffResult = await exec("git diff HEAD", workDir, GIT_ENV);
	const diff = diffResult.stdout.trim();

	const filesResult = await exec("git diff --name-only HEAD", workDir, GIT_ENV);
	const filesChanged = filesResult.stdout
		.trim()
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);

	return { diff, filesChanged };
}

// --- CLI wrapper for "cli" mode ---

/**
 * Install a wrapper script so the agent can call `agent-lens` via bash.
 * Returns the bin directory to prepend to PATH.
 */
async function installCliWrapper(workDir: string): Promise<string> {
	const binDir = join(workDir, ".bin");
	await mkdir(binDir, { recursive: true });
	const wrapper = `#!/usr/bin/env bash\nexec bun run "${CLI_ENTRY_PATH}" "$@"\n`;
	const wrapperPath = join(binDir, "agent-lens");
	await writeFile(wrapperPath, wrapper);
	await chmod(wrapperPath, 0o755);
	return binDir;
}

// --- MCP config generation ---

function generateMcpConfig(workDir: string): object {
	return {
		mcpServers: {
			"agent-lens": {
				command: "bun",
				args: ["run", MCP_SERVER_PATH],
				cwd: workDir,
			},
		},
	};
}

// --- Run a shell command and check its exit code ---

async function runCommand(command: string, workDir: string): Promise<{ passed: boolean; stdout: string; stderr: string }> {
	const result = await exec(command, workDir);
	return {
		passed: result.exitCode === 0,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

// --- Workspace preparation ---

export async function prepareWorkspace(scenario: Scenario, mode: RunMode = "mcp"): Promise<Workspace> {
	const workDir = await (async () => {
		const base = join(tmpdir(), `agent-lens-harness-`);
		await mkdir(base, { recursive: true });
		const dir = `${base}${scenario.name}-${Date.now()}`;
		await mkdir(dir, { recursive: true });
		return dir;
	})();

	await cp(scenario.srcDir, workDir, { recursive: true });
	await writeFile(join(workDir, ".gitignore"), "__pycache__/\n*.pyc\nnode_modules/\n.bin/\n");

	// Install skill and add debugger hint for mcp/cli modes only — baseline has no agent-lens access
	if (mode !== "baseline") {
		const skillInstallDir = join(workDir, ".claude", "skills", "agent-lens");
		await mkdir(skillInstallDir, { recursive: true });
		await cp(SKILL_DIR, skillInstallDir, { recursive: true });

		const claudeMdPath = join(workDir, "CLAUDE.md");
		try {
			await appendFile(claudeMdPath, "\nUse agent-lens debugger tools for hard to solve or non-obvious bugs.\n");
		} catch {
			// No CLAUDE.md in this scenario — skip
		}
	}

	await initGitRepo(workDir);

	for (const cmd of scenario.setupCommands) {
		const result = await exec(cmd, workDir);
		if (result.exitCode !== 0) {
			throw new Error(`Setup command failed: ${cmd}\n${result.stderr}`);
		}
	}

	const mcpConfigPath = join(workDir, ".mcp-config.json");
	await writeFile(mcpConfigPath, JSON.stringify(generateMcpConfig(workDir), null, 2));

	return { workDir, mcpConfigPath };
}

// --- Validation ---

async function validate(workspace: Workspace, scenario: Scenario): Promise<ValidationResult> {
	await cp(scenario.hiddenDir, workspace.workDir, { recursive: true });
	return runCommand(scenario.validationCommand, workspace.workDir);
}

// --- Extract result summary from agent stdout (driver-specific) ---

function extractResultSummary(stdout: string): string | null {
	const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
	for (const line of lines) {
		try {
			const data = JSON.parse(line) as Record<string, unknown>;
			if (data.type === "result" && typeof data.result === "string") {
				return data.result;
			}
		} catch {
			// skip
		}
	}
	return null;
}

// --- Full scenario run ---

export async function runScenario(agent: AgentDriver, scenario: Scenario, traceDir: string, mode: RunMode = "mcp"): Promise<RunResult> {
	const timestamp = new Date().toISOString();
	const workspace = await prepareWorkspace(scenario, mode);

	let visibleTestBefore = false;
	let visibleTestAfter = false;
	let agentRunResult: AgentRunResult = {
		exitCode: null,
		stdout: "",
		stderr: "",
		timedOut: false,
		durationMs: 0,
	};
	let validationResult: ValidationResult = { passed: false, stdout: "", stderr: "" };
	let diff = "";
	let filesChanged: string[] = [];

	const MAX_RETRIES = 3;
	let retries = 0;

	try {
		const preFail = await runCommand(scenario.visibleTestCommand, workspace.workDir);
		visibleTestBefore = preFail.passed;

		const prompt = await readFile(scenario.promptPath, "utf-8");

		// In cli mode only, install wrapper script so `agent-lens` is callable via bash.
		// In mcp mode, the agent uses MCP tools — no CLI wrapper is installed.
		// In baseline mode, no agent-lens access at all.
		let env: Record<string, string> | undefined;
		if (mode === "cli") {
			const binDir = await installCliWrapper(workspace.workDir);
			env = { PATH: `${binDir}:${process.env.PATH ?? ""}` };
		}

		console.error(`[harness] ${agent.name} × ${scenario.name} [${mode}] → ${workspace.workDir}`);

		agentRunResult = await agent.run({
			workDir: workspace.workDir,
			mcpConfigPath: workspace.mcpConfigPath,
			prompt,
			timeoutMs: scenario.timeoutSeconds * 1000,
			mode,
			env,
		});

		validationResult = await validate(workspace, scenario);

		// Retry loop — if validation fails, resume the session with feedback (up to MAX_RETRIES times)
		while (!validationResult.passed && retries < MAX_RETRIES && agentRunResult.sessionId && !agentRunResult.timedOut) {
			retries++;
			console.error(`[harness] validation failed — retry ${retries}/${MAX_RETRIES} (session: ${agentRunResult.sessionId})`);

			const followUp = `That didn't quite fix it — I'm still seeing the same issue. Can you take another look? It might help to write a small test that reproduces the specific case.`;

			agentRunResult = await agent.run({
				workDir: workspace.workDir,
				mcpConfigPath: workspace.mcpConfigPath,
				prompt: followUp,
				timeoutMs: scenario.timeoutSeconds * 1000,
				mode,
				env,
				resumeSessionId: agentRunResult.sessionId,
			});

			validationResult = await validate(workspace, scenario);
		}

		const postCheck = await runCommand(scenario.visibleTestCommand, workspace.workDir);
		visibleTestAfter = postCheck.passed;

		const gitResult = await captureGitDiff(workspace.workDir);
		diff = gitResult.diff;
		filesChanged = gitResult.filesChanged;
	} finally {
		// Don't delete workspace — trace capture happens after this function
	}

	const metrics = agent.parseMetrics(agentRunResult);
	metrics.agentVersion = await agent.version();

	const result: RunResult = {
		scenario: scenario.name,
		mode,
		scenarioMeta: {
			description: scenario.description,
			language: scenario.language,
			level: scenario.level,
		},
		agent: agent.name,
		timestamp,
		passed: validationResult.passed,
		durationMs: agentRunResult.durationMs,
		timedOut: agentRunResult.timedOut,
		agentExitCode: agentRunResult.exitCode,
		metrics,
		agentLensVersion: AGENT_LENS_VERSION,
		visibleTestBefore,
		visibleTestAfter,
		validation: validationResult,
		filesChanged,
		diff,
		sessionLog: agentRunResult.sessionLog ?? [],
		toolTimeline: agentRunResult.toolTimeline ?? [],
		resultSummary: extractResultSummary(agentRunResult.stdout),
		retries,
	};

	await saveRunTrace(traceDir, agent.name, scenario.name, mode, result, agentRunResult);

	return result;
}

// --- Trace saving ---

async function saveRunTrace(suiteDir: string, agentName: string, scenarioName: string, mode: RunMode, result: RunResult, agentRun: { stdout: string; stderr: string }): Promise<void> {
	const traceDir = join(suiteDir, agentName, scenarioName, mode);
	await mkdir(traceDir, { recursive: true });

	await writeFile(join(traceDir, "result.json"), JSON.stringify(result, null, 2));
	await writeFile(join(traceDir, "agent-stdout.txt"), agentRun.stdout);
	await writeFile(join(traceDir, "agent-stderr.txt"), agentRun.stderr);
	await writeFile(join(traceDir, "session.log"), result.sessionLog.join("\n"));
	await writeFile(join(traceDir, "workspace-diff.patch"), result.diff);
}
