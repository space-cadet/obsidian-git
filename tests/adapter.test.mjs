import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Module from 'node:module';
import { createRequire } from 'node:module';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-adapter-tests-'));
const bundlePath = join(temporaryDirectory, 'adapter.cjs');
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return {};
  return originalLoad.call(this, request, parent, isMain);
};

buildSync({
  entryPoints: ['src/adapters/ObsidianFsAdapter.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  external: ['obsidian'],
  logLevel: 'silent',
});

const { ObsidianFsAdapter } = await import(bundlePath);

test.after(() => {
  Module._load = originalLoad;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('ObsidianFsAdapter reports worktree write byte counts through its fs API', async () => {
  const writes = [];
  const dataAdapter = {
    async write(path, value) { writes.push({ type: 'text', path, value }); },
    async writeBinary(path, value) { writes.push({ type: 'binary', path, value }); },
    async read() { return ''; },
    async readBinary() { return new ArrayBuffer(0); },
    async mkdir() {},
    async rmdir() {},
    async list() { return { files: [], folders: [] }; },
    async remove() {},
    async stat() { return null; },
  };
  const adapter = new ObsidianFsAdapter(dataAdapter, '.');
  const events = [];
  const fs = adapter.promises;
  fs.setWriteProgress((path, bytes) => events.push({ path, bytes }));

  await fs.writeFile('./Notes/today.md', 'नमस्ते');
  await fs.writeFile('.git/objects/pack/object.pack', Uint8Array.from([1, 2, 3, 4]));

  assert.deepEqual(events, [
    { path: 'Notes/today.md', bytes: new TextEncoder().encode('नमस्ते').byteLength },
    { path: '.git/objects/pack/object.pack', bytes: 4 },
  ]);
  assert.equal(writes.length, 2);
});

test('ObsidianFsAdapter filters stale entries returned by the vault index', async () => {
  const dataAdapter = {
    async list(path) {
      assert.equal(path, '.');
      return { files: ['trash/missing.md', 'Notes/today.md'], folders: [] };
    },
    async stat(path) {
      return path === 'Notes/today.md' ? { type: 'file', size: 1, mtime: 1, ctime: 1 } : null;
    },
  };
  const adapter = new ObsidianFsAdapter(dataAdapter, '.');

  assert.deepEqual(await adapter.promises.readdir('.'), ['Notes/today.md']);
});

test('ObsidianFsAdapter accepts the Node-style string text encoding', async () => {
  const dataAdapter = {
    async read(path) {
      assert.equal(path, '.gitignore');
      return '.obsidian/\n';
    },
  };
  const adapter = new ObsidianFsAdapter(dataAdapter, '.');

  assert.equal(await adapter.promises.readFile('.gitignore', 'utf8'), '.obsidian/\n');
});

test('ObsidianFsAdapter uses native desktop files for Git metadata', async () => {
  const vaultDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-native-adapter-'));
  const previousWindow = globalThis.window;
  try {
    mkdirSync(join(vaultDirectory, '.git'), { recursive: true });
    writeFileSync(join(vaultDirectory, '.git', 'index'), Buffer.from('DIRC-native-index'));
    globalThis.window = {
      require: createRequire(import.meta.url),
      process,
    };
    const dataAdapter = {
      getBasePath() { return vaultDirectory; },
      async readBinary() { return new ArrayBuffer(0); },
      async list() { return { files: [], folders: [] }; },
      async stat() { return null; },
    };
    const adapter = new ObsidianFsAdapter(dataAdapter, '.');
    const value = await adapter.promises.readFile('.git/index');
    assert.equal(new TextDecoder().decode(value), 'DIRC-native-index');
  } finally {
    globalThis.window = previousWindow;
    rmSync(vaultDirectory, { recursive: true, force: true });
  }
});

test('ObsidianFsAdapter uses the CommonJS loader when window.require is unavailable', async () => {
  const vaultDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-native-global-require-'));
  const previousWindow = globalThis.window;
  try {
    writeFileSync(join(vaultDirectory, 'untracked.md'), 'new file');
    globalThis.window = { process };
    const dataAdapter = {
      getBasePath() { return vaultDirectory; },
      async list() { return { files: [], folders: [] }; },
      async stat() { return null; },
    };
    const adapter = new ObsidianFsAdapter(dataAdapter, '.');
    assert.deepEqual(await adapter.promises.readdir('.'), ['untracked.md']);
  } finally {
    globalThis.window = previousWindow;
    rmSync(vaultDirectory, { recursive: true, force: true });
  }
});
