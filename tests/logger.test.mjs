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

class Notice {
	static messages = [];
	constructor(message) {
		Notice.messages.push(message);
	}
}
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

test('logger does not repeat the same background notice immediately', () => {
	log.setLogLevel(LogLevel.WARN);
	log.setShowNotices(true);
	const before = Notice.messages.length;
	log.warn('Refresh', 'Repeated background warning');
	log.warn('Refresh', 'Repeated background warning');
	assert.equal(Notice.messages.length - before, 1);
	log.setShowNotices(false);
});

test('logger sends only explicit plugin entries to the persistent sink', () => {
  const entries = [];
  log.setLogLevel(LogLevel.INFO);
  log.setFileLogSink((level, ...args) => entries.push({ level, args }));
  log.info('GitManager', 'Plugin-owned diagnostic');
  log.setFileLogSink(null);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 'info');
  assert.match(entries[0].args[0], /^\[Git Sync\]\[GitManager\]/);
  assert.doesNotMatch(entries[0].args[0], /Dataview|ObsidianAI/);
});

test('logger merges the live and persisted copy of one event once', () => {
  log.clear();
  log.setLogLevel(LogLevel.INFO);
  const originalNow = Date.now;
  const timestamp = 1725400479000;
  Date.now = () => timestamp;
  try {
    log.mergePersistedEntries([{
      timestamp: timestamp - 50,
      level: 'info',
      namespace: 'GitOperation',
      message: 'Operation started',
      data: { operation: 'Stage all files', operationId: 1 },
    }]);
    log.info('GitOperation', 'Operation started', { operation: 'Stage all files', operationId: 1 });
    assert.equal(log.getEntries().length, 1);
  } finally {
    Date.now = originalNow;
    log.clear();
  }
});
