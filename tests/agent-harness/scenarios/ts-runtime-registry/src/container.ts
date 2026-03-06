/**
 * Dependency injection container.
 * Services are registered with string keys derived from their name and variant.
 * Keys are computed via a hash so the registry is compact and collision-resistant.
 */

export type ServiceFactory<T = unknown> = () => T;

export interface ServiceDescriptor<T = unknown> {
	key: string;
	name: string;
	variant: string;
	factory: ServiceFactory<T>;
	singleton: boolean;
	instance?: T;
	dependencies: string[];
}

const _registry = new Map<string, ServiceDescriptor>();

/**
 * Compute a stable registry key from a service name and variant.
 * The hash is deterministic but not guessable from the name alone —
 * you need to run the function to see what key a name+variant produces.
 */
export function computeKey(name: string, variant: string): string {
	const input = `${name}:${variant}`;
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
	}
	return `${name}:${Math.abs(hash).toString(36)}`;
}

/**
 * Register a service factory under a computed key.
 * Returns the computed key so callers can reference it in dependency lists.
 */
export function register<T>(
	name: string,
	variant: string,
	factory: ServiceFactory<T>,
	options: { singleton?: boolean; dependencies?: string[] } = {},
): string {
	const key = computeKey(name, variant);
	_registry.set(key, {
		key,
		name,
		variant,
		factory: factory as ServiceFactory,
		singleton: options.singleton ?? true,
		dependencies: options.dependencies ?? [],
	});
	return key;
}

/**
 * Resolve a service by key, instantiating dependencies first.
 * Throws if the key is not registered.
 */
export function resolve<T>(key: string): T {
	const descriptor = _registry.get(key);
	if (!descriptor) {
		throw new Error(`Service not found: ${key}`);
	}

	// Resolve all dependencies before instantiating this service
	for (const depKey of descriptor.dependencies) {
		resolve(depKey);
	}

	if (descriptor.singleton && descriptor.instance !== undefined) {
		return descriptor.instance as T;
	}

	const instance = descriptor.factory();
	if (descriptor.singleton) {
		descriptor.instance = instance;
	}
	return instance as T;
}

/**
 * Check if a key is registered (useful for diagnostics).
 */
export function isRegistered(key: string): boolean {
	return _registry.has(key);
}

/**
 * List all registered service keys (for debugging).
 */
export function listRegistered(): string[] {
	return Array.from(_registry.keys());
}

/**
 * Reset the registry. Used between test runs.
 */
export function resetRegistry(): void {
	_registry.clear();
}
