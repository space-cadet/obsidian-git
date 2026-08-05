import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Module from 'node:module';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-tests-'));
const bundlePath = join(temporaryDirectory, 'git-manager.cjs');
const notices = [];
const originalLoad = Module._load;
let requestUrlImpl = async () => { throw new Error('not used in unit tests'); };

class Notice {
  constructor(message) {
    this.messages = [message];
    this.hidden = false;
    notices.push(this);
  }

  setMessage(message) {
    this.messages.push(message);
  }

  hide() {
    this.hidden = true;
  }
}

class Modal {
  constructor() {}
  open() {}
  close() {}
}

Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal,
      Notice,
      requestUrl: (...args) => requestUrlImpl(...args),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

buildSync({
  entryPoints: ['src/gitManager.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  external: ['obsidian'],
  logLevel: 'silent',
});

const {
  GitProgressEmitter,
  arrayBufferToAsyncIterable,
  createGitEmitter,
  createProgressNotice,
  testRemoteConnection,
} = await import(bundlePath);

test.after(() => {
  Module._load = originalLoad;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('arrayBufferToAsyncIterable preserves bytes in bounded zero-copy chunks', async () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, index) => index);
  const chunks = [];
  for await (const chunk of arrayBufferToAsyncIterable(bytes.buffer, 4)) chunks.push(chunk);

  assert.deepEqual(chunks.map((chunk) => [...chunk]), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
  assert.ok(chunks.every((chunk) => chunk.buffer === bytes.buffer));
});

test('arrayBufferToAsyncIterable supports empty responses and rejects invalid chunk sizes', async () => {
  const chunks = [];
  for await (const chunk of arrayBufferToAsyncIterable(new ArrayBuffer(0))) chunks.push(chunk);

  assert.deepEqual(chunks, []);
  assert.throws(() => arrayBufferToAsyncIterable(new ArrayBuffer(1), 0), RangeError);
});

test('GitProgressEmitter delivers events and isolates listener failures', () => {
  const emitter = new GitProgressEmitter();
  const received = [];
  emitter.on('progress', () => { throw new Error('listener failure'); });
  emitter.on('progress', (event) => received.push(event));

  emitter.emit('progress', { payload: { phase: 'receiving', loaded: 1024 } });
  assert.deepEqual(received, [{ payload: { phase: 'receiving', loaded: 1024 } }]);
});

test('createGitEmitter normalizes structured progress events', () => {
  let received;
  const emitter = createGitEmitter((phase, loaded, total, lengthComputable) => {
    received = { phase, loaded, total, lengthComputable };
  });

  emitter.emit('progress', { payload: { phase: 'receiving', loaded: 2048, total: 4096, lengthComputable: true } });
  assert.deepEqual(received, { phase: 'receiving', loaded: 2048, total: 4096, lengthComputable: true });
});

test('createProgressNotice reports progress and hides its persistent notice', () => {
  notices.length = 0;
  const [onProgress, onMessage, hideNotice] = createProgressNotice('Pulling');
  onProgress({ phase: 'receiving', loaded: 1024, total: 2048 });
  onMessage('Resolving deltas');
  hideNotice();

  assert.deepEqual(notices[0].messages, [
    'Pulling',
    'Pulling — receiving (50%, 1KB / 2KB)',
    'Pulling — Resolving deltas',
  ]);
  assert.equal(notices[0].hidden, true);
});

test('testRemoteConnection uses a read-only remote ref advertisement without a local repository', async () => {
  const calls = [];
  const pktLine = (text) => `${(Buffer.byteLength(text) + 4).toString(16).padStart(4, '0')}${text}`;
  const advertisedRefs = `${pktLine('# service=git-upload-pack\n')}0000${pktLine('0123456789012345678901234567890123456789 refs/heads/main\0symref=HEAD:refs/heads/main\n')}0000`;

  requestUrlImpl = async (request) => {
    calls.push(request);
    return {
      status: 200,
      headers: { 'content-type': 'application/x-git-upload-pack-advertisement' },
      arrayBuffer: new TextEncoder().encode(advertisedRefs).buffer,
    };
  };

  await testRemoteConnection({
    repoUrl: 'https://example.test/owner/repository.git',
    username: 'token-user',
    password: 'secret-token',
    author: { name: 'Test User', email: 'test@example.test' },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/info\/refs\?service=git-upload-pack$/);
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('token-user:secret-token').toString('base64')}`);
  assert.equal(calls[0].body, undefined);
  requestUrlImpl = async () => { throw new Error('not used in unit tests'); };
});
