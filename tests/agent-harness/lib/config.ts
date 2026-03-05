import { z } from "zod";

// --- Scenario Config (scenario.json) ---

export const ScenarioConfigSchema = z.object({
	scenario: z.object({
		name: z.string(),
		language: z.string(),
		description: z.string(),
		timeout_seconds: z.number(),
		max_budget_usd: z.number(),
	}),
	setup: z
		.object({
			commands: z.array(z.string()).default([]),
		})
		.default({ commands: [] }),
	visible_test: z.object({
		command: z.string(),
	}),
	validation: z.object({
		command: z.string(),
	}),
});

export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

// --- Parsed Scenario (runtime type with resolved paths) ---

export interface Scenario {
	/** Scenario name from config */
	name: string;
	/** Human description */
	description: string;
	/** Primary language ("python", "node", "go", etc.) */
	language: string;
	/** Timeout in seconds for the agent run */
	timeoutSeconds: number;
	/** Max spend in USD */
	maxBudgetUsd: number;
	/** Setup commands to run before the agent starts */
	setupCommands: string[];
	/** Command to run to check the visible test (pre/post agent) */
	visibleTestCommand: string;
	/** Command to run the hidden oracle test */
	validationCommand: string;
	/** Absolute path to the scenario directory */
	scenarioDir: string;
	/** Absolute path to src/ files to copy into workspace */
	srcDir: string;
	/** Absolute path to hidden/ files to copy in after agent runs */
	hiddenDir: string;
	/** Absolute path to prompt.md */
	promptPath: string;
}

// --- Workspace (temp directory prepared for one run) ---

export interface Workspace {
	/** Absolute path to temp workspace directory */
	workDir: string;
	/** Absolute path to the generated MCP config JSON */
	mcpConfigPath: string;
}

// --- Agent Run Result ---

export interface AgentRunOptions {
	workDir: string;
	mcpConfigPath: string;
	prompt: string;
	timeoutMs: number;
	maxBudgetUsd?: number;
	env?: Record<string, string>;
	/** Agent-lens skill file content to inject into the agent's context */
	skillContent?: string;
}

export interface AgentRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	durationMs: number;
	/** Human-readable session log lines (optional, driver-provided) */
	sessionLog?: string[];
}

// --- Metrics extracted from agent output ---

export interface AgentMetrics {
	/** Cost in USD (agent-reported if available) */
	costUsd: number | null;
	/** Number of agent turns */
	numTurns: number | null;
	/** Input token count */
	tokensInput: number | null;
	/** Output token count */
	tokensOutput: number | null;
	/** Model used */
	model: string | null;
	/** Agent binary version */
	agentVersion: string | null;
	/** Tool call counts per tool name */
	toolCalls: Record<string, number>;
}

// --- Validation Result ---

export interface ValidationResult {
	passed: boolean;
	stdout: string;
	stderr: string;
}

// --- Full Run Result ---

export interface RunResult {
	scenario: string;
	agent: string;
	timestamp: string;
	passed: boolean;
	durationMs: number;
	timedOut: boolean;
	agentExitCode: number | null;
	agentStderr: string;
	metrics: AgentMetrics;
	agentLensVersion: string;
	visibleTestBefore: boolean;
	visibleTestAfter: boolean;
	validation: ValidationResult;
	filesChanged: string[];
	diff: string;
}

// --- Agent Driver Interface ---

export interface AgentDriver {
	/** Human-readable name, e.g. "claude-code" */
	name: string;
	/** Check if the agent binary is available on PATH */
	available(): Promise<boolean>;
	/** Get the agent binary version string */
	version(): Promise<string>;
	/** Run the agent with the given options */
	run(options: AgentRunOptions): Promise<AgentRunResult>;
	/** Extract metrics from raw agent output */
	parseMetrics(result: AgentRunResult): AgentMetrics;
}
