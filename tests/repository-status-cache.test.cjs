const assert = require("node:assert/strict");
const test = require("node:test");
const git = require("isomorphic-git");
const { loadTypeScript } = require("./support/load-typescript.cjs");
const { MemoryAdapter } = require("./support/memory-adapter.cjs");
const { initializeRepository, stageFile, unstageFile, commitChanges, readChanges, ObsidianGitFs } = loadTypeScript("src/repository.ts");
// Use the same module instance loaded by repository.ts.
const { configureStatusCache, invalidateStatusHashCache } = require("../src/RepositoryStatusCache.ts");

class ObservedAdapter extends MemoryAdapter {
	constructor() { super(); this.clock = Date.now() - 10_000_000; this.reset(); }
	reset() { this.reads = []; this.stats = []; this.writes = []; }
	async read(path) { this.reads.push(path); return super.read(path); }
	async readBinary(path) { this.reads.push(path); return super.readBinary(path); }
	async stat(path) { this.stats.push(path); return super.stat(path); }
	async write(path, value) { this.writes.push(path); return super.write(path, value); }
	async writeBinary(path, value) { this.writes.push(path); return super.writeBinary(path, value); }
}
async function fixture(root = ".") {
	const adapter = new ObservedAdapter();
	const prefix = root === "." ? "" : `${root}/`;
	for (let i = 0; i < 8; i++) await adapter.write(`${prefix}notes/file-${i}.md`, `original ${i}\n`);
	await initializeRepository(adapter, root);
	await stageFile(adapter, root, "notes");
	await commitChanges(adapter, root, "Initial", { name: "Test", email: "test@example.com" });
	// Reproduce synced files whose metadata drifted without content changes.
	for (let i = 0; i < 8; i++) {
		const path = `${prefix}notes/file-${i}.md`;
		adapter.modifiedTimes.set(path, adapter.modifiedTimes.get(path) + 9000);
	}
	adapter.reset();
	return adapter;
}
async function scan(adapter, root = ".", paths) {
	let metrics;
	const changes = await readChanges(adapter, root, paths, (value) => { metrics = value; });
	return { changes, metrics };
}
async function reference(adapter, root = ".", paths = ["."]) {
	return (await git.statusMatrix({ fs: new ObsidianGitFs(adapter, root, { filepaths: paths }), dir: root, filepaths: paths, refresh: false }))
		.filter(([, h, w, s]) => h !== w || h !== s)
		.map(([path, h, w, s]) => ({ path, staged: h !== s, status: h === 0 ? s === 0 ? "Untracked" : "Added" : w === 0 ? "Deleted" : "Modified" }));
}

test("verified hashes survive a simulated app restart and do not rewrite the index", async () => {
	const adapter = await fixture();
	let saved;
	configureStatusCache(adapter, null, (value) => { saved = JSON.parse(JSON.stringify(value)); });
	const index = await adapter.readBinary(".git/index");
	assert.deepEqual((await scan(adapter)).changes, []);
	assert.equal(saved.repositories[0].files.length, 8);
	assert.ok(!JSON.stringify(saved).includes("original 0"));
	adapter.reset();
	assert.equal((await scan(adapter)).metrics.hashCacheHits, 8);
	assert.ok(!adapter.reads.some((path) => path.startsWith("notes/")));
	configureStatusCache(adapter, saved, (value) => { saved = value; });
	adapter.reset();
	const restarted = await scan(adapter);
	assert.deepEqual(restarted.changes, []);
	assert.equal(restarted.metrics.hashCacheHits, 8);
	assert.ok(!adapter.reads.some((path) => path.startsWith("notes/")));
	assert.deepEqual(adapter.writes, []);
	assert.deepEqual(await adapter.readBinary(".git/index"), index);
});

test("millisecond timestamp changes detect same-size edits; staging and unstaging use the current index", async () => {
	const adapter = await fixture();
	await scan(adapter);
	const path = "notes/file-0.md";
	adapter.files.set(path, "modified 0\n");
	adapter.modifiedTimes.set(path, adapter.modifiedTimes.get(path) + 1);
	const changed = await scan(adapter);
	assert.deepEqual(changed.changes, [{ path, status: "Modified", staged: false }]);
	assert.equal(changed.metrics.hashCacheHits, 7);
	await stageFile(adapter, ".", path);
	assert.equal((await scan(adapter)).changes[0].staged, true);
	await unstageFile(adapter, ".", path);
	assert.equal((await scan(adapter)).changes[0].staged, false);
});

test("vault invalidation detects same-size edits even if metadata was preserved", async () => {
	const adapter = await fixture();
	await scan(adapter);
	const path = "notes/file-0.md";
	adapter.files.set(path, "modified 0\n");
	invalidateStatusHashCache(adapter, path);
	assert.deepEqual((await scan(adapter)).changes, [{ path, status: "Modified", staged: false }]);
});

test("files changed during hashing cannot publish a verified hash", async () => {
	const adapter = await fixture();
	const path = "notes/file-0.md";
	const read = adapter.readBinary.bind(adapter);
	let race = true;
	adapter.readBinary = async (value) => {
		const bytes = await read(value);
		if (value === path && race) {
			race = false;
			adapter.files.set(path, "modified 0\n");
			adapter.modifiedTimes.set(path, adapter.modifiedTimes.get(path) + 1000);
		}
		return bytes;
	};
	await scan(adapter);
	assert.equal((await scan(adapter)).metrics.hashCacheHits, 7);
	assert.equal((await scan(adapter)).changes[0].path, path);
});

