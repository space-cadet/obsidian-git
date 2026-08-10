export interface SecretStorageLike {
	setSecret(id: string, secret: string): void;
	getSecret(id: string): string | null;
}

export const MIN_SECRET_STORAGE_VERSION = '1.11.4';

export class UnsupportedCredentialStorageError extends Error {
	constructor() {
		super(`Secure credential storage requires Obsidian ${MIN_SECRET_STORAGE_VERSION} or newer.`);
		this.name = 'UnsupportedCredentialStorageError';
	}
}

export class MissingCredentialError extends Error {
	constructor() {
		super('No Git credential is stored. Enter a credential before using a remote.');
		this.name = 'MissingCredentialError';
	}
}

export function createSecretId(vaultName: string): string {
	let hash = 2166136261;
	for (const character of vaultName || 'default') {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return `git-sync-password-${(hash >>> 0).toString(16)}`;
}

export class CredentialStore {
	constructor(private readonly storage: SecretStorageLike, private readonly secretId: string) {}

	get(): string {
		const secret = this.storage.getSecret(this.secretId);
		if (!secret) throw new MissingCredentialError();
		return secret;
	}

	set(secret: string): void {
		this.storage.setSecret(this.secretId, secret);
	}
}

export async function migrateLegacySecret(
	store: CredentialStore,
	legacySecret: string,
	persistSettings: () => Promise<void>,
): Promise<boolean> {
	if (!legacySecret) return false;
	store.set(legacySecret);
	await persistSettings();
	return true;
}

export function credentialStoreFromApp(app: any, secretId: string): CredentialStore {
	const storage = app?.secretStorage as SecretStorageLike | undefined;
	if (!storage || typeof storage.getSecret !== 'function' || typeof storage.setSecret !== 'function') {
		throw new UnsupportedCredentialStorageError();
	}
	return new CredentialStore(storage, secretId);
}
