import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import * as git from 'isomorphic-git';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-rewrite-tests-'));
const bundlePath = join(temporaryDirectory, 'backend.cjs');

buildSync({
  entryPoints: ['src/backend/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});

const {
  GitBackend,
  GitHubApi,
  GitHubDeviceAuth,
  GitProtocolHttp,
  StaticCredentialProvider,
} = await import(bundlePath);

test.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

function config(overrides = {}) {
  return {
    branch: 'main',
    author: { name: 'Rewrite Test', email: 'rewrite@example.test' },
    ...overrides,
  };
}

function noNetwork() {
  return {
    requests: [],
    async request(request) {
      this.requests.push(request);
      throw new Error('network was not expected in this test');
    },
  };
}

async function makeBackend(overrides = {}) {
  const directory = mkdtempSync(join(temporaryDirectory, 'repo-'));
  const transport = overrides.transport || noNetwork();
  const backend = new GitBackend(
    {
      fs: overrides.fs || fsPromises,
      transport,
      credentials: overrides.credentials || new StaticCredentialProvider(null),
    },
    directory,
    config(overrides.config),
  );
  return { directory, backend, transport };
}

test('local status is one direct read and does not require network or UI objects', async () => {
  const { directory, backend, transport } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'note.md'), 'hello');

  const status = await backend.status();
  assert.equal(status.state, 'empty');
  assert.deepEqual(status.changed, ['note.md']);
  assert.equal(status.files[0].change, 'untracked');
  assert.equal(transport.requests.length, 0);

  rmSync(directory, { recursive: true, force: true });
});

test('single-file stage performs the Git mutation without a preceding status scan', async () => {
  const { directory, backend, transport } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'note.md'), 'hello');

  const result = await backend.stage('note.md');
  assert.deepEqual(result, { path: 'note.md', staged: true });
  assert.equal(transport.requests.length, 0);
  const status = await backend.status();
  assert.deepEqual(status.staged, ['note.md']);

  rmSync(directory, { recursive: true, force: true });
});

test('single-file stage does not enumerate the repository worktree', async () => {
  let readdirCalls = 0;
  const instrumentedFs = new Proxy(fsPromises, {
    get(target, property) {
      const value = target[property];
      if (property === 'readdir') return async (...args) => { readdirCalls += 1; return value.apply(target, args); };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const { directory, backend } = await makeBackend({ fs: instrumentedFs });
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'note.md'), 'hello');
  readdirCalls = 0;
  await backend.stage('note.md');
  assert.equal(readdirCalls, 0);

  rmSync(directory, { recursive: true, force: true });
});

test('single-file stage rejects ignored untracked files but permits tracked files after ignore changes', async () => {
  const { directory, backend } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'tracked.private'), 'initial');
  await backend.stage('tracked.private');
  await backend.commit('track private file');

  await fsPromises.writeFile(join(directory, '.gitignore'), '*.private\n');
  await fsPromises.writeFile(join(directory, 'secret.private'), 'secret');
  await assert.rejects(backend.stage('secret.private'), /ignored by \.gitignore/);

  await fsPromises.writeFile(join(directory, 'tracked.private'), 'changed');
  const result = await backend.stage('tracked.private');
  assert.deepEqual(result, { path: 'tracked.private', staged: true });

  rmSync(directory, { recursive: true, force: true });
});

test('bulk staging returns successful and failed paths without hiding partial work', async () => {
  const { directory, backend } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'one.md'), 'one');
  await fsPromises.writeFile(join(directory, 'two.md'), 'two');

  const result = await backend.stageAll(['one.md', '../outside', 'two.md']);
  assert.deepEqual(result.requested, ['one.md', '../outside', 'two.md']);
  assert.deepEqual(result.succeeded, ['one.md', 'two.md']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].path, '../outside');

  rmSync(directory, { recursive: true, force: true });
});

test('commit returns a plain result and leaves UI concerns outside the backend', async () => {
  const { directory, backend } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'note.md'), 'hello');
  await backend.stage('note.md');

  const result = await backend.commit('first commit');
  assert.match(result.oid, /^[0-9a-f]{40}$/);
  assert.equal(result.message, 'first commit');
  assert.deepEqual(await backend.history(1).then((items) => items.map((item) => item.message.trim())), ['first commit']);

  rmSync(directory, { recursive: true, force: true });
});

