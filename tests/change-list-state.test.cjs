const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./support/load-typescript.cjs");

const { applyStagingToSnapshot, replaceChangedPaths } = loadTypeScript("src/ChangeListState.ts");

const untracked = { path: "new.md", status: "Untracked", staged: false };
const added = { path: "added.md", status: "Added", staged: true };
const modified = { path: "changed.md", status: "Modified", staged: false };

test("staging converts untracked files to Added and preserves unrelated snapshot rows", () => {
	const current = [untracked, modified];
	const next = applyStagingToSnapshot(current, [untracked], true);

	assert.deepEqual(next, [
		{ path: "new.md", status: "Added", staged: true },
		modified,
	]);
	assert.equal(next[1], modified);
});

test("unstaging converts Added files back to Untracked and updates staged state", () => {
	const next = applyStagingToSnapshot([added, modified], [added, modified], false);

	assert.deepEqual(next, [
		{ path: "added.md", status: "Untracked", staged: false },
		{ path: "changed.md", status: "Modified", staged: false },
	]);
});

test("path refresh replaces affected rows, removes absent affected rows, and keeps others", () => {
	const deleted = { path: "deleted.md", status: "Modified", staged: false };
	const current = [untracked, modified, deleted];
	const update = { path: "new.md", status: "Added", staged: true };
	const newFile = { path: "new-file.md", status: "Untracked", staged: false };
	const next = replaceChangedPaths(current, ["new.md", "deleted.md", "new-file.md"], [update, newFile]);

	assert.deepEqual(next, [modified, update, newFile]);
	assert.equal(next[0], modified);
});

test("staging an unavailable snapshot preserves null", () => {
	assert.equal(applyStagingToSnapshot(null, [untracked], true), null);
});
