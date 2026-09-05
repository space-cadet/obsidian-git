import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Module from 'node:module';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-file-logger-tests-'));
const bundlePath = join(temporaryDirectory, 'file-logger.cjs');
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return { Platform: { isMobile: false } };
  return originalLoad.call(this, request, parent, isMain);
};

buildSync({
  entryPoints: ['src/fileLogger.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['obsidian'],
  outfile: bundlePath,
  logLevel: 'silent',
});

const { FileLogger } = await import(bundlePath);

test.after(() => {
  Module._load = originalLoad;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('readEntries restores structured data so live and persisted logs deduplicate', async () => {
  const adapter = {
    read: async () => [
      '[2026-09-04T00:54:39.000Z] [INFO] [Git Sync][GitOperation] Operation started {"operation":"Stage all files","operationId":1}\n',
      '[2026-09-04T00:54:40.000Z] [INFO] [Git Sync][GitBackend] Repository status: branch=main, ahead=0, behind=0 {"comparison":"up-to-date"}\n',
    ].join(''),
  };
  const logger = new FileLogger({ vault: { configDir: '.obsidian', adapter } }, 'obsidian-git-sync');

  assert.deepEqual(await logger.readEntries(), [
    {
      timestamp: Date.parse('2026-09-04T00:54:39.000Z'),
      level: 'info',
      namespace: 'GitOperation',
      message: 'Operation started',
      data: { operation: 'Stage all files', operationId: 1 },
    },
    {
      timestamp: Date.parse('2026-09-04T00:54:40.000Z'),
      level: 'info',
      namespace: 'GitBackend',
      message: 'Repository status: branch=main, ahead=0, behind=0',
      data: { comparison: 'up-to-date' },
    },
  ]);
});

test('unchanged memory snapshots are not persisted repeatedly', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousPerformance = globalThis.performance;
  let scheduled = 0;
  globalThis.window = {
    setTimeout() { scheduled += 1; return scheduled; },
    clearTimeout() {},
  };
  globalThis.document = {
    getElementsByTagName() { return { length: 2984 }; },
  };
  globalThis.performance = {
    memory: {
      usedJSHeapSize: 110.6 * 1024 * 1024,
      totalJSHeapSize: 117.3 * 1024 * 1024,
      jsHeapSizeLimit: 2994.5 * 1024 * 1024,
    },
  };

  try {
    const logger = new FileLogger({ vault: { configDir: '.obsidian', adapter: {} } }, 'obsidian-git-sync');
    logger.logMemorySnapshot();
    logger.logMemorySnapshot();

    assert.equal(logger.buffer.length, 1);
    assert.equal(scheduled, 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.performance = previousPerformance;
  }
});