test('health distinguishes a missing repository, empty repository, and healthy repository', async () => {
  const { directory, backend } = await makeBackend();
  assert.equal((await backend.health()).state, 'missing');
  await backend.initialize();
  assert.equal((await backend.health()).state, 'empty');
  await fsPromises.writeFile(join(directory, 'note.md'), 'hello');
  await backend.stage('note.md');
  await backend.commit('first commit');
  const health = await backend.health();
  assert.equal(health.state, 'healthy');
  assert.equal(health.branch, 'main');
  assert.match(health.head, /^[0-9a-f]{40}$/);
  assert.equal(health.index, 'readable');

  rmSync(directory, { recursive: true, force: true });
});

test('index maintenance is explicit and preserves worktree files during repair', async () => {
  const { directory, backend } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'tracked.md'), 'before');
  await backend.stage('tracked.md');
  await backend.commit('first commit');
  await fsPromises.writeFile(join(directory, 'tracked.md'), 'modified');
  await fsPromises.writeFile(join(directory, 'untracked.md'), 'untracked');
  await fsPromises.writeFile(join(directory, '.git', 'index'), Buffer.alloc(0));

  const preview = await backend.previewIndexRepair();
  assert.equal(preview.index.state, 'empty');
  assert.equal(preview.modifiedFiles, 1);
  assert.equal(preview.untrackedFiles, 1);

  const repaired = await backend.rebuildIndexFromHead();
  assert.equal(repaired.trackedFiles, 1);
  assert.equal(repaired.stagedStateRecovered, false);
  assert.equal(await fsPromises.readFile(join(directory, 'tracked.md'), 'utf8'), 'modified');
  assert.equal(await fsPromises.readFile(join(directory, 'untracked.md'), 'utf8'), 'untracked');
  assert.equal((await backend.checkIndex()).state, 'healthy');
  const backup = await backend.previewLatestIndexBackup();
  assert.equal(backup.size, 0);
  assert.equal(backup.validFormat, false);

  rmSync(directory, { recursive: true, force: true });
});

test('gitignore editing is backend data, not a UI side effect', async () => {
  const { directory, backend } = await makeBackend();
  await backend.initialize();
  assert.equal(await backend.readGitignore(), '');
  const first = await backend.addIgnorePattern('attachments/');
  assert.equal(first.changed, true);
  const duplicate = await backend.addIgnorePattern('attachments/');
  assert.equal(duplicate.changed, false);
  assert.equal(await backend.readGitignore(), 'attachments/\n');
  const written = await backend.writeGitignore('*.tmp\n');
  assert.equal(written.content, '*.tmp\n');
  assert.equal(await backend.readGitignore(), '*.tmp\n');

  rmSync(directory, { recursive: true, force: true });
});

test('commit details are calculated from the commit tree and its parent', async () => {
  const { directory, backend } = await makeBackend();
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'added.md'), 'added');
  await fsPromises.writeFile(join(directory, 'changed.md'), 'before');
  await backend.stageAll(['added.md', 'changed.md']);
  await backend.commit('first commit');
  await fsPromises.writeFile(join(directory, 'changed.md'), 'after');
  await fsPromises.writeFile(join(directory, 'new.md'), 'new');
  await fsPromises.rm(join(directory, 'added.md'));
  await backend.stageAll(['changed.md', 'new.md', 'added.md']);
  const commit = await backend.commit('second commit');
  assert.deepEqual(await backend.commitFiles(commit.oid), [
    { path: 'added.md', change: 'deleted' },
    { path: 'changed.md', change: 'modified' },
    { path: 'new.md', change: 'added' },
  ]);

  rmSync(directory, { recursive: true, force: true });
});

test('remote comparison is explicit and does not delay the local status path', async () => {
  const { directory, backend } = await makeBackend({ config: { remoteUrl: 'https://github.com/example/repo.git' } });
  await backend.initialize();
  await fsPromises.writeFile(join(directory, 'note.md'), 'hello');
  await backend.stage('note.md');
  const first = await backend.commit('first commit');
  await git.writeRef({ fs: fsPromises, dir: directory, ref: 'refs/remotes/origin/main', value: first.oid, force: true });

  assert.equal((await backend.status()).comparison, 'unavailable');
  assert.equal((await backend.status({ compareRemote: true })).comparison, 'up-to-date');

  rmSync(directory, { recursive: true, force: true });
});

