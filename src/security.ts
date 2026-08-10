const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
	'authorization', 'password', 'passwd', 'pat', 'secret', 'token',
	'credential', 'credentials', 'cookie', 'set-cookie'
]);

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSensitiveText(value: string, secrets: readonly string[] = []): string {
	let result = String(value);
	for (const secret of secrets) {
		if (secret && secret.length >= 3) {
			result = result.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
		}
	}
	result = result.replace(/(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`);
	result = result.replace(/(authorization\s*[:=]\s*)(?:basic|bearer)\s+[^\s,;]+/gi, `$1${REDACTED}`);
	result = result.replace(/\bBasic\s+[A-Za-z0-9+/=]+/g, `Basic ${REDACTED}`);
	result = result.replace(/\b(?:ghp|github_pat|glpat)-[A-Za-z0-9_-]+/g, REDACTED);
	return result;
}

export function redactSensitiveData(value: unknown, secrets: readonly string[] = []): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') return redactSensitiveText(value, secrets);
	if (typeof value !== 'object') return value;
	if (value instanceof Error) {
		return {
			name: value.name,
			message: redactSensitiveText(value.message, secrets),
			stack: value.stack ? redactSensitiveText(value.stack, secrets) : undefined,
		};
	}
	if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, secrets));

	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		output[key] = SENSITIVE_KEYS.has(key.toLowerCase())
			? REDACTED
			: redactSensitiveData(item, secrets);
	}
	return output;
}

export function normalizeRemoteUrl(value: string): string {
	const url = value.trim();
	if (/^[a-z][a-z\d+.-]*:\/\/[^\s/@]+@/i.test(url)) {
		throw new Error('Repository URL must not contain embedded credentials');
	}
	return url;
}

export function isProtectedSyncPath(filepath: string, pluginId = 'obsidian-git-sync'): boolean {
	const path = filepath.replace(/\\/g, '/').replace(/^\.\//, '');
	const pluginPath = `.obsidian/plugins/${pluginId}`;
	return path === pluginPath || path.startsWith(`${pluginPath}/`);
}

export function filterAutomaticallyStagedPaths(paths: readonly string[]): string[] {
	return paths.filter((filepath) => !isProtectedSyncPath(filepath));
}
