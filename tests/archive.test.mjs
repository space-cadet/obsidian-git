import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const archivePath = 'dist/obsidian-git-sync-v1.0.0.zip';
const unpackedPluginPath = 'dist';
const requiredFiles = ['README.md', 'main.js', 'manifest.json', 'styles.css', 'versions.json'];

test('release archive contains every required plugin runtime file', () => {
  execFileSync(process.execPath, ['scripts/build-archive.mjs'], { stdio: 'pipe' });

  const listing = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .sort();

  assert.deepEqual(listing, requiredFiles.map((file) => `obsidian-git-sync/${file}`).sort());
});

test('archive build copies the unpacked plugin files into dist', () => {
  for (const file of requiredFiles) {
    assert.equal(existsSync(`${unpackedPluginPath}/${file}`), true);
    assert.equal(
      readFileSync(`${unpackedPluginPath}/${file}`, 'utf8'),
      readFileSync(file, 'utf8'),
      `${file} should match the source build output`,
    );
  }
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
