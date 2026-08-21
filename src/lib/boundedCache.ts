/** Bounded insertion-order eviction — Map iterates oldest-first. */
export function put<T>(cache: Map<string, T>, key: string, value: T, max: number): void {
	cache.set(key, value);
	if (cache.size > max) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}