test("ignore contents and missing rule files are read once per scan and refreshed next time", async () => {
	const adapter = await fixture();
	await adapter.write(".gitignore", "*.tmp\n");
	for (let i = 0; i < 12; i++) await adapter.write(`untracked/note-${i}.tmp`, "ignored\n");
	adapter.reset();
	assert.ok(!(await scan(adapter)).changes.some((change) => change.path.endsWith(".tmp")));
	assert.equal(adapter.reads.filter((path) => path === ".gitignore").length, 1);
	assert.equal(adapter.reads.filter((path) => path === "untracked/.gitignore").length, 1);
	assert.equal(adapter.stats.filter((path) => path === ".git/info/exclude").length, 1);
	await adapter.write(".gitignore", "\n");
	assert.equal((await scan(adapter)).changes.filter((change) => change.path.endsWith(".tmp")).length, 12);
});

test("config normalization changes invalidate saved hashes", async () => {
	const adapter = await fixture();
	const path = "notes/file-0.md";
	await adapter.write(path, "original 0\r\n");
	await adapter.write(".git/config", (await adapter.read(".git/config")) + "\n[core]\n\tautocrlf = false\n");
	assert.ok((await scan(adapter)).changes.some((change) => change.path === path));
	await adapter.write(".git/config", (await adapter.read(".git/config")).replace("autocrlf = false", "autocrlf = true"));
	assert.ok(!(await scan(adapter)).changes.some((change) => change.path === path));
	assert.deepEqual((await scan(adapter)).changes, await reference(adapter));
});

test("cache is isolated by adapter and repository; folder events invalidate descendants", async () => {
	const adapter = await fixture("alpha");
	await adapter.write("beta/notes/file-0.md", "beta text\n");
	await initializeRepository(adapter, "beta");
	assert.equal((await scan(adapter, "alpha")).metrics.hashCacheHits, 0);
	assert.equal((await scan(adapter, "alpha")).metrics.hashCacheHits, 8);
	assert.equal((await scan(adapter, "beta")).metrics.hashCacheHits, 0);
	invalidateStatusHashCache(adapter, "alpha/notes");
	assert.equal((await scan(adapter, "alpha")).metrics.hashCacheHits, 0);
	const other = await fixture("alpha");
	assert.equal((await scan(other, "alpha")).metrics.hashCacheHits, 0);
});

test("missing/malformed/failed storage falls back to correct scans, and recent files are not cached", async () => {
	const adapter = await fixture();
	configureStatusCache(adapter, { version: 1, repositories: [{ root: "../bad", files: null }] }, () => { throw new Error("quota"); });
	const first = await scan(adapter);
	assert.deepEqual(first.changes, []);
	assert.equal(first.metrics.cachePersistenceFailed, true);
	const recent = "notes/file-0.md";
	adapter.modifiedTimes.set(recent, Date.now());
	await scan(adapter);
	adapter.reset();
	const next = await scan(adapter);
	assert.equal(next.metrics.hashCacheHits, 7);
	assert.ok(adapter.reads.includes(recent));
	await adapter.remove(recent);
	assert.ok((await scan(adapter)).changes.some((change) => change.path === recent && change.status === "Deleted"));
});


test("cached status agrees with the library for mixed edits, ignored tracked files and directory replacements", async () => {
	const adapter = await fixture();
	await scan(adapter);
	await adapter.write("notes/file-0.md", "unstaged edit\n");
	await adapter.write("notes/file-1.md", "staged edit\n");
	await stageFile(adapter, ".", "notes/file-1.md");
	await adapter.remove("notes/file-2.md");
	await adapter.remove("notes/file-3.md");
	await stageFile(adapter, ".", "notes/file-3.md");
	await adapter.write("notes/new.md", "untracked\n");
	await adapter.write("notes/added.md", "added\n");
	await stageFile(adapter, ".", "notes/added.md");
	await adapter.write(".gitignore", "notes/file-5.md\n*.tmp\n");
	await adapter.write("notes/file-5.md", "tracked ignored edit\n");
	await adapter.write("notes/hidden.tmp", "ignored\n");
	await adapter.remove("notes/file-7.md");
	await adapter.write("notes/file-7.md/child.md", "replacement folder\n");
	assert.deepEqual((await scan(adapter)).changes, await reference(adapter));
	assert.deepEqual((await scan(adapter)).changes, await reference(adapter));
});


test("explicit content verification bypasses all shortcuts and repairs a preserved-metadata edit", async () => {
	const adapter = await fixture();
	await scan(adapter);
	const path = "notes/file-0.md";
	adapter.files.set(path, "modified 0\n");
	let metrics;
	const changes = await readChanges(adapter, ".", undefined, (value) => { metrics = value; }, { forceVerify: true });
	assert.equal(metrics.hashCacheHits, 0);
	assert.deepEqual(changes, [{ path, status: "Modified", staged: false }]);
	assert.deepEqual((await scan(adapter)).changes, changes);
});
