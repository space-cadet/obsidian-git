export type RepositoryFailureKind =
	| 'authentication'
	| 'permission'
	| 'invalid-url'
	| 'network'
	| 'empty-remote'
	| 'unknown';

function errorDetails(error: unknown): { code?: string; message: string; status?: number } {
	const value = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
	const data = (value.data && typeof value.data === 'object')
		? value.data as Record<string, unknown>
		: {};
	const message = error instanceof Error ? error.message : String(error);
	const statusValue = data.statusCode ?? data.status ?? value.statusCode ?? value.status;
	const status = typeof statusValue === 'number' ? statusValue : Number(statusValue);
	return {
		code: typeof value.code === 'string' ? value.code : undefined,
		message,
		status: Number.isFinite(status) ? status : undefined,
	};
}

export function classifyRepositoryError(error: unknown): RepositoryFailureKind {
	const { code, message, status } = errorDetails(error);
	const text = message.toLowerCase();

	if (code === 'EmptyServerResponseError' || /empty response|no refs? found|no matching ref/.test(text)) {
		return 'empty-remote';
	}
	if (status === 401 || /401|unauthorized|authentication|invalid credential|bad credential/.test(text)) {
		return 'authentication';
	}
	if (status === 403 || status === 404 || /403|forbidden|permission denied|access denied/.test(text)) {
		return 'permission';
	}
	if (/invalid url|malformed url|bad url|not a valid url/.test(text)) return 'invalid-url';
	if (/econn|etimedout|timeout|network|socket|connection reset|fetch failed/.test(text)) {
		return 'network';
	}
	return 'unknown';
}

export class RepositoryInitializationError extends Error {
	readonly kind: RepositoryFailureKind;

	constructor(kind: RepositoryFailureKind, message: string) {
		super(message);
		this.name = 'RepositoryInitializationError';
		this.kind = kind;
	}
}

export function repositoryFailureMessage(kind: RepositoryFailureKind): string {
	const messages: Record<RepositoryFailureKind, string> = {
		authentication: 'Remote authentication failed. Check the saved credential.',
		permission: 'The remote repository denied access or was not found.',
		'invalid-url': 'The repository URL is invalid.',
		network: 'The remote repository could not be reached.',
		'empty-remote': 'The remote repository is empty.',
		unknown: 'The repository operation failed.',
	};
	return messages[kind];
}
