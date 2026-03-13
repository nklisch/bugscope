import type { EventType, Framework, FrameworkChangeType, Severity } from "../core/enums.js";
export type { EventType };

/** Data shape for framework_detect events. */
export interface FrameworkDetectData {
	framework: Framework;
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
	changeType: FrameworkChangeType;
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
	severity: Severity;
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
	severity?: Severity;
}

export interface BrowserSessionInfo {
	id: string;
	startedAt: number;
	tabs: Array<{ targetId: string; url: string; title: string }>;
	eventCount: number;
	markerCount: number;
	bufferAgeMs: number;
}
