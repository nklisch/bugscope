/**
 * Service registrations for the application.
 *
 * Services are registered with name + variant pairs. The container computes
 * a hash-based key from these. When one service depends on another, it must
 * declare the dependency using the exact same key that the dependency was
 * registered with.
 *
 * BUG: CacheService is registered with variant "shared", which produces key
 * `CacheService:<hash-of-shared>`. The RateLimiter service declares its
 * dependency using variant "primary" instead of "shared", producing a
 * different key `CacheService:<hash-of-primary>` — a key that is never
 * registered. When the container resolves RateLimiter, it tries to resolve
 * the dependency and throws "Service not found: CacheService:<hash-of-primary>".
 *
 * The source code alone doesn't reveal the mismatch — both look like valid
 * strings. You need to compute `computeKey("CacheService", "shared")` vs
 * `computeKey("CacheService", "primary")` at runtime to see the difference.
 */

import { computeKey, register } from "./container.ts";

// ────────────────────────────────────────────────────────────────────────────
// Service implementations (simplified stubs)

interface Logger {
	log(msg: string): void;
	error(msg: string): void;
}

interface Cache {
	get(key: string): unknown;
	set(key: string, value: unknown, ttl?: number): void;
	delete(key: string): boolean;
}

interface RateLimiter {
	check(clientId: string): boolean;
	reset(clientId: string): void;
}

interface MetricsCollector {
	increment(metric: string): void;
	gauge(metric: string, value: number): void;
	flush(): Record<string, number>;
}

// ────────────────────────────────────────────────────────────────────────────
// Registrations

const loggerKey = register<Logger>(
	"Logger",
	"console",
	() => ({
		log: (msg: string) => console.log(`[LOG] ${msg}`),
		error: (msg: string) => console.error(`[ERR] ${msg}`),
	}),
);

const metricsKey = register<MetricsCollector>(
	"MetricsCollector",
	"inmemory",
	() => {
		const counters: Record<string, number> = {};
		return {
			increment: (metric: string) => {
				counters[metric] = (counters[metric] ?? 0) + 1;
			},
			gauge: (metric: string, value: number) => {
				counters[metric] = value;
			},
			flush: () => ({ ...counters }),
		};
	},
	{ dependencies: [loggerKey] },
);

// CacheService registered with variant "shared"
const cacheKey = register<Cache>(
	"CacheService",
	"shared", // variant is "shared"
	() => {
		const store = new Map<string, { value: unknown; expires: number }>();
		return {
			get: (key: string) => {
				const entry = store.get(key);
				if (!entry || Date.now() > entry.expires) return undefined;
				return entry.value;
			},
			set: (key: string, value: unknown, ttl = 300_000) => {
				store.set(key, { value, expires: Date.now() + ttl });
			},
			delete: (key: string) => store.delete(key),
		};
	},
	{ dependencies: [loggerKey, metricsKey] },
);

// BUG: RateLimiter declares a dependency on CacheService with variant "primary",
// but CacheService was registered with variant "shared".
// computeKey("CacheService", "primary") !== computeKey("CacheService", "shared")
const wrongCacheKey = computeKey("CacheService", "primary"); // wrong variant!

export const rateLimiterKey = register<RateLimiter>(
	"RateLimiter",
	"sliding-window",
	() => {
		const cache = { get: (k: string) => undefined, set: () => {}, delete: () => false } as Cache; // fallback, never reached
		const windows = new Map<string, number[]>();
		return {
			check: (clientId: string) => {
				const now = Date.now();
				const window = windows.get(clientId) ?? [];
				const recent = window.filter(t => now - t < 60_000);
				recent.push(now);
				windows.set(clientId, recent);
				return recent.length <= 100;
			},
			reset: (clientId: string) => windows.delete(clientId),
		};
	},
	{
		dependencies: [wrongCacheKey, loggerKey], // BUG: wrongCacheKey resolves to an unregistered key
	},
);

export { cacheKey, loggerKey, metricsKey };
