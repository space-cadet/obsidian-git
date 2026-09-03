import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-coordinator-tests-'));
const bundlePath = join(temporaryDirectory, 'operation-coordinator.cjs');

buildSync({
  entryPoints: ['src/operationCoordinator.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});

const { OperationCoordinator, OperationInProgressError } = await import(bundlePath);

test.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

test('serializes mutations and exposes the active operation', async () => {
  const coordinator = new OperationCoordinator();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });

  const first = coordinator.run('clone', async ({ signal }) => {
    assert.equal(signal.aborted, false);
    assert.deepEqual(coordinator.activeOperation, { id: 1, name: 'clone' });
    await blocked;
    return 'done';
  });

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    coordinator.run('push', async () => 'unexpected'),
    (error) => error instanceof OperationInProgressError && error.operationName === 'clone',
  );

  release();
  assert.equal(await first, 'done');
  assert.equal(coordinator.activeOperation, null);
  assert.equal(await coordinator.run('push', async () => 'pushed'), 'pushed');
});

test('cancellation and disposal abort the active operation', async () => {
  const coordinator = new OperationCoordinator();
  let observedSignal;
  const running = coordinator.run('pull', async ({ signal }) => {
    observedSignal = signal;
    await new Promise((resolve) => setImmediate(resolve));
    return signal.aborted;
  });

  await Promise.resolve();
  coordinator.cancelActive();
  assert.equal(await running, true);
  assert.equal(observedSignal.aborted, true);

  const second = coordinator.run('commit', async ({ signal }) => {
    await new Promise((resolve) => setImmediate(resolve));
    return signal.aborted;
  });
  coordinator.dispose();
  assert.equal(await second, true);
  await assert.rejects(coordinator.run('push', async () => 'unexpected'), /unavailable after plugin unload/);
});
