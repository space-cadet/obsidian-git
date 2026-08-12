import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Module from 'node:module';

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
