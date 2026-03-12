export type EventType =
	| "navigation"
	| "network_request"
	| "network_response"
	| "console"
	| "page_error"
	| "user_input"
	| "dom_mutation"
	| "form_state"
	| "screenshot"
	| "performance"
	| "websocket"
	| "storage_change"
	| "marker"
	// Framework state events (Phase 14+)
	| "framework_detect"
	| "framework_state"
	| "framework_error";

/** Data shape for framework_detect events. */
export interface FrameworkDetectData {
	framework: "react" | "vue" | "solid" | "svelte";
	version: string;
	rootCount: number;
	componentCount: number;
	/** Only React: production (0) or development (1) bundle. */
	bundleType?: 0 | 1;
	/** Detected state management library, if any. */
	storeDetected?: string;
}

/** Data shape for framework_state events. */
export interface FrameworkStateData {
	framework: string;
	componentName: string;
	componentPath?: string;
	changeType: "mount" | "update" | "unmount" | "store_mutation";
	changes?: Array<{ key: string; prev: unknown; next: unknown }>;
	renderCount?: number;
	triggerSource?: string;
	// Vue-specific extensions
	storeId?: string;
	mutationType?: string;
	actionName?: string;
}

/** Data shape for framework_error events. */
export interface FrameworkErrorData {
	framework: string;
	pattern: string;
	componentName: string;
	severity: "low" | "medium" | "high";
	detail: string;
	evidence: Record<string, unknown>;
}

export interface RecordedEvent {
	id: string;
	timestamp: number;
	type: EventType;
	tabId: string;
	summary: string;
	data: Record<string, unknown>;
}

export interface Marker {
	id: string;
	timestamp: number;
	label?: string;
	autoDetected: boolean;
	severity?: "low" | "medium" | "high";
}

export interface BrowserSessionInfo {
	id: string;
	startedAt: number;
	tabs: Array<{ targetId: string; url: string; title: string }>;
	eventCount: number;
	markerCount: number;
	bufferAgeMs: number;
}
