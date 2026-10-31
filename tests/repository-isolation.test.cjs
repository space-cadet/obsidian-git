const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./support/load-typescript.cjs");

const { normalizeRepositoryFilePath } = loadTypeScript("src/repositoryPaths.ts");
const {
	commitChanges,
	createAndSwitchLocalBranch,
	assertNoNestedRepositoryPaths,
	initializeRepository,
	inspectLocalRepository,
	listLocalBranches,
	readChanges,
	readCommits,
	restoreFilesFromIndex,
	stageFile,
	switchLocalBranch,
} = loadTypeScript("src/repository.ts");
const { createIntegrationProvider } = loadTypeScript("src/integrationProvider.ts");

const { MemoryAdapter } = require("./support/memory-adapter.cjs");

test("two vault repositories stage, commit, and inspect independently", async () => {
	const adapter = new MemoryAdapter();
	await adapter.write("alpha/note.md", "alpha one\n");
	await adapter.write("beta/note.md", "beta one\n");
	await initializeRepository(adapter, "alpha");
	await initializeRepository(adapter, "beta");

	assert.equal((await inspectLocalRepository(adapter, "alpha")).kind, "ready");
	assert.equal((await inspectLocalRepository(adapter, "beta")).kind, "ready");
	assert.equal((await adapter.stat(".")).type, "folder");
	await assert.rejects(stageFile(adapter, "alpha", "../beta/note.md"), /parent-directory/);

	await stageFile(adapter, "alpha", "note.md");
	const alphaOid = await commitChanges(adapter, "alpha", "alpha commit", { name: "Test", email: "test@example.com" });
	assert.ok(alphaOid);
	assert.equal((await readCommits(adapter, "alpha")).commits[0].message, "alpha commit\n");
	assert.equal((await readChanges(adapter, "beta")).length, 1);
	assert.equal((await readCommits(adapter, "beta")).commits.length, 0);

	await adapter.write("beta/note.md", "beta two\n");
	await stageFile(adapter, "beta", "note.md");
	const betaOid = await commitChanges(adapter, "beta", "beta commit", { name: "Test", email: "test@example.com" });
	assert.ok(betaOid);
	assert.notEqual(alphaOid, betaOid);
	assert.equal((await readCommits(adapter, "alpha")).commits[0].message, "alpha commit\n");
	assert.equal((await readCommits(adapter, "beta")).commits[0].message, "beta commit\n");
});

test("integration tools capture explicit repository IDs and reject unknown IDs", async () => {
	const adapter = new MemoryAdapter();
	await adapter.write("alpha/alpha.md", "alpha\n");
	await adapter.write("beta/beta.md", "beta\n");
	await initializeRepository(adapter, "alpha");
	await initializeRepository(adapter, "beta");
	const settings = {
		repositoryPath: "alpha",
		remoteUrl: "",
		remoteUsername: "git",
		branchName: "main",
		authorName: "",
		authorEmail: "",
	};
	const contexts = {
		alpha: { repositoryId: "alpha-id", settings: { ...settings, repositoryPath: "alpha" }, credential: null },
		beta: { repositoryId: "beta-id", settings: { ...settings, repositoryPath: "beta" }, credential: null },
	};
	const plugin = {
		app: { vault: { adapter } },
		settings,
		repositories: [
			{ id: "alpha-id", name: "Alpha", root: "alpha" },
			{ id: "beta-id", name: "Beta", root: "beta" },
		],
		selectedRepositoryId: "alpha-id",
		getRepositoryOperationContext: (repositoryId = "alpha-id") => {
			const context = Object.values(contexts).find((entry) => entry.repositoryId === repositoryId);
			if (!context) throw new Error(`Unknown repository ID "${repositoryId}".`);
			return context;
		},
	};
	const provider = createIntegrationProvider(plugin);
	const status = await provider.capabilities.find((item) => item.id === "git.status").execute({ repositoryId: "beta-id" }, null);
	assert.equal(status.success, true);
	assert.match(status.content, /Repository: beta/);
	assert.match(status.content, /beta\.md/);
	assert.doesNotMatch(status.content, /alpha\.md/);

	const missing = await provider.capabilities.find((item) => item.id === "git.status").execute({ repositoryId: "unknown" }, null);
	assert.match(missing.error, /Unknown repository ID/);
	const listed = await provider.capabilities.find((item) => item.id === "git.repositories").execute({}, null);
	assert.match(listed.content, /beta-id/);
});

