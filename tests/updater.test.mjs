import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Module from 'node:module';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-updater-tests-'));
const bundlePath = join(temporaryDirectory, 'updater.cjs');
let requestUrlImpl = async () => { throw new Error('unexpected request'); };

class Modal {
  constructor(app) { this.app = app; this.contentEl = {}; }
  open() {}
  close() {}
}

class Notice {}
class Setting {}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal,
      Notice,
      Setting,
      requestUrl: (...args) => requestUrlImpl(...args),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

buildSync({
  entryPoints: ['src/updater/PluginUpdater.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  external: ['obsidian'],
  logLevel: 'silent',
});

const { PluginUpdater, compareVersions, commitInfoFromRelease, releaseLabel } = await import(bundlePath);

test.after(() => {
  Module._load = originalLoad;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function jsonResponse(value) {
  return { status: 200, text: JSON.stringify(value) };
}

function createAdapter(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const removedDirectories = [];
  let failNextPluginWrite = false;
  return {
    files,
    removedDirectories,
    failNextPluginWrite() { failNextPluginWrite = true; },
    async mkdir() {},
    async exists(path) { return files.has(path); },
    async read(path) {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path);
    },
    async write(path, data) {
      if (failNextPluginWrite && path === '.obsidian/plugins/obsidian-git-sync/manifest.json') {
        failNextPluginWrite = false;
        throw new Error('simulated write failure');
      }
      files.set(path, data);
    },
    async remove(path) { files.delete(path); },
    async rmdir(path) {
      removedDirectories.push(path);
      for (const file of files.keys()) {
        if (file === path || file.startsWith(`${path}/`)) files.delete(file);
      }
    },
  };
}

function createApp(adapter) {
  return { vault: { adapter }, commands: { executeCommandById() {} } };
}

test('compareVersions handles stable versions and rolling dev tags', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9') > 0, true);
  assert.equal(compareVersions('dev', '1.0.0') > 0, true);
  assert.equal(compareVersions('dev', 'dev'), 0);
});

test('release metadata keeps optional commit subjects and hides full SHAs from labels', () => {
  const release = {
    tag_name: 'dev',
    name: 'Dev Build (1234567890abcdef)',
    body: '**Commit:** `1234567890abcdef`\n**Subject:** `Repair sidebar refresh`\n**Built at:** 2026-09-02T00:00:00Z',
    prerelease: true,
    published_at: '2026-09-02T00:00:00Z',
    assets: [],
  };

  assert.equal(commitInfoFromRelease(release).message, 'Repair sidebar refresh');
  assert.equal(releaseLabel(release), 'Dev · main');
  assert.doesNotMatch(releaseLabel(release), /1234567890abcdef/);
  assert.equal(commitInfoFromRelease({ ...release, body: '**Commit:** `1234567890abcdef`' }).message, '');
});

test('dev channel selects the rolling dev release and suppresses matching commit updates', async () => {
  requestUrlImpl = async ({ url }) => {
    if (url.includes('/releases?')) {
      return jsonResponse([
        { tag_name: 'v1.0.0', prerelease: false, assets: [] },
        {
          tag_name: 'dev',
          name: 'Dev Build',
          body: '**Commit:** `abcdef1234567890`\n**Built at:** 2026-09-02T00:00:00Z',
          prerelease: true,
          assets: [],
        },
      ]);
    }
    if (url.includes('/commits/main')) return jsonResponse({ sha: 'abcdef1234567890' });
    throw new Error(`unexpected URL ${url}`);
  };

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const result = await updater.checkForUpdate('1.0.0', true, 'abcdef1-local-build');
  assert.equal(result.hasUpdate, false);
  assert.equal(result.commitMatch, true);
  assert.equal(result.latestVersion, 'dev');
  assert.equal(result.release.tag_name, 'dev');
});

test('dev channel detects a fresh main build using the release workflow format', async () => {
  requestUrlImpl = async ({ url }) => {
    if (url.includes('/releases?')) {
      return jsonResponse([{
        tag_name: 'dev',
        name: 'Dev Build (fedcba9876543210)',
        body: 'Latest development build from `main`.\n- Commit: fedcba9876543210\n- Branch: main\n- Timestamp: 2026-09-02T00:00:00Z',
        prerelease: true,
        published_at: '2026-09-02T00:00:00Z',
        assets: [],
      }]);
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const result = await updater.checkForUpdate('1.0.0', true, '0123456-local-build');
  assert.equal(result.hasUpdate, true);
  assert.equal(result.commitMatch, false);
  assert.equal(result.latestCommit.sha, 'fedcba9876543210');
  assert.equal(result.latestCommit.committedAt, '2026-09-02T00:00:00Z');
});

test('dev channel falls back to the branch head when release metadata is incomplete', async () => {
  requestUrlImpl = async ({ url }) => {
    if (url.includes('/releases?')) {
      return jsonResponse([{
        tag_name: 'dev',
        name: 'Older-format dev build',
        body: 'Latest development build from `main`.',
        prerelease: true,
        published_at: '2026-09-02T00:00:00Z',
        assets: [],
      }]);
    }
    if (url.includes('/commits/main')) {
      return jsonResponse({
        sha: 'fedcba9876543210',
        commit: { message: 'Fresh main build', author: { name: 'Build Bot', date: '2026-09-02T00:00:00Z' } },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const result = await updater.checkForUpdate('dev', true, '0123456-local-build');
  assert.equal(result.hasUpdate, true);
  assert.equal(result.latestCommit.sha, 'fedcba9876543210');
  assert.equal(result.latestCommit.message, 'Fresh main build');
});

test('stable channel compares the latest stable release', async () => {
  requestUrlImpl = async ({ url }) => {
    assert.match(url, /\/releases\/latest\?_cb=/);
    return jsonResponse({ tag_name: 'v1.1.0', prerelease: false, assets: [] });
  };

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const result = await updater.checkForUpdate('1.0.0', false);
  assert.equal(result.hasUpdate, true);
  assert.equal(result.isPrerelease, false);
  assert.equal(result.latestVersion, '1.1.0');
});

test('dev channel uses the commit recorded in the rolling release', async () => {
  requestUrlImpl = async ({ url }) => {
    assert.match(url, /\/releases\?/);
    return jsonResponse([{
      tag_name: 'dev',
      name: 'Dev Build',
      body: '**Commit:** `1234567890abcdef`\n**Built at:** 2026-09-02T00:00:00Z',
      prerelease: true,
      published_at: '2026-09-02T00:00:00Z',
      assets: [],
    }]);
  };

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const result = await updater.checkForUpdate('1.0.0', true, 'fedcba9-local-build');
  assert.equal(result.hasUpdate, true);
  assert.equal(result.latestCommit.sha, '1234567890abcdef');
});

test('stable channel reports a GitHub error instead of saying it is up to date', async () => {
  requestUrlImpl = async () => ({
    status: 404,
    text: JSON.stringify({ message: 'Not Found' }),
  });

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const result = await updater.checkForUpdate('1.0.0', false);
  assert.equal(result.hasUpdate, false);
  assert.equal(result.release, null);
  assert.equal(result.error, 'Not Found');
});

test('listAvailableBuilds exposes branch and release commit metadata', async () => {
  requestUrlImpl = async ({ url }) => {
    assert.match(url, /releases\?per_page=100&page=1&_cb=/);
    return jsonResponse([
      {
        tag_name: 'v1.0.0',
        name: 'Stable build',
        body: '',
        prerelease: false,
        published_at: '2026-09-01T00:00:00Z',
        assets: [],
      },
      {
        tag_name: 'dev',
        name: 'Main dev build',
        body: '**Commit:** `1234567890abcdef`\n**Built at:** 2026-09-02T00:00:00Z',
        prerelease: true,
        published_at: '2026-09-02T00:00:00Z',
        assets: [],
      },
      {
        tag_name: 'latest-dev-feature-ui',
        name: 'Feature UI build',
        body: '**Commit:** `abcdef1234567890`\n**Built at:** 2026-09-02T00:00:00Z',
        prerelease: true,
        published_at: '2026-09-02T00:00:00Z',
        assets: [],
      },
    ]);
  };

  const updater = new PluginUpdater(createApp(createAdapter()), 'obsidian-git-sync');
  const builds = await updater.listAvailableBuilds();
  assert.equal(builds.length, 3);
  assert.equal(builds[0].branch, 'main');
  assert.equal(builds[1].commitHash, '1234567890abcdef');
  assert.equal(builds[1].commitMessage, '');
  assert.equal(builds[2].branch, 'feature-ui');
  assert.equal(builds[2].commitHash, 'abcdef1234567890');
});

test('downloadUpdate requires direct release assets and validates plugin identity', async () => {
  const adapter = createAdapter();
  requestUrlImpl = async ({ url }) => {
    const filename = url.split('/').pop();
    if (filename === 'manifest.json') return jsonResponse({ id: 'obsidian-git-sync', version: '1.1.0' });
    return { text: `updated ${filename}` };
  };

  const updater = new PluginUpdater(createApp(adapter), 'obsidian-git-sync');
  const tempDir = await updater.downloadUpdate({
    tag_name: 'v1.1.0',
    name: 'v1.1.0',
    body: '',
    prerelease: false,
    published_at: '',
    html_url: '',
    assets: ['main.js', 'manifest.json', 'styles.css'].map((name) => ({
      name,
      browser_download_url: `https://example.test/${name}`,
    })),
  });

  assert.equal(await adapter.exists(`${tempDir}/main.js`), true);
  await assert.rejects(
    updater.downloadUpdate({
      tag_name: 'v1.1.0',
      name: 'v1.1.0',
      body: '',
      prerelease: false,
      published_at: '',
      html_url: '',
      assets: [],
    }),
    /missing main\.js/,
  );
  assert.equal(adapter.removedDirectories.length, 1);
});

test('installUpdate restores every original file after a partial write failure', async () => {
  const pluginDir = '.obsidian/plugins/obsidian-git-sync';
  const adapter = createAdapter({
    [`${pluginDir}/main.js`]: 'old main',
    [`${pluginDir}/manifest.json`]: '{"id":"obsidian-git-sync","version":"1.0.0"}',
    [`${pluginDir}/styles.css`]: 'old css',
    [`${pluginDir}/.update-tmp/main.js`]: 'new main',
    [`${pluginDir}/.update-tmp/manifest.json`]: '{"id":"obsidian-git-sync","version":"1.1.0"}',
    [`${pluginDir}/.update-tmp/styles.css`]: 'new css',
  });
  const updater = new PluginUpdater(createApp(adapter), 'obsidian-git-sync');
  adapter.failNextPluginWrite();

  await assert.rejects(
    updater.installUpdate(`${pluginDir}/.update-tmp`),
    /rolled back/,
  );
  assert.equal(await adapter.read(`${pluginDir}/main.js`), 'old main');
  assert.equal(await adapter.read(`${pluginDir}/manifest.json`), '{"id":"obsidian-git-sync","version":"1.0.0"}');
  assert.equal(await adapter.read(`${pluginDir}/styles.css`), 'old css');
  assert.deepEqual(adapter.removedDirectories, [`${pluginDir}/.update-tmp`]);
});
