const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./support/load-typescript.cjs");

const {
	DEFAULT_SETTINGS,
	LEGACY_REMOTE_CREDENTIAL_REF,
	decodePluginData,
	normalizeRepositoryRoot,
	normalizeRepositoryRegistry,
	projectSelectedRepositorySettings,
	updateSelectedRepositorySettings,
} = loadTypeScript("src/pluginData.ts");

test("schema 1 settings migrate to one stable vault-relative repository", () => {
	const decoded = decodePluginData({
		format: "obsidian-git-sync",
		schemaVersion: 1,
		settings: { repositoryPath: "./notes\\project", remoteUrl: "https://example.com/repo.git" },
	}, true);

	assert.equal(decoded.legacy, true);
	assert.equal(decoded.repositories.length, 1);
	assert.equal(decoded.repositories[0].id, "repo-legacy-default");
	assert.equal(decoded.repositories[0].root, "notes/project");
	assert.equal(decoded.repositories[0].remoteUrl, "https://example.com/repo.git");
	assert.equal(decoded.repositories[0].credentialRef, LEGACY_REMOTE_CREDENTIAL_REF);
	assert.equal(decoded.selectedRepositoryId, "repo-legacy-default");
});

test("migrated registry data remains stable when decoded from schema 2", () => {
	const migrated = decodePluginData({
		format: "obsidian-git-sync",
		schemaVersion: 1,
		settings: { repositoryPath: "notes", branchName: "trunk" },
	}, true);
	const restored = decodePluginData({
		format: "obsidian-git-sync",
		schemaVersion: 2,
		settings: migrated.settings,
		repositories: migrated.repositories,
		selectedRepositoryId: migrated.selectedRepositoryId,
	}, true);

	assert.deepEqual(restored.repositories, migrated.repositories);
	assert.equal(restored.selectedRepositoryId, migrated.selectedRepositoryId);
	assert.equal(restored.legacy, false);
});

test("missing plugin data starts with the vault-root repository", () => {
	const decoded = decodePluginData(undefined, true);

	assert.equal(decoded.repositories[0].root, ".");
	assert.equal(decoded.repositories[0].name, "Vault root");
	assert.equal(decoded.selectedRepositoryId, decoded.repositories[0].id);
});

test("repository roots normalize separators and reject paths outside the vault", () => {
	assert.equal(normalizeRepositoryRoot(" ./notes\\project// "), "notes/project");
	assert.equal(normalizeRepositoryRoot("."), ".");
	assert.throws(() => normalizeRepositoryRoot("../outside"), /parent-directory/);
	assert.throws(() => normalizeRepositoryRoot("/outside"), /open vault/);
	assert.throws(() => normalizeRepositoryRoot("C:\\outside"), /open vault/);
});

test("registry normalization deduplicates canonical roots and repairs selection", () => {
	const registry = normalizeRepositoryRegistry([
		{ id: "one", root: "./notes//project", name: "Project", remoteUrl: "" },
		{ id: "duplicate", root: "notes/project", name: "Duplicate" },
		{ id: "two", root: "other" },
	], DEFAULT_SETTINGS, "duplicate");

	assert.deepEqual(registry.repositories.map((repository) => repository.id), ["one", "two"]);
	assert.equal(registry.repositories[0].root, "notes/project");
	assert.equal(registry.selectedRepositoryId, "one");
});

test("registry migration rejects an entry outside the open vault", () => {
	assert.throws(() => normalizeRepositoryRegistry([
		{ id: "outside", root: "../outside" },
	], DEFAULT_SETTINGS), /parent-directory/);
});

test("selected repository settings are projected and saved without losing its credential reference", () => {
	const registry = {
		repositories: [{
			id: "one",
			name: "One",
			root: "one",
			remoteUrl: "https://old.example/repo.git",
			remoteUsername: "git",
			branchName: "main",
			credentialRef: "credential-profile-1",
		}],
		selectedRepositoryId: "one",
	};
	const projected = projectSelectedRepositorySettings(DEFAULT_SETTINGS, registry);
	assert.equal(projected.repositoryPath, "one");
	assert.equal(projected.remoteUrl, "https://old.example/repo.git");

	const updated = updateSelectedRepositorySettings(registry, {
		...projected,
		remoteUrl: "https://new.example/repo.git",
	});
	assert.equal(updated.repositories[0].remoteUrl, "https://new.example/repo.git");
	assert.equal(updated.repositories[0].credentialRef, "credential-profile-1");
});

test("selected repository updates reject a root already registered to another entry", () => {
	const registry = normalizeRepositoryRegistry([
		{ id: "one", root: "one" },
		{ id: "two", root: "two" },
	], DEFAULT_SETTINGS, "one");
	assert.throws(() => updateSelectedRepositorySettings(registry, {
		...DEFAULT_SETTINGS,
		repositoryPath: "two",
	}), /already registered/);
});
