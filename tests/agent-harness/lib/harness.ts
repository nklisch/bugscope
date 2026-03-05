import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentDriver, RunResult, Scenario, ValidationResult, Workspace } from "./config.js";
import { spawnCapture } from "./spawn.js";

const MCP_SERVER_PATH = resolve(import.meta.dirname, "../../../src/mcp/index.ts");
const SKILL_PATH = resolve(import.meta.dirname, "../../../skill/SKILL.md");

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

export async function prepareWorkspace(scenario: Scenario): Promise<Workspace> {
	const workDir = await (async () => {
		const base = join(tmpdir(), `agent-lens-harness-`);
		await mkdir(base, { recursive: true });
		// Use a unique temp dir per scenario run
		const dir = `${base}${scenario.name}-${Date.now()}`;
		await mkdir(dir, { recursive: true });
		return dir;
	})();

	// Copy scenario src/ into workspace
	await cp(scenario.srcDir, workDir, { recursive: true });

	// Add .gitignore to avoid noise from bytecode files
	await writeFile(join(workDir, ".gitignore"), "__pycache__/\n*.pyc\nnode_modules/\n");

	// Initialize git repo so we can diff agent changes
	await initGitRepo(workDir);

	// Run setup commands
	for (const cmd of scenario.setupCommands) {
		const result = await exec(cmd, workDir);
		if (result.exitCode !== 0) {
			throw new Error(`Setup command failed: ${cmd}\n${result.stderr}`);
		}
	}

	// Write MCP config
	const mcpConfigPath = join(workDir, ".mcp-config.json");
	await writeFile(mcpConfigPath, JSON.stringify(generateMcpConfig(workDir), null, 2));

	return { workDir, mcpConfigPath };
}

// --- Validation ---

async function validate(workspace: Workspace, scenario: Scenario): Promise<ValidationResult> {
	// Copy hidden test files into workspace
	await cp(scenario.hiddenDir, workspace.workDir, { recursive: true });

	return runCommand(scenario.validationCommand, workspace.workDir);
}

// --- Full scenario run ---

export async function runScenario(agent: AgentDriver, scenario: Scenario, traceDir: string): Promise<RunResult> {
	const timestamp = new Date().toISOString();
	const workspace = await prepareWorkspace(scenario);

	let visibleTestBefore = false;
	let visibleTestAfter = false;
	let agentRunResult = {
		exitCode: null as number | null,
		stdout: "",
		stderr: "",
		timedOut: false,
		durationMs: 0,
	};
	let validationResult: ValidationResult = { passed: false, stdout: "", stderr: "" };
	let diff = "";
	let filesChanged: string[] = [];

	try {
		// Sanity check: visible test should fail before agent runs
		const preFail = await runCommand(scenario.visibleTestCommand, workspace.workDir);
		visibleTestBefore = preFail.passed;

		// Read prompt and skill
		const prompt = await readFile(scenario.promptPath, "utf-8");
		let skillContent = "";
		try {
			skillContent = await readFile(SKILL_PATH, "utf-8");
		} catch {
			// Skill file missing — continue without it
		}
		console.error(`[harness] ${agent.name} × ${scenario.name} → ${workspace.workDir}`);

		// Run agent
		agentRunResult = await agent.run({
			workDir: workspace.workDir,
			mcpConfigPath: workspace.mcpConfigPath,
			prompt,
			timeoutMs: scenario.timeoutSeconds * 1000,
			maxBudgetUsd: scenario.maxBudgetUsd,
			skillContent,
		});

		// Check visible test after
		const postCheck = await runCommand(scenario.visibleTestCommand, workspace.workDir);
		visibleTestAfter = postCheck.passed;

		// Capture diff
		const gitResult = await captureGitDiff(workspace.workDir);
		diff = gitResult.diff;
		filesChanged = gitResult.filesChanged;

		// Run hidden validation
		validationResult = await validate(workspace, scenario);
	} finally {
		// Don't delete workspace — trace capture happens after this function
	}

	const metrics = agent.parseMetrics(agentRunResult);
	metrics.agentVersion = await agent.version();

	const result: RunResult = {
		scenario: scenario.name,
		agent: agent.name,
		timestamp,
		passed: validationResult.passed,
		durationMs: agentRunResult.durationMs,
		timedOut: agentRunResult.timedOut,
		agentExitCode: agentRunResult.exitCode,
		agentStderr: agentRunResult.stderr,
		metrics,
		agentLensVersion: AGENT_LENS_VERSION,
		visibleTestBefore,
		visibleTestAfter,
		validation: validationResult,
		filesChanged,
		diff,
	};

	// Save trace
	await saveRunTrace(traceDir, agent.name, scenario.name, result, agentRunResult, workspace.workDir);

	return result;
}

// --- Trace saving (inline to avoid circular dep with trace.ts) ---

async function saveRunTrace(suiteDir: string, agentName: string, scenarioName: string, result: RunResult, agentRun: { stdout: string; stderr: string; sessionLog?: string[] }, workDir: string): Promise<void> {
	const traceDir = join(suiteDir, agentName, scenarioName);
	await mkdir(traceDir, { recursive: true });

	await writeFile(join(traceDir, "result.json"), JSON.stringify(result, null, 2));
	await writeFile(join(traceDir, "agent-stdout.txt"), agentRun.stdout);
	await writeFile(join(traceDir, "agent-stderr.txt"), agentRun.stderr);
	await writeFile(join(traceDir, "session.log"), (agentRun.sessionLog ?? []).join("\n"));
	await writeFile(join(traceDir, "workspace-diff.patch"), result.diff);
	await writeFile(join(traceDir, "validation-stdout.txt"), result.validation.stdout);
}
