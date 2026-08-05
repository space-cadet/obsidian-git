import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const archivePath = 'dist/obsidian-git-sync-v1.0.0.zip';

test('release archive contains every required plugin runtime file', () => {
  execFileSync(process.execPath, ['scripts/build-archive.mjs'], { stdio: 'pipe' });

  const listing = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .sort();

  assert.deepEqual(listing, [
    'obsidian-git-sync/README.md',
    'obsidian-git-sync/main.js',
    'obsidian-git-sync/manifest.json',
    'obsidian-git-sync/styles.css',
    'obsidian-git-sync/versions.json',
  ]);
});

test('release archive contains the current manifest version', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const archivedManifest = execFileSync(
    'unzip',
    ['-p', archivePath, 'obsidian-git-sync/manifest.json'],
    { encoding: 'utf8' }
  );

  assert.equal(JSON.parse(archivedManifest).version, manifest.version);
});
