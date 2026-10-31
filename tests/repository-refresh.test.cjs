const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./support/load-typescript.cjs");
const { MemoryAdapter } = require("./support/memory-adapter.cjs");
const {
	ObsidianGitFs, initializeRepository, stageFile, commitChanges, readChanges,
} = loadTypeScript("src/repository.ts");

class CountingAdapter extends MemoryAdapter {
	resetCounts() {
		this.calls = { exists: [], stat: [], list: [], writes: [] };
	}
	async exists(path) { this.calls?.exists.push(path); return super.exists(path); }
	async stat(path) { this.calls?.stat.push(path); return super.stat(path); }
	async list(path) { this.calls?.list.push(path); return super.list(path); }
	async write(path, data) { this.calls?.writes.push(path); return super.write(path, data); }
	async writeBinary(path, data) { this.calls?.writes.push(path); return super.writeBinary(path, data); }
}

async function fixture(root = ".") {
	const adapter = new CountingAdapter();
	const prefix = root === "." ? "" : `${root}/`;
	for (let dir = 0; dir < 8; dir++) {
		for (let file = 0; file < 12; file++) {
			await adapter.write(`${prefix}notes-${dir}/note-${file}.md`, `note ${dir}/${file}\n`);
		}
	}
	await initializeRepository(adapter, root);
	await stageFile(adapter, root, Array.from({ length: 8 }, (_, i) => `notes-${i}`));
	await commitChanges(adapter, root, "Initial", { name: "Test", email: "test@example.com" });
	adapter.resetCounts();
	return adapter;
}

async function scan(adapter, root, paths) {
	let metrics;
	const changes = await readChanges(adapter, root, paths, (value) => { metrics = value; });
	return { changes, metrics };
}

test("full scans check index metadata once, skip file boundary probes, and never write", async () => {
	const adapter = await fixture();
	const indexBefore = await adapter.readBinary(".git/index");
	const { changes, metrics } = await scan(adapter, ".");
	assert.deepEqual(changes, []);
	assert.equal(adapter.calls.stat.filter((path) => path === ".git/index").length, 1);
	assert.equal(metrics.indexStatCalls, 1);
	assert.equal(adapter.calls.exists.filter((path) => path.endsWith(".md/.git")).length, 0);
	assert.deepEqual(adapter.calls.writes, []);
	assert.deepEqual(await adapter.readBinary(".git/index"), indexBefore);
	assert.equal(metrics.statCalls, adapter.calls.stat.length);
	assert.equal(metrics.directoryLists, adapter.calls.list.length);
});

test("path refreshes prune siblings and match full status for edits, deletions, and staged files", async () => {
	for (const root of [".", "vault/repo"]) {
		const adapter = await fixture(root);
		const prefix = root === "." ? "" : `${root}/`;
		await adapter.write(`${prefix}notes-0/note-0.md`, "changed\n");
		await adapter.remove(`${prefix}notes-0/note-1.md`);
		await adapter.write(`${prefix}notes-0/new.md`, "new\n");
		await adapter.write(`${prefix}notes-7/note-0.md`, "unrelated edit\n");
		await stageFile(adapter, root, "notes-0/note-2.md");
		const full = await readChanges(adapter, root);
		adapter.resetCounts();
		const scoped = await scan(adapter, root, ["./notes-0/"]);
		assert.deepEqual(scoped.changes, full.filter((change) => change.path.startsWith("notes-0/")));
		assert.ok(scoped.changes.some((change) => change.status === "Deleted"));
		assert.ok(adapter.calls.list.every((path) => path === root || path === `${prefix}notes-0`));
		assert.ok(!adapter.calls.stat.some((path) => path.startsWith(`${prefix}notes-7/`)));
		assert.ok(scoped.metrics.statCalls < 40);
		assert.deepEqual(adapter.calls.writes, []);
	}
});

test("single-file refreshes preserve deleted and staged paths without inspecting their siblings", async () => {
	const adapter = await fixture();
	await adapter.write("notes-0/note-0.md", "staged edit\n");
	await stageFile(adapter, ".", "notes-0/note-0.md");
	await adapter.remove("notes-0/note-1.md");
	const paths = ["notes-0/note-0.md", "notes-0/note-1.md"];
	const full = await readChanges(adapter, ".");
	adapter.resetCounts();
	const { changes } = await scan(adapter, ".", paths);
	assert.deepEqual(changes, full.filter((change) => paths.includes(change.path)));
	assert.ok(changes.some((change) => change.staged));
	assert.ok(changes.some((change) => change.status === "Deleted"));
	assert.ok(!adapter.calls.stat.some((path) => path.endsWith("note-2.md")));
});

