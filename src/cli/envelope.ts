import { AdapterPrerequisiteError, getErrorMessage, KrometrailError } from "../core/errors.js";

/**
 * Uniform JSON response envelope for all CLI --json output.
 * Agents can rely on this shape for every command.
 */
export interface CliSuccessEnvelope<T = unknown> {
	ok: true;
	data: T;
}

export interface CliErrorEnvelope {
	ok: false;
	error: {
		code: string;
		message: string;
		retryable: boolean;
		fixCommand?: string;
	};
}

export type CliEnvelope<T = unknown> = CliSuccessEnvelope<T> | CliErrorEnvelope;

/**
 * Transient error codes that may succeed on retry.
 */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set(["DAP_TIMEOUT", "DAP_CONNECTION_FAILED", "CDP_CONNECTION_FAILED"]);

/**
 * Wrap a successful result in the CLI JSON envelope.
 */
export function successEnvelope<T>(data: T): string {
	return JSON.stringify({ ok: true, data } satisfies CliSuccessEnvelope<T>, null, 2);
}

/**
 * Wrap an error in the CLI JSON envelope.
 * Extracts code from KrometrailError, classifies retryability.
 */
export function errorEnvelope(err: unknown): string {
	let code = "UNKNOWN_ERROR";
	let fixCommand: string | undefined;
	const message = getErrorMessage(err);

	if (err instanceof KrometrailError) {
		code = err.code;
	}
	if (err instanceof AdapterPrerequisiteError) {
		fixCommand = err.fixCommand;
	}

	const retryable = RETRYABLE_CODES.has(code);

	return JSON.stringify(
		{
			ok: false,
			error: { code, message, retryable, ...(fixCommand ? { fixCommand } : {}) },
		} satisfies CliErrorEnvelope,
		null,
		2,
	);
}
