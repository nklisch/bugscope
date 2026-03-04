import type { CompressionTier, ViewportConfig } from "./types.js";
import { DEFAULT_COMPRESSION_TIERS } from "./types.js";

/**
 * Resolve the active compression tier based on the current action count.
 * Returns the tier with the highest `minActions` that is <= actionCount.
 */
export function resolveCompressionTier(actionCount: number, tiers: CompressionTier[] = DEFAULT_COMPRESSION_TIERS): CompressionTier {
	let active = tiers[0];
	for (const tier of tiers) {
		if (actionCount >= tier.minActions) {
			active = tier;
		}
	}
	return active;
}

/**
 * Compute the effective ViewportConfig by merging the session's base config
 * with the compression tier overrides.
 * Fields in explicitFields are NOT overridden by compression.
 */
export function computeEffectiveConfig(baseConfig: ViewportConfig, tier: CompressionTier, explicitFields?: Set<string>): ViewportConfig {
	if (Object.keys(tier.overrides).length === 0) {
		return baseConfig;
	}

	const result = { ...baseConfig };
	for (const [key, value] of Object.entries(tier.overrides)) {
		if (explicitFields?.has(key)) {
			// User explicitly set this field — do not override
			continue;
		}
		(result as Record<string, unknown>)[key] = value;
	}
	return result;
}

/**
 * Determine if diff mode should be active based on tier and session state.
 */
export function shouldUseDiffMode(tier: CompressionTier, sessionDiffMode?: boolean): boolean {
	return tier.diffMode || sessionDiffMode === true;
}

/**
 * Generate a compression note for the viewport footer.
 * Returns undefined if no compression is active (tier 0).
 */
export function compressionNote(actionCount: number, maxActions: number, tier: CompressionTier): string | undefined {
	if (tier.minActions === 0) {
		return undefined;
	}
	return `(compressed: action ${actionCount}/${maxActions}, use debug_variables for full locals)`;
}

/**
 * Estimate token count for a string (rough heuristic: chars / 4).
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
