import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Module from 'node:module';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-security-tests-'));
const bundlePath = join(temporaryDirectory, 'security.cjs');
const originalLoad = Module._load;

buildSync({
	entryPoints: ['src/security.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outfile: bundlePath,
	logLevel: 'silent',
});

const security = await import(bundlePath);

test.after(() => {
	Module._load = originalLoad;
	rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('redaction removes credentials from text and structured data', () => {
	const text = security.redactSensitiveText(
		'Authorization: Basic abc123; token=secret-token; https://user:pass@example.test/repo',
		['secret-token'],
	);
	assert.doesNotMatch(text, /secret-token|abc123|user:pass/);
	assert.match(text, /\[REDACTED\]/);

	const data = security.redactSensitiveData({ password: 'secret-token', nested: 'secret-token' }, ['secret-token']);
	assert.equal(data.password, '[REDACTED]');
	assert.equal(data.nested, '[REDACTED]');
});

test('remote URLs are trimmed and embedded credentials are rejected', () => {
	assert.equal(security.normalizeRemoteUrl('  https://example.test/repo.git  '), 'https://example.test/repo.git');
	assert.throws(() => security.normalizeRemoteUrl('https://user:pass@example.test/repo.git'), /embedded credentials/);
});

test('automatic staging excludes plugin-owned files but preserves vault files', () => {
	assert.deepEqual(
		security.filterAutomaticallyStagedPaths([
			'Notes/today.md',
			'.obsidian/plugins/obsidian-git-sync/data.json',
			'.obsidian/plugins/obsidian-git-sync/debug-log.md',
			'Projects/demo.md',
		]),
		['Notes/today.md', 'Projects/demo.md'],
	);
});