test("restoring from the index discards selected unstaged edits and preserves the index", async () => {
	const adapter = new MemoryAdapter();
	await adapter.write("note.md", "committed version\n");
	await initializeRepository(adapter, ".");
	await stageFile(adapter, ".", "note.md");
	await commitChanges(adapter, ".", "initial", { name: "Test", email: "test@example.com" });

	await adapter.write("note.md", "staged version\n");
	await stageFile(adapter, ".", "note.md");
	await adapter.write("note.md", "unstaged edit\n");
	await restoreFilesFromIndex(adapter, ".", ["note.md"]);

	assert.equal(await adapter.read("note.md"), "staged version\n");
	assert.deepEqual(await readChanges(adapter, "."), [{ path: "note.md", status: "Modified", staged: true }]);
});

test("branch creation and switching stay in one repository and reject dirty worktrees", async () => {
	const adapter = new MemoryAdapter();
	await adapter.write("note.md", "main version\n");
	await initializeRepository(adapter, ".");
	await stageFile(adapter, ".", "note.md");
	await commitChanges(adapter, ".", "main initial", { name: "Test", email: "test@example.com" });

	await createAndSwitchLocalBranch(adapter, ".", "feature/work");
	assert.deepEqual(await listLocalBranches(adapter, "."), ["feature/work", "main"]);
	await adapter.write("note.md", "feature edit\n");
	await assert.rejects(switchLocalBranch(adapter, ".", "main"), /Commit or discard/);
	await stageFile(adapter, ".", "note.md");
	await commitChanges(adapter, ".", "feature commit", { name: "Test", email: "test@example.com" });

	await switchLocalBranch(adapter, ".", "main");
	assert.equal((await inspectLocalRepository(adapter, ".")).branch, "main");
	assert.equal(await adapter.read("note.md"), "main version\n");
});

test("parent repository reads and staging stop at a nested repository boundary", async () => {
	const adapter = new MemoryAdapter();
	await adapter.write("parent/root.md", "parent file\n");
	await adapter.write("parent/child/nested.md", "child file\n");
	await initializeRepository(adapter, "parent");
	await initializeRepository(adapter, "parent/child");

	const changes = await readChanges(adapter, "parent");
	assert.deepEqual(changes.map((change) => change.path), ["root.md"]);
	await assert.rejects(stageFile(adapter, "parent", "child/nested.md"), /nested Git repository/);
	await assert.rejects(assertNoNestedRepositoryPaths(adapter, "parent", ["child/nested.md"]), /nested Git repository/);
});

test("repository inspection resolves a branch whose ref is packed", async () => {
	const adapter = new MemoryAdapter();
	await adapter.write("notes.md", "initial\n");
	await initializeRepository(adapter, ".");
	await stageFile(adapter, ".", "notes.md");
	const oid = await commitChanges(adapter, ".", "first", { name: "Test", email: "test@example.com" });
	await adapter.write(".git/packed-refs", `# pack-refs with: peeled fully-peeled\n${oid} refs/heads/main\n`);
	await adapter.remove(".git/refs/heads/main");

	assert.deepEqual(await inspectLocalRepository(adapter, "."), {
		kind: "ready",
		repositoryPath: ".",
		branch: "main",
		head: oid,
	});
});

test("repository file paths cannot escape the vault or target the repository root", () => {
	assert.equal(normalizeRepositoryFilePath("./docs\\note.md"), "docs/note.md");
	assert.throws(() => normalizeRepositoryFilePath("../other/repo.md"), /parent-directory/);
	assert.throws(() => normalizeRepositoryFilePath("."), /file or folder/);
});
