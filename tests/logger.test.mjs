import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Module from 'node:module';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-logger-tests-'));
const bundlePath = join(temporaryDirectory, 'logger.cjs');
const originalLoad = Module._load;

class Notice {}
Module._load = function(request, parent, isMain) {
	if (request === 'obsidian') return { Notice, normalizePath: (value) => value };
	return originalLoad.call(this, request, parent, isMain);
};

buildSync({
	entryPoints: ['src/logger.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	external: ['obsidian'],
	outfile: bundlePath,
	logLevel: 'silent',
});

const { log, LogLevel } = await import(bundlePath);

test.after(() => {
	Module._load = originalLoad;
	rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('logger redacts credentials before retention and export', () => {
	log.setLogLevel(LogLevel.ERROR);
	log.setShowNotices(false);
	log.setSensitiveValues(['secret-token']);
	log.info('Test', 'Remote https://user:pass@example.test/repo token=secret-token', {
		Authorization: 'Basic abc123',
		password: 'secret-token',
	});
	log.error('Test', 'Request failed', new Error('secret-token was rejected'));

	const output = JSON.stringify(log.getEntries());
	assert.doesNotMatch(output, /secret-token|abc123|user:pass/);
	assert.match(output, /\[REDACTED\]/);
});
