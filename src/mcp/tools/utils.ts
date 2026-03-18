import { getErrorMessage } from "../../core/errors.js";

/**
 * Shared MCP tool response helpers.
 */

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
export type ContentBlock = TextContent | ImageContent;

export type ToolResult = { content: ContentBlock[]; isError?: true };

export function errorResponse(err: unknown): ToolResult {
	return { content: [{ type: "text" as const, text: getErrorMessage(err) }], isError: true };
}

export function textResponse(text: string): ToolResult {
	return { content: [{ type: "text" as const, text }] };
}

export function imageContent(base64Data: string, mimeType = "image/jpeg"): ImageContent {
	return { type: "image" as const, data: base64Data, mimeType };
}

/**
 * Wraps a simple async tool handler in a try/catch that returns errorResponse on failure.
 * Use for handlers where the entire logic is a single async call returning a string.
 */
export function toolHandler<T>(fn: (params: T) => Promise<string>): (params: T) => Promise<ToolResult> {
	return async (params) => {
		try {
			return textResponse(await fn(params));
		} catch (err) {
			return errorResponse(err);
		}
	};
}
