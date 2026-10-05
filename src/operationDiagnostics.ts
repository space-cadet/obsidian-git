export function elapsedMilliseconds(startedAt: number): number {
	return Math.max(0, Date.now() - startedAt);
}

export function formatMilliseconds(milliseconds: number): string {
	return `${Math.max(0, Math.round(milliseconds))} ms`;
}

export function describeOperationError(error: unknown, fallback: string): string {
	return formatOperationError(error, new Set<unknown>()) || fallback;
}

function formatOperationError(error: unknown, seen: Set<unknown>): string {
	if (typeof error === "string") return error;
	if ((!isRecord(error) && !(error instanceof Error)) || seen.has(error)) return "";
	seen.add(error);

	const record = error as Record<string, unknown>;
	const details: string[] = [];
	const message = record.message;
	if (typeof message === "string" && message) details.push(message);
	if (typeof record.code === "string") details.push(`code=${record.code}`);
	if (typeof record.caller === "string") details.push(`caller=${record.caller}`);

	const nested = Array.isArray(record.errors)
		? record.errors
		: isRecord(record.data) && Array.isArray(record.data.errors)
			? record.data.errors
			: [];
	if (nested.length > 0) {
		const nestedDetails = nested
			.map((entry) => formatOperationError(entry, seen))
			.filter((entry) => entry.length > 0);
		const visibleDetails = nestedDetails.slice(0, 20);
		if (visibleDetails.length > 0) {
			details.push(`underlying=${visibleDetails.map((entry, index) => `[${index + 1}] ${entry}`).join("; ")}`);
			if (nestedDetails.length > visibleDetails.length) details.push(`underlying-more=${nestedDetails.length - visibleDetails.length}`);
		}
	}

	return details.join(" ");
}


function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
