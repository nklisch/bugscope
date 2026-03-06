/**
 * Service configuration management.
 * Merges layered config objects and initializes services with the result.
 */

export interface BaseConfig {
	version: number;
	enabled: boolean;
}

export interface CacheConfig extends BaseConfig {
	ttlSeconds: number;
	maxEntries: number;
	strategy: "lru" | "fifo" | "lfu";
}

export interface RetryConfig extends BaseConfig {
	maxRetries: number;
	backoffMs: number;
	exponential: boolean;
}

export interface ServiceInit {
	config: BaseConfig;
	configVersion: string;
	features: string[];
}

/**
 * Merge a base config with an array of partial overrides.
 * Later overrides take precedence over earlier ones.
 * Fields set to `undefined` in an override are ignored.
 */
export function mergeConfigs<T extends BaseConfig>(base: T, overrides: Partial<T>[]): T {
	let result: T = { ...base };
	for (const override of overrides) {
		for (const key of Object.keys(override) as Array<keyof T>) {
			if (override[key] !== undefined) {
				result = { ...result, [key]: override[key] };
			}
		}
	}
	return result;
}

/**
 * Initialize a service with a merged configuration.
 * Returns metadata about the config version and enabled feature flags.
 *
 * BUG: `if (config.version)` uses truthiness to detect "version not set".
 * In JavaScript, 0 is falsy. When an override sets `version: 0` (which means
 * "use legacy mode"), this check treats it the same as if version were null/undefined.
 * The result: configVersion is "unknown" instead of "v0", and version-gated
 * features are not evaluated against the actual version number.
 *
 * The generic constraint `T extends BaseConfig` makes this look safe — version
 * is definitely a `number` — but the type system has no concept of falsy values.
 */
export function initService<T extends BaseConfig>(base: T, overrides: Partial<T>[]): ServiceInit {
	const config = mergeConfigs(base, overrides);

	// BUG: version 0 is falsy — this check was meant to detect "no version set",
	// but version 0 is a valid value meaning "legacy compatibility mode"
	const configVersion = config.version
		? `v${config.version}`
		: "unknown";

	const features: string[] = [];
	if (config.enabled) {
		features.push("core");
	}
	// Version-gated features — never reached when version is 0 (falsy)
	if (config.version >= 2) {
		features.push("advanced");
	}
	if (config.version >= 3) {
		features.push("experimental");
	}

	return { config, configVersion, features };
}