test('remote testing is read-only and does not require a local repository', async () => {
  const calls = [];
  const transport = {
    async request(request) {
      calls.push(request);
      const payload = new TextEncoder().encode('001e# service=git-upload-pack\n0000');
      return { status: 200, headers: {}, body: payload, text: new TextDecoder().decode(payload) };
    },
  };
  const { directory, backend } = await makeBackend({
    transport,
    config: { remoteUrl: 'https://github.com/example/repo.git' },
    credentials: new StaticCredentialProvider({ username: 'x-access-token', password: 'secret', source: 'github' }),
  });
  await backend.testRemote();
  assert.ok(calls.length >= 1);
  assert.equal((await backend.status()).state, 'missing');

  rmSync(directory, { recursive: true, force: true });
});

test('Git protocol transport obtains credentials through a port and returns git response shape', async () => {
  const requests = [];
  const transport = {
    async request(request) {
      requests.push(request);
      return { status: 200, headers: { 'content-type': 'application/x-git-upload-pack-result' }, body: new Uint8Array([1, 2]), text: '' };
    },
  };
  const http = new GitProtocolHttp(transport, async () => ({ username: 'x-access-token', password: 'secret', source: 'github' }));
  const response = await http.request({ url: 'https://github.com/example/repo.git', method: 'GET', body: (async function* () { yield new Uint8Array([3]); })() });
  assert.match(requests[0].headers.Authorization, /^Basic /);
  assert.equal(response.statusCode, 200);
  const chunks = [];
  for await (const chunk of response.body) chunks.push([...chunk]);
  assert.deepEqual(chunks, [[1, 2]]);
});

test('GitHub device authorization handles pending approval and returns a Git credential', async () => {
  const requests = [];
  const responses = [
    { status: 200, headers: {}, body: new Uint8Array(), text: JSON.stringify({ device_code: 'device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 }) },
    { status: 200, headers: {}, body: new Uint8Array(), text: JSON.stringify({ error: 'authorization_pending' }) },
    { status: 200, headers: {}, body: new Uint8Array(), text: JSON.stringify({ access_token: 'github-oauth-token', token_type: 'bearer', scope: 'repo' }) },
  ];
  const auth = new GitHubDeviceAuth({
    clientId: 'client-id',
    transport: { async request(request) { requests.push(request); return responses.shift(); } },
    wait: async () => {},
    now: () => 0,
  });
  const session = await auth.authenticate();
  assert.equal(session.credential.source, 'github');
  assert.equal(session.credential.password, 'github-oauth-token');
  assert.equal(session.userCode, 'ABCD-EFGH');
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /device\/code$/);
  assert.match(requests[1].url, /access_token$/);
});

test('GitHub API validates an authenticated session and repository access', async () => {
  const calls = [];
  const payloads = [
    { status: 200, value: { login: 'rewrite-user', id: 7 } },
    { status: 200, value: { full_name: 'space-cadet/git-test-small', private: true, default_branch: 'main' } },
    { status: 200, value: { files: [
      { filename: 'added.md', status: 'added' },
      { filename: 'removed.md', status: 'removed' },
    ] } },
  ];
  const api = new GitHubApi({
    async request(request) {
      calls.push(request);
      const response = payloads.shift();
      return { status: response.status, headers: {}, body: new Uint8Array(), text: JSON.stringify(response.value) };
    },
  }, 'github-oauth-token');
  assert.deepEqual(await api.getAuthenticatedUser(), { login: 'rewrite-user', id: 7 });
  assert.deepEqual(await api.getRepository('https://github.com/space-cadet/git-test-small.git'), {
    fullName: 'space-cadet/git-test-small', private: true, defaultBranch: 'main',
  });
  assert.equal(calls[0].headers.Authorization, 'Bearer github-oauth-token');
  assert.equal(calls[1].headers.Authorization, 'Bearer github-oauth-token');
  assert.deepEqual(await api.getCommitFiles('https://github.com/space-cadet/git-test-small.git', 'abc123'), [
    { path: 'added.md', change: 'added' },
    { path: 'removed.md', change: 'deleted' },
  ]);
  assert.equal(calls[2].headers.Authorization, 'Bearer github-oauth-token');
});
