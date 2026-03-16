/**
 * Extract a string message from an unknown error value.
 */
export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Base error for all Krometrail errors.
 */
export class KrometrailError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = "KrometrailError";
	}
}

/**
 * DAP request timed out.
 */
export class DAPTimeoutError extends KrometrailError {
	constructor(
		public readonly command: string,
		public readonly timeoutMs: number,
	) {
		super(`DAP request '${command}' timed out after ${timeoutMs}ms`, "DAP_TIMEOUT");
		this.name = "DAPTimeoutError";
	}
}

/**
 * DAP client has been disposed.
 */
export class DAPClientDisposedError extends KrometrailError {
	constructor() {
		super("DAP client has been disposed", "DAP_DISPOSED");
		this.name = "DAPClientDisposedError";
	}
}

/**
 * DAP connection failed.
 */
export class DAPConnectionError extends KrometrailError {
	constructor(
		public readonly host: string,
		public readonly port: number,
		public readonly cause?: Error,
	) {
		super(`Failed to connect to DAP server at ${host}:${port}: ${cause?.message ?? "unknown error"}`, "DAP_CONNECTION_FAILED");
		this.name = "DAPConnectionError";
	}
}

/**
 * Session not found.
 */
export class SessionNotFoundError extends KrometrailError {
	constructor(public readonly sessionId: string) {
		super(`No debug session with id: ${sessionId}`, "SESSION_NOT_FOUND");
		this.name = "SessionNotFoundError";
	}
}

/**
 * Session is in an invalid state for the requested operation.
 */
export class SessionStateError extends KrometrailError {
	constructor(
		public readonly sessionId: string,
		public readonly currentState: string,
		public readonly expectedStates: string[],
	) {
		super(`Session ${sessionId} is '${currentState}', expected one of: ${expectedStates.join(", ")}`, "SESSION_INVALID_STATE");
		this.name = "SessionStateError";
	}
}

/**
 * Session resource limit exceeded.
 */
export class SessionLimitError extends KrometrailError {
	constructor(
		public readonly limitName: string,
		public readonly currentValue: number,
		public readonly maxValue: number,
		public readonly suggestion?: string,
	) {
		super(`Session limit '${limitName}' exceeded: ${currentValue}/${maxValue}. ${suggestion ?? ""}`, "SESSION_LIMIT_EXCEEDED");
		this.name = "SessionLimitError";
	}
}

/**
 * Adapter prerequisites not met.
 */
export class AdapterPrerequisiteError extends KrometrailError {
	constructor(
		public readonly adapterId: string,
		public readonly missing: string[],
		public readonly installHint?: string,
		public readonly fixCommand?: string,
	) {
		super(`Adapter '${adapterId}' prerequisites not met: ${missing.join(", ")}. ${installHint ? `Install: ${installHint}` : ""}`, "ADAPTER_PREREQUISITES");
		this.name = "AdapterPrerequisiteError";
	}
}

/**
 * No adapter found for the given language or file extension.
 */
export class AdapterNotFoundError extends KrometrailError {
	constructor(public readonly languageOrExt: string) {
		super(`No debug adapter found for '${languageOrExt}'. Run 'krometrail doctor' to see available adapters.`, "ADAPTER_NOT_FOUND");
		this.name = "AdapterNotFoundError";
	}
}

export type LaunchErrorCause = "spawn_failed" | "connection_timeout" | "port_conflict" | "early_exit" | "unknown";

/**
 * Debugee process launch failed.
 */
export class LaunchError extends KrometrailError {
	constructor(
		message: string,
		public readonly stderr?: string,
		public readonly cause_type: LaunchErrorCause = "unknown",
	) {
		super(message, "LAUNCH_FAILED");
		this.name = "LaunchError";
	}
}

/**
 * Chrome executable not found.
 */
export class ChromeNotFoundError extends KrometrailError {
	constructor() {
		const platform = process.platform;
		const hint =
			platform === "darwin"
				? "Chrome not found. Install from https://google.com/chrome, or use --attach to connect to an existing instance."
				: platform === "linux"
					? "Chrome not found. Install: apt install google-chrome-stable, or use --attach to connect to an existing instance."
					: "Chrome not found. Install from https://google.com/chrome, or use --attach to connect to an existing instance.";
		super(hint, "CHROME_NOT_FOUND");
		this.name = "ChromeNotFoundError";
	}
}

/**
 * Chrome CDP connection failed (WebSocket or HTTP endpoint unavailable).
 */
export class CDPConnectionError extends KrometrailError {
	constructor(
		message: string,
		public readonly cause?: Error,
	) {
		super(message, "CDP_CONNECTION_FAILED");
		this.name = "CDPConnectionError";
	}
}

/**
 * Chrome process exited early — typically because an existing Chrome instance
 * absorbed the launch (common on macOS when no --user-data-dir is specified).
 */
export class ChromeEarlyExitError extends KrometrailError {
	constructor(
		public readonly exitCode: number | null,
		public readonly signal: string | null,
	) {
		super(
			`Chrome exited immediately (code=${exitCode}, signal=${signal}). ` +
				"This usually means an existing Chrome instance is running and absorbed the launch. " +
				"Use profile to launch an isolated instance: chrome_start(profile: 'krometrail')",
			"CHROME_EARLY_EXIT",
		);
		this.name = "ChromeEarlyExitError";
	}
}

/**
 * Browser tab not found by targetId.
 */
export class TabNotFoundError extends KrometrailError {
	constructor(public readonly targetId: string) {
		super(`Tab not found: ${targetId}`, "TAB_NOT_FOUND");
		this.name = "TabNotFoundError";
	}
}

/**
 * Browser recorder is in an invalid state for the requested operation.
 */
export class BrowserRecorderStateError extends KrometrailError {
	constructor(message: string) {
		super(message, "BROWSER_RECORDER_STATE");
		this.name = "BrowserRecorderStateError";
	}
}

/**
 * Adapter installation failed (e.g., extraction error, missing binary after download).
 */
export class AdapterInstallError extends KrometrailError {
	constructor(
		public readonly adapterId: string,
		public readonly detail: string,
	) {
		super(`Adapter '${adapterId}' installation failed: ${detail}`, "ADAPTER_INSTALL_FAILED");
		this.name = "AdapterInstallError";
	}
}

/**
 * Event not found by eventId in a browser recording session.
 */
export class EventNotFoundError extends KrometrailError {
	constructor(public readonly eventId: string) {
		super(`Event not found: ${eventId}`, "EVENT_NOT_FOUND");
		this.name = "EventNotFoundError";
	}
}

/**
 * Marker not found by markerId in a browser recording session.
 */
export class MarkerNotFoundError extends KrometrailError {
	constructor(public readonly markerId: string) {
		super(`Marker not found: ${markerId}`, "MARKER_NOT_FOUND");
		this.name = "MarkerNotFoundError";
	}
}

/**
 * launch.json configuration is invalid or unsupported.
 */
export class InvalidLaunchConfigError extends KrometrailError {
	constructor(message: string) {
		super(message, "INVALID_LAUNCH_CONFIG");
		this.name = "InvalidLaunchConfigError";
	}
}

/**
 * A browser step execution action failed.
 */
export class StepExecutionError extends KrometrailError {
	constructor(
		public readonly stepIndex: number,
		public readonly action: string,
		public readonly selector?: string,
		cause?: string,
	) {
		const loc = selector ? ` on "${selector}"` : "";
		super(`Step ${stepIndex} (${action}${loc}) failed: ${cause ?? "unknown error"}`, "STEP_EXECUTION_FAILED");
		this.name = "StepExecutionError";
	}
}
