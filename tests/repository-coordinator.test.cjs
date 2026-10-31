const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./support/load-typescript.cjs");

const { RepositoryMutationCoordinator } = loadTypeScript("src/RepositoryMutationCoordinator.ts");

function gate() {
	let release;
	const promise = new Promise((resolve) => { release = resolve; });
	return { promise, release };
}

test("mutations serialize for one repository and overlapping roots", async () => {
	const coordinator = new RepositoryMutationCoordinator();
	const active = gate();
	let childStarted = false;
	const parent = coordinator.run("projects", () => active.promise);
	await Promise.resolve();
	const child = coordinator.run("projects/nested", async () => { childStarted = true; });
	await Promise.resolve();
	assert.equal(childStarted, false);
	assert.equal(coordinator.isBusy("projects/nested"), true);
	active.release();
	await Promise.all([parent, child]);
	assert.equal(childStarted, true);
	assert.equal(coordinator.isBusy(), false);
});

test("mutations in sibling repositories can proceed independently", async () => {
	const coordinator = new RepositoryMutationCoordinator();
	const alpha = gate();
	const beta = gate();
	let alphaStarted = false;
	let betaStarted = false;
	const alphaRun = coordinator.run("alpha", async () => { alphaStarted = true; await alpha.promise; });
	const betaRun = coordinator.run("beta", async () => { betaStarted = true; await beta.promise; });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(alphaStarted, true);
	assert.equal(betaStarted, true);
	alpha.release();
	beta.release();
	await Promise.all([alphaRun, betaRun]);
});