test("scope filtering respects prefix boundaries and ignore rules read from ancestors", async () => {
	const adapter = await fixture();
	await adapter.write(".gitignore", "ignored.md\nnotes-0/ignored/\n");
	await adapter.write("notes-0/ignored.md", "ignored\n");
	await adapter.write("notes-0/ignored/new.md", "ignored folder\n");
	await adapter.write("notes-01/new.md", "similar prefix\n");
	await adapter.write("notes-0/new.md", "visible new file\n");
	const full = await readChanges(adapter, ".");
	adapter.resetCounts();
	const { changes } = await scan(adapter, ".", ["notes-0"]);
	assert.deepEqual(changes, full.filter((change) => change.path.startsWith("notes-0/")));
	assert.deepEqual(changes.map((change) => change.path), ["notes-0/new.md"]);
	assert.ok(!adapter.calls.list.includes("notes-01"));
	assert.ok(!adapter.calls.stat.includes("notes-01/new.md"));
});

test("pruned status walks still exclude and block nested repositories", async () => {
	const adapter = await fixture("parent");
	await adapter.write("parent/child/note.md", "nested\n");
	await initializeRepository(adapter, "parent/child");
	const changes = await readChanges(adapter, "parent", ["child"]);
	assert.deepEqual(changes, []);
	await assert.rejects(stageFile(adapter, "parent", "child/note.md"), /nested Git repository/);
	const fs = new ObsidianGitFs(adapter, "parent", { filepaths: ["child/note.md"] });
	await assert.rejects(fs.promises.readFile("parent/child/note.md"));
	assert.equal(fs.scanMetrics.worktreeFileReads, 0);
});

test("each scan sees newer index and worktree state and empty scope does no storage work", async () => {
	const adapter = await fixture();
	assert.deepEqual((await scan(adapter, ".")).changes, []);
	await adapter.write("notes-0/note-0.md", "new edit\n");
	assert.equal((await scan(adapter, ".")).changes[0].staged, false);
	await stageFile(adapter, ".", "notes-0/note-0.md");
	assert.equal((await scan(adapter, ".")).changes[0].staged, true);
	adapter.resetCounts();
	const empty = await scan(adapter, ".", []);
	assert.deepEqual(empty.changes, []);
	assert.equal(empty.metrics.statCalls, 0);
	assert.deepEqual(adapter.calls, { exists: [], stat: [], list: [], writes: [] });
	await assert.rejects(readChanges(adapter, ".", ["../outside"]), /parent-directory/);
});

test("normal mutable filesystem instances do not reuse index stats and status instances reject writes", async () => {
	const adapter = await fixture();
	const fs = new ObsidianGitFs(adapter, ".");
	await fs.promises.stat(".git/index");
	await fs.promises.stat(".git/index");
	assert.equal(adapter.calls.stat.filter((path) => path === ".git/index").length, 2);
	const status = new ObsidianGitFs(adapter, ".", { filepaths: ["."] });
	await assert.rejects(status.promises.writeFile(".git/index", "wrong"), /cannot write/);
	await assert.rejects(status.promises.unlink("notes-0/note-0.md"), /cannot write/);
	assert.deepEqual(adapter.calls.writes, []);
});


test("stale listings and misclassified directories retain mobile path validation", async () => {
	const adapter = await fixture();
	await adapter.write("nested/secret.md", "nested contents\n");
	await initializeRepository(adapter, "nested");
	const originalList = adapter.list.bind(adapter);
	adapter.list = async (path) => {
		const listed = await originalList(path);
		if (path === ".") {
			// Mobile listings may be stale; actual stats determine path type.
			listed.files.push("missing.md", "nested");
			listed.folders = listed.folders.filter((folder) => folder !== "nested");
		}
		return listed;
	};
	assert.deepEqual(await readChanges(adapter, "."), []);
	assert.ok(adapter.calls.exists.includes("nested/.git"));
	assert.ok(!adapter.calls.exists.includes("missing.md/.git"));
});
