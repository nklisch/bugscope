import type { QueryEngine } from "../investigation/query-engine.js";
import type { RecordedEvent } from "../types.js";

// --- HAR 1.2 types ---

export interface HARFile {
	log: HARLog;
}

export interface HARLog {
	version: string;
	creator: { name: string; version: string };
	pages: HARPage[];
	entries: HAREntry[];
}

export interface HARPage {
	startedDateTime: string;
	id: string;
	title: string;
}

export interface HAREntry {
	startedDateTime: string;
	time: number;
	request: HARRequest;
	response: HARResponse;
	cache: Record<string, never>;
	timings: { send: number; wait: number; receive: number };
}

export interface HARRequest {
	method: string;
	url: string;
	httpVersion: string;
	headers: Array<{ name: string; value: string }>;
	queryString: Array<{ name: string; value: string }>;
	bodySize: number;
	postData?: { mimeType: string; text: string };
}

export interface HARResponse {
	status: number;
	statusText: string;
	httpVersion: string;
	headers: Array<{ name: string; value: string }>;
	content: { size: number; mimeType: string; text?: string };
	bodySize: number;
}

// --- Exporter ---

export interface HARExportOptions {
	sessionId: string;
	timeRange?: { start: number; end: number };
	includeResponseBodies?: boolean; // Default: true
}

export class HARExporter {
	constructor(private queryEngine: QueryEngine) {}

	export(options: HARExportOptions): HARFile {
		const session = this.queryEngine.getSession(options.sessionId);
		const networkRequests = this.queryEngine.search(options.sessionId, {
			filters: {
				eventTypes: ["network_request"],
				timeRange: options.timeRange,
			},
			maxResults: 10000,
		});

		const entries: HAREntry[] = [];

		for (const req of networkRequests) {
			const fullReq = this.queryEngine.getFullEvent(options.sessionId, req.event_id);
			if (!fullReq) continue;

			// Find matching response
			const responses = this.queryEngine.search(options.sessionId, {
				filters: {
					eventTypes: ["network_response"],
					timeRange: {
						start: fullReq.timestamp,
						end: fullReq.timestamp + 60_000,
					},
				},
				maxResults: 1,
			});

			const fullRes = responses[0] ? this.queryEngine.getFullEvent(options.sessionId, responses[0].event_id) : null;

			// Load response body if requested
			let responseBody: string | undefined;
			if (options.includeResponseBodies !== false && fullRes) {
				const bodyRef = this.queryEngine.getNetworkBody(fullRes.id);
				if (bodyRef?.response_body_path) {
					responseBody = this.queryEngine.readNetworkBody(options.sessionId, bodyRef.response_body_path);
				}
			}

			entries.push(this.buildHAREntry(fullReq, fullRes, responseBody));
		}

		return {
			log: {
				version: "1.2",
				creator: { name: "Krometrail Browser", version: "1.0" },
				pages: [
					{
						startedDateTime: new Date(session.started_at).toISOString(),
						id: session.id,
						title: session.tab_title ?? session.tab_url ?? "Unknown",
					},
				],
				entries,
			},
		};
	}

	private buildHAREntry(req: RecordedEvent, res: RecordedEvent | null, responseBody?: string): HAREntry {
		return {
			startedDateTime: new Date(req.timestamp).toISOString(),
			time: res ? res.timestamp - req.timestamp : 0,
			request: {
				method: (req.data.method as string) ?? "GET",
				url: (req.data.url as string) ?? "",
				httpVersion: "HTTP/1.1",
				headers: (req.data.headers as Array<{ name: string; value: string }>) ?? [],
				queryString: [],
				bodySize: req.data.postData ? (req.data.postData as string).length : 0,
				...(req.data.postData && {
					postData: {
						mimeType: "application/json",
						text: req.data.postData as string,
					},
				}),
			},
			response: res
				? {
						status: (res.data.status as number) ?? 0,
						statusText: (res.data.statusText as string) ?? "",
						httpVersion: "HTTP/1.1",
						headers: (res.data.headers as Array<{ name: string; value: string }>) ?? [],
						content: {
							size: responseBody?.length ?? 0,
							mimeType: (res.data.contentType as string) ?? "text/plain",
							text: responseBody,
						},
						bodySize: responseBody?.length ?? 0,
					}
				: {
						status: 0,
						statusText: "No response",
						httpVersion: "HTTP/1.1",
						headers: [],
						content: { size: 0, mimeType: "text/plain" },
						bodySize: 0,
					},
			cache: {},
			timings: {
				send: 0,
				wait: res ? res.timestamp - req.timestamp : 0,
				receive: 0,
			},
		};
	}
}
