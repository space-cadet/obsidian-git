import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Module from 'node:module';
import * as git from 'isomorphic-git';

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
  GitManager,
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

test('arrayBufferToAsyncIterable reports consumed bytes and honours cancellation', async () => {
  const progress = [];
  const bytes = Uint8Array.from({ length: 9 }, (_, index) => index);
  for await (const chunk of arrayBufferToAsyncIterable(
    bytes.buffer,
    4,
    (loaded, total) => progress.push({ loaded, total }),
  )) {
    assert.ok(chunk.byteLength <= 4);
  }
  assert.deepEqual(progress, [
    { loaded: 0, total: 9 },
    { loaded: 4, total: 9 },
    { loaded: 8, total: 9 },
    { loaded: 9, total: 9 },
  ]);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    async () => {
      for await (const _chunk of arrayBufferToAsyncIterable(bytes.buffer, 4, undefined, controller.signal)) {}
    },
    /Git operation cancelled/,
  );
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

test('createProgressNotice keeps object and byte progress separate', () => {
  notices.length = 0;
  const progress = createProgressNotice('Pulling');
  progress.onProgress({ phase: 'receiving', loaded: 1024, total: 2048 });
  progress.onTransfer({ bytesLoaded: 1024, bytesTotal: 2048, lengthComputable: true });
  progress.onMessage('Resolving deltas');
  progress.complete();

  assert.deepEqual(notices[0].messages, [
    'Pulling',
    'Pulling — receiving (50%, 1,024 / 2,048 objects)',
    'Pulling — Data 1 KB / 2 KB',
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

test('sync does not initialize or clone a missing local repository', async () => {
  let remoteCalls = 0;
  requestUrlImpl = async () => {
    remoteCalls += 1;
    throw new Error('remote should not be contacted');
  };

  const missingRepositoryFs = {
    stat: async () => { throw new Error('ENOENT'); },
    lstat: async () => { throw new Error('ENOENT'); },
    readdir: async () => { throw new Error('ENOENT'); },
    readFile: async () => { throw new Error('ENOENT'); },
  };
  const manager = new GitManager(missingRepositoryFs, '.', {
    repoUrl: 'https://example.test/owner/repository.git',
    username: 'token-user',
    password: 'secret-token',
    author: { name: 'Test User', email: 'test@example.test' },
  });

  await assert.rejects(
    manager.sync('https://example.test/owner/repository.git', 'main', 'test'),
    /No local git repository found/,
  );
  assert.equal(remoteCalls, 0);
  requestUrlImpl = async () => { throw new Error('not used in unit tests'); };
});

test('addAll stages more than ten changed files', async () => {
  const stageDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-add-all-'));
  try {
    await git.init({ fs: fsPromises, dir: stageDirectory, defaultBranch: 'main' });
    for (let index = 1; index <= 25; index += 1) {
      await fsPromises.writeFile(join(stageDirectory, `changed-${String(index).padStart(2, '0')}.md`), `file ${index}\n`);
    }

    const manager = new GitManager(fsPromises, stageDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    const result = await manager.addAll();
    assert.equal(result.requested, 25);
    assert.equal(result.staged.length, 25);
    assert.deepEqual(result.failed, []);

    const matrix = await git.statusMatrix({ fs: fsPromises, dir: stageDirectory });
    assert.equal(matrix.filter(([, , , stage]) => stage !== 0 && stage !== 1).length, 25);
  } finally {
    rmSync(stageDirectory, { recursive: true, force: true });
  }
});

test('clone retains initialized partial git state when the remote fails', async () => {
  const cloneDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-resume-'));
  requestUrlImpl = async () => {
    throw new Error('Connection reset by peer');
  };

  const manager = new GitManager(fsPromises, cloneDirectory, {
    repoUrl: 'https://example.test/owner/repository.git',
    username: 'token-user',
    password: 'secret-token',
    author: { name: 'Test User', email: 'test@example.test' },
  });

  await assert.rejects(
    manager.cloneRepository('https://example.test/owner/repository.git', 'main', 1),
    /Connection reset by peer/,
  );
  assert.equal(await fsPromises.stat(join(cloneDirectory, '.git/HEAD')).then(() => true), true);
  assert.equal(await fsPromises.stat(join(cloneDirectory, '.git/config')).then(() => true), true);

  rmSync(cloneDirectory, { recursive: true, force: true });
  requestUrlImpl = async () => { throw new Error('not used in unit tests'); };
});

test('clone resumes checkout without refetching a completed fetch', async () => {
  const cloneDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-checkout-resume-'));
  const repoUrl = 'https://example.test/owner/repository.git';

  await git.init({ fs: fsPromises, dir: cloneDirectory, defaultBranch: 'main' });
  await git.addRemote({ fs: fsPromises, dir: cloneDirectory, remote: 'origin', url: repoUrl });
  await fsPromises.writeFile(join(cloneDirectory, 'README.md'), 'resumed checkout');
  await git.add({ fs: fsPromises, dir: cloneDirectory, filepath: 'README.md' });
  const oid = await git.commit({
    fs: fsPromises,
    dir: cloneDirectory,
    message: 'Fetched commit',
    author: { name: 'Test User', email: 'test@example.test' },
  });
  await git.writeRef({ fs: fsPromises, dir: cloneDirectory, ref: 'refs/remotes/origin/main', value: oid });
  await fsPromises.rm(join(cloneDirectory, 'README.md'));
  await fsPromises.writeFile(
    join(cloneDirectory, '.git/obsidian-git-sync-checkout.json'),
    JSON.stringify({ version: 1, repoUrl, branchName: 'main', depth: 1, oid }),
  );
  assert.equal((JSON.parse(await fsPromises.readFile(join(cloneDirectory, '.git/obsidian-git-sync-checkout.json'), 'utf8'))).repoUrl, repoUrl);
  assert.equal(await git.resolveRef({ fs: fsPromises, dir: cloneDirectory, ref: 'refs/remotes/origin/main' }), oid);
  await git.readCommit({ fs: fsPromises, dir: cloneDirectory, oid });

  let requestCount = 0;
  requestUrlImpl = async () => {
    requestCount += 1;
    throw new Error('fetch should be skipped');
  };

  const manager = new GitManager(fsPromises, cloneDirectory, {
    repoUrl,
    username: 'token-user',
    password: 'secret-token',
    author: { name: 'Test User', email: 'test@example.test' },
  });

  assert.equal(await manager.hasPendingCheckout(repoUrl, 'main', 1), true);
  await manager.cloneRepository(repoUrl, 'main', 1);
  assert.equal(requestCount, 0);
  assert.equal(await fsPromises.readFile(join(cloneDirectory, 'README.md'), 'utf8'), 'resumed checkout');
  await assert.rejects(fsPromises.stat(join(cloneDirectory, '.git/obsidian-git-sync-checkout.json')), /ENOENT/);

  rmSync(cloneDirectory, { recursive: true, force: true });
  requestUrlImpl = async () => { throw new Error('not used in unit tests'); };
});
