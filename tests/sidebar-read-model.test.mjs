import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-sidebar-read-model-tests-'));
const bundlePath = join(temporaryDirectory, 'sidebar-read-model.cjs');

buildSync({
  entryPoints: ['src/sidebarReadModel.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});

const { SidebarReadModel } = await import(bundlePath);

test.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test('history caches are keyed by their repository and branch', () => {
  const model = new SidebarReadModel();
  const commits = [{ oid: 'a', message: 'remote', author: 'Test', date: new Date(0), files: [] }];

  model.setRemoteCommits('https://example.test/repo.git', 'main', commits);
  assert.strictEqual(model.getRemoteCommits('https://example.test/repo.git', 'main'), commits);
  assert.equal(model.getRemoteCommits('https://example.test/repo.git', 'develop'), null);
  assert.equal(model.getRemoteCommits('https://example.test/other.git', 'main'), null);
  assert.equal(model.getRemoteRepositoryUrl(), 'https://example.test/repo.git');

  model.setLocalCommits('main', commits);
  assert.strictEqual(model.getLocalCommits('main'), commits);
  assert.equal(model.getLocalCommits('develop'), null);
});

test('commit details and log entries survive view recreation until invalidated', () => {
  const model = new SidebarReadModel();
  const files = [{ filepath: 'README.md', status: 'modified' }];
  const entries = [{ timestamp: 1, level: 'info', namespace: 'Test', message: 'one' }];

  model.setCommitDetails('abc', files);
  model.setLogEntries(entries);
  assert.strictEqual(model.getCommitDetails('abc'), files);
  assert.strictEqual(model.getLogEntries(), entries);

  model.invalidateLogs();
  assert.equal(model.getLogEntries(), null);
  assert.strictEqual(model.getCommitDetails('abc'), files);

  model.invalidateHistory();
  assert.equal(model.getCommitDetails('abc'), null);
  assert.equal(model.getLocalCommits('main'), null);
  assert.equal(model.getRemoteRepositoryUrl(), null);
});
