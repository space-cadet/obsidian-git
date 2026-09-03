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
  compareRepositoryPaths,
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

test('remote GitHub history accepts common repository URL variants', async () => {
  requestUrlImpl = async ({ url }) => {
    assert.match(url, /api\.github\.com\/repos\/space-cadet\/obsidian-git\/commits\?sha=main&per_page=5$/);
    return {
      status: 200,
      text: JSON.stringify([{
        sha: '0123456789abcdef0123456789abcdef01234567',
        commit: {
          message: 'Remote commit',
          author: { name: 'Remote Author', date: '2026-09-02T00:00:00Z' },
        },
      }]),
    };
  };

  const commits = await GitManager.fetchRemoteCommitsFromGitHub(
    'https://github.com/space-cadet/obsidian-git.git/',
    '',
    'main',
    5,
  );
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, 'Remote commit');
  assert.equal(commits[0].remote, true);
  requestUrlImpl = async () => { throw new Error('not used in unit tests'); };
});

test('remote GitHub commit details use the native requestUrl transport', async () => {
  requestUrlImpl = async ({ url, headers }) => {
    assert.match(url, /api\.github\.com\/repos\/space-cadet\/obsidian-git\/commits\/0123456/);
    assert.equal(headers.Authorization, 'Bearer secret-token');
    return {
      status: 200,
      text: JSON.stringify({
        files: [
          { filename: 'notes/added.md', status: 'added' },
          { filename: 'notes/old.md', status: 'removed' },
        ],
      }),
    };
  };

  const files = await GitManager.fetchCommitFilesFromGitHub(
    'https://github.com/space-cadet/obsidian-git/',
    'secret-token',
    '0123456789abcdef',
  );
  assert.deepEqual(files, [
    { filepath: 'notes/added.md', status: 'added' },
    { filepath: 'notes/old.md', status: 'deleted' },
  ]);
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

test('repository health distinguishes missing, empty, healthy, and damaged metadata', async () => {
  const repositoryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-health-'));
  try {
    const manager = new GitManager(fsPromises, repositoryDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    assert.deepEqual(await manager.checkRepositoryHealth(), {
      state: 'missing',
      exists: false,
      healthy: false,
      branch: null,
      hasCommits: false,
      reason: 'missing .git directory',
    });

    await git.init({ fs: fsPromises, dir: repositoryDirectory, defaultBranch: 'main' });
    const empty = await manager.checkRepositoryHealth();
    assert.equal(empty.state, 'healthy');
    assert.equal(empty.exists, true);
    assert.equal(empty.hasCommits, false);
    assert.equal(empty.branch, 'main');

    await fsPromises.writeFile(join(repositoryDirectory, 'README.md'), 'healthy\n');
    await git.add({ fs: fsPromises, dir: repositoryDirectory, filepath: 'README.md' });
    await git.commit({
      fs: fsPromises,
      dir: repositoryDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    const healthy = await manager.checkRepositoryHealth();
    assert.equal(healthy.state, 'healthy');
    assert.equal(healthy.hasCommits, true);

    await fsPromises.unlink(join(repositoryDirectory, '.git/HEAD'));
    const damaged = await manager.checkRepositoryHealth();
    assert.equal(damaged.state, 'damaged');
    assert.equal(damaged.exists, true);
    assert.equal(damaged.healthy, false);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test('repository comparison reports a missing upstream instead of false up-to-date', async () => {
  const repositoryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-comparison-'));
  try {
    await git.init({ fs: fsPromises, dir: repositoryDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(repositoryDirectory, 'README.md'), 'one\n');
    await git.add({ fs: fsPromises, dir: repositoryDirectory, filepath: 'README.md' });
    const oid = await git.commit({
      fs: fsPromises,
      dir: repositoryDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    const manager = new GitManager(fsPromises, repositoryDirectory, {
      repoUrl: '', username: '', password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    assert.deepEqual(await manager.getStatus(), {
      branch: 'main', ahead: 1, behind: 0, comparison: 'local-only',
      comparisonError: 'Could not find refs/remotes/origin/main.',
    });
    await git.writeRef({ fs: fsPromises, dir: repositoryDirectory, ref: 'refs/remotes/origin/main', value: oid });
    const upToDate = await manager.getStatus();
    assert.equal(upToDate.comparison, 'up-to-date');
    assert.equal(upToDate.ahead, 0);
    assert.equal(upToDate.behind, 0);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test('repository health detects an empty index and repair rebuilds it without changing vault files', async () => {
  const repositoryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-index-repair-'));
  try {
    await git.init({ fs: fsPromises, dir: repositoryDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(repositoryDirectory, 'tracked.md'), 'original\n');
    await fsPromises.writeFile(join(repositoryDirectory, 'deleted.md'), 'to be deleted\n');
    await git.add({ fs: fsPromises, dir: repositoryDirectory, filepath: 'tracked.md' });
    await git.add({ fs: fsPromises, dir: repositoryDirectory, filepath: 'deleted.md' });
    await git.commit({
      fs: fsPromises,
      dir: repositoryDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    await fsPromises.writeFile(join(repositoryDirectory, 'tracked.md'), 'modified\n');
    await fsPromises.unlink(join(repositoryDirectory, 'deleted.md'));
    await fsPromises.writeFile(join(repositoryDirectory, 'untracked.md'), 'new\n');
    await fsPromises.writeFile(join(repositoryDirectory, '.git/index'), new Uint8Array());

    const manager = new GitManager(fsPromises, repositoryDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    const damaged = await manager.checkRepositoryHealth();
    assert.equal(damaged.state, 'damaged');
    assert.equal(damaged.reason, 'Git index is empty (.git/index)');

    const preview = await manager.previewIndexRepair();
    assert.equal(preview.index.state, 'empty');
    assert.equal(preview.trackedFiles, 2);
    assert.equal(preview.modifiedFiles, 1);
    assert.equal(preview.deletedFiles, 1);
    assert.equal(preview.untrackedFiles, 1);
    assert.equal(preview.unchangedFiles, 0);
    assert.equal((await fsPromises.stat(join(repositoryDirectory, '.git/index'))).size, 0);

    const result = await manager.rebuildIndexFromHead();
    assert.equal(result.trackedFiles, 2);
    assert.equal(result.worktreeFiles, 2);
    assert.equal(result.stagedStateRecovered, false);
    assert.ok(result.backupPath);
    assert.equal((await fsPromises.stat(result.backupPath)).size, 0);
    assert.equal(await fsPromises.readFile(join(repositoryDirectory, 'tracked.md'), 'utf8'), 'modified\n');
    await assert.rejects(fsPromises.stat(join(repositoryDirectory, 'deleted.md')), /ENOENT/);
    assert.equal(await fsPromises.readFile(join(repositoryDirectory, 'untracked.md'), 'utf8'), 'new\n');

    const matrix = await git.statusMatrix({ fs: fsPromises, dir: repositoryDirectory });
    const rows = new Map(matrix.map((row) => [row[0], row]));
    assert.deepEqual(rows.get('tracked.md'), ['tracked.md', 1, 2, 1]);
    assert.deepEqual(rows.get('deleted.md'), ['deleted.md', 1, 0, 1]);
    assert.deepEqual(rows.get('untracked.md'), ['untracked.md', 0, 2, 0]);
    assert.equal((await manager.checkRepositoryHealth()).state, 'healthy');
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test('repository index repair can restore the latest valid backup', async () => {
  const repositoryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-index-restore-'));
  try {
    await git.init({ fs: fsPromises, dir: repositoryDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(repositoryDirectory, 'README.md'), 'healthy\n');
    await git.add({ fs: fsPromises, dir: repositoryDirectory, filepath: 'README.md' });
    await git.commit({
      fs: fsPromises,
      dir: repositoryDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    const validIndex = await fsPromises.readFile(join(repositoryDirectory, '.git/index'));
    await fsPromises.writeFile(join(repositoryDirectory, '.git/index'), new Uint8Array());

    const manager = new GitManager(fsPromises, repositoryDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    // A real repair backup is non-empty; write the valid index into the
    // backup slot to exercise the restore path independently.
    await fsPromises.writeFile(join(repositoryDirectory, '.git/index.obsidian-git-backup-123'), validIndex);
    assert.equal(await manager.restoreLatestIndexBackup(), 'index.obsidian-git-backup-123');
    assert.equal((await manager.checkRepositoryIndex()).state, 'healthy');
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test('repository rebuild comparison reports each path outcome deterministically', () => {
  assert.deepEqual(
    compareRepositoryPaths(
      new Map([
        ['conflict.md', 'local'],
        ['local-only.md', 'local'],
        ['same.md', 'same'],
      ]),
      new Map([
        ['conflict.md', 'remote'],
        ['remote-only.md', 'remote'],
        ['same.md', 'same'],
      ]),
    ),
    {
      localOnly: ['local-only.md'],
      remoteOnly: ['remote-only.md'],
      conflicts: ['conflict.md'],
      unchanged: ['same.md'],
    },
  );
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

test('addAll stages present files in bounded index batches', async () => {
  const stageDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-add-batch-'));
  let indexWrites = 0;
  const countedFs = new Proxy(fsPromises, {
    get(target, property, receiver) {
      if (property === 'writeFile') {
        return async (...args) => {
          if (String(args[0]).endsWith('/.git/index')) indexWrites += 1;
          return target.writeFile(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  try {
    await git.init({ fs: fsPromises, dir: stageDirectory, defaultBranch: 'main' });
    for (let index = 1; index <= 25; index += 1) {
      await fsPromises.writeFile(join(stageDirectory, `changed-${String(index).padStart(2, '0')}.md`), `file ${index}\n`);
    }

    const manager = new GitManager(countedFs, stageDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    const result = await manager.addAll();
    assert.equal(result.requested, 25);
    assert.equal(result.staged.length, 25);
    assert.deepEqual(result.failed, []);
    assert.equal(indexWrites, 1);
  } finally {
    rmSync(stageDirectory, { recursive: true, force: true });
  }
});

test('addAll stages tracked deletions without reading the missing file', async () => {
  const stageDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-add-deletion-'));
  try {
    await git.init({ fs: fsPromises, dir: stageDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(stageDirectory, 'deleted.md'), 'file to delete\n');
    await git.add({ fs: fsPromises, dir: stageDirectory, filepath: 'deleted.md' });
    await git.commit({
      fs: fsPromises,
      dir: stageDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    await fsPromises.unlink(join(stageDirectory, 'deleted.md'));

    const manager = new GitManager(fsPromises, stageDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    const result = await manager.addAll(['deleted.md']);
    assert.equal(result.requested, 1);
    assert.deepEqual(result.staged, ['deleted.md']);
    assert.deepEqual(result.failed, []);

    const matrix = await git.statusMatrix({ fs: fsPromises, dir: stageDirectory });
    assert.deepEqual(matrix, [['deleted.md', 1, 0, 0]]);
    assert.deepEqual(await manager.getStatusGroups(), { staged: ['deleted.md'], unstaged: [] });
  } finally {
    rmSync(stageDirectory, { recursive: true, force: true });
  }
});

test('stageFile stages a tracked deletion without reading the missing file', async () => {
  const stageDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-stage-deletion-'));
  try {
    await git.init({ fs: fsPromises, dir: stageDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(stageDirectory, 'deleted.md'), 'file to delete\n');
    await git.add({ fs: fsPromises, dir: stageDirectory, filepath: 'deleted.md' });
    await git.commit({
      fs: fsPromises,
      dir: stageDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    await fsPromises.unlink(join(stageDirectory, 'deleted.md'));

    const manager = new GitManager(fsPromises, stageDirectory, {
      repoUrl: '',
      username: '',
      password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });

    await manager.stageFile('deleted.md');

    const matrix = await git.statusMatrix({ fs: fsPromises, dir: stageDirectory });
    assert.deepEqual(matrix, [['deleted.md', 1, 0, 0]]);
  } finally {
    rmSync(stageDirectory, { recursive: true, force: true });
  }
});

test('staging rejects ignored untracked paths but preserves tracked paths matching a new rule', async () => {
  const stageDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-ignore-stage-'));
  try {
    await git.init({ fs: fsPromises, dir: stageDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(stageDirectory, 'tracked.tmp'), 'initial\n');
    await git.add({ fs: fsPromises, dir: stageDirectory, filepath: 'tracked.tmp' });
    await git.commit({
      fs: fsPromises,
      dir: stageDirectory,
      message: 'initial',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    await fsPromises.writeFile(join(stageDirectory, '.gitignore'), '*.tmp\nignored-dir/\n');
    await fsPromises.writeFile(join(stageDirectory, 'tracked.tmp'), 'modified\n');
    await fsPromises.writeFile(join(stageDirectory, 'ignored.tmp'), 'secret\n');
    await fsPromises.mkdir(join(stageDirectory, 'ignored-dir'));
    await fsPromises.writeFile(join(stageDirectory, 'ignored-dir/nested.md'), 'secret\n');

    const manager = new GitManager(fsPromises, stageDirectory, {
      repoUrl: '', username: '', password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    const result = await manager.addAll(['tracked.tmp', 'ignored.tmp', 'ignored-dir/nested.md', '.gitignore']);
    assert.deepEqual(result.staged.sort(), ['.gitignore', 'tracked.tmp']);
    assert.deepEqual(result.failed.map(({ filepath }) => filepath).sort(), ['ignored-dir/nested.md', 'ignored.tmp']);
    assert.match(result.failed[0].message, /ignored by \.gitignore/);

    const matrix = new Map((await git.statusMatrix({ fs: fsPromises, dir: stageDirectory })).map((row) => [row[0], row]));
    assert.equal(matrix.get('tracked.tmp')[3], 2);
    assert.equal(matrix.get('.gitignore')[3], 2);
    assert.equal(matrix.has('ignored.tmp'), false);
    assert.equal(matrix.has('ignored-dir/nested.md'), false);
  } finally {
    rmSync(stageDirectory, { recursive: true, force: true });
  }
});

test('stageFile rejects a directly supplied ignored untracked path', async () => {
  const stageDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-ignore-single-'));
  try {
    await git.init({ fs: fsPromises, dir: stageDirectory, defaultBranch: 'main' });
    await fsPromises.writeFile(join(stageDirectory, '.gitignore'), 'private/**\n');
    await fsPromises.mkdir(join(stageDirectory, 'private'));
    await fsPromises.writeFile(join(stageDirectory, 'private/note.md'), 'secret\n');
    const manager = new GitManager(fsPromises, stageDirectory, {
      repoUrl: '', username: '', password: '',
      author: { name: 'Test User', email: 'test@example.test' },
    });
    await assert.rejects(manager.stageFile('private/note.md'), /ignored by \.gitignore/);
    assert.equal((await git.statusMatrix({ fs: fsPromises, dir: stageDirectory })).some(([filepath]) => filepath === 'private/note.md'), false);
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
