/**
 * Recursively converts BigInt values to strings for JSON serialization
 */
export function serializeBigInt<T>(obj: T): T {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === "bigint") {
		return obj.toString() as unknown as T;
	}

	if (Array.isArray(obj)) {
		return obj.map(serializeBigInt) as unknown as T;
	}

	// Dates must pass through untouched - recursing into one via Object.entries
	// yields {} (no enumerable keys), silently erasing every timestamp.
	if (obj instanceof Date) {
		return obj.toISOString() as unknown as T;
	}

	if (typeof obj === "object" && obj !== null) {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = serializeBigInt(value);
		}
		return result as T;
	}

	return obj;
}
