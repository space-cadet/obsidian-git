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

const { OperationCoordinator, OperationCancelledError, OperationInProgressError } = await import(bundlePath);

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
	const lifecycle = [];
	coordinator.subscribe((event) => lifecycle.push(event.lifecycle));
	const running = coordinator.run('pull', async ({ signal }) => {
		observedSignal = signal;
		await new Promise((resolve) => setImmediate(resolve));
		return 'late success';
	});

	await Promise.resolve();
	coordinator.cancelActive();
	await assert.rejects(running, (error) => error instanceof OperationCancelledError);
	assert.equal(observedSignal.aborted, true);
	assert.deepEqual(lifecycle, ['started', 'cancelled', 'idle']);

	const second = coordinator.run('commit', async ({ signal }) => {
		await new Promise((resolve) => setImmediate(resolve));
		return signal.aborted ? 'cancelled by unload' : 'unexpected';
	});
	coordinator.dispose();
	await assert.rejects(second, (error) => error instanceof OperationCancelledError);
	await assert.rejects(coordinator.run('push', async () => 'unexpected'), /unavailable after plugin unload/);
});

test('listener failures do not change the operation outcome', async () => {
	const coordinator = new OperationCoordinator();
	coordinator.subscribe(() => { throw new Error('observer failed'); });
	assert.equal(await coordinator.run('commit', async () => 'committed'), 'committed');
});

test('failed operations finalize once and release admission', async () => {
	const coordinator = new OperationCoordinator();
	const lifecycle = [];
	const unsubscribe = coordinator.subscribe((event) => lifecycle.push(event.lifecycle));

	await assert.rejects(
		coordinator.run('push', async () => { throw new Error('remote rejected'); }),
		/remote rejected/,
	);
	assert.equal(coordinator.activeOperation, null);
	assert.deepEqual(lifecycle, ['started', 'failed', 'idle']);

	unsubscribe();
	assert.equal(await coordinator.run('pull', async () => 'pulled'), 'pulled');
	assert.deepEqual(lifecycle, ['started', 'failed', 'idle']);
});
