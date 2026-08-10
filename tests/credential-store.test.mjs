import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-credential-tests-'));
const bundlePath = join(temporaryDirectory, 'credential-store.cjs');

buildSync({
	entryPoints: ['src/credentialStore.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outfile: bundlePath,
	logLevel: 'silent',
});

const {
	CredentialStore,
	MissingCredentialError,
	UnsupportedCredentialStorageError,
	credentialStoreFromApp,
	createSecretId,
	migrateLegacySecret,
} = await import(bundlePath);

test.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test('credential store writes and reads through the host secret storage', () => {
	const values = new Map();
	const store = new CredentialStore({
		setSecret: (id, value) => values.set(id, value),
		getSecret: (id) => values.get(id) || null,
	}, 'git-sync-password-test');

	store.set('secret-token');
	assert.equal(store.get(), 'secret-token');
});

test('credential store rejects missing credentials and unsupported hosts', () => {
	const store = new CredentialStore({ getSecret: () => null, setSecret: () => {} }, 'git-sync-password-test');
	assert.throws(() => store.get(), MissingCredentialError);
	assert.throws(() => credentialStoreFromApp({}, 'git-sync-password-test'), UnsupportedCredentialStorageError);
});

test('legacy migration stores the secret before persisting settings', async () => {
	const values = new Map();
	const store = new CredentialStore({
		setSecret: (id, value) => values.set(id, value),
		getSecret: (id) => values.get(id) || null,
	}, 'git-sync-password-test');
	let persisted = false;

	assert.equal(await migrateLegacySecret(store, 'legacy-token', async () => { persisted = true; }), true);
	assert.equal(store.get(), 'legacy-token');
	assert.equal(persisted, true);
});

test('secret IDs are stable and host-compatible', () => {
	const id = createSecretId('Research Vault');
	assert.equal(id, createSecretId('Research Vault'));
	assert.match(id, /^git-sync-password-[0-9a-f]+$/);
});
