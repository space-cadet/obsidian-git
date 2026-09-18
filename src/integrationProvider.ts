import type { App } from "obsidian";
import {
	inspectLocalRepository,
	readChanges,
	readCommitChanges,
	readCommits,
	type ChangedFile,
} from "./repository";

// Matches the Integration Provider API v1 contract implemented by obsidian-ai
// (src/integrations/types.ts). The host validates this shape at runtime, so
// keep the structure plain JSON: no functions classes or private fields.
export const INTEGRATION_PROVIDER_API_VERSION = 1;

const MAX_DEPTH = 50;
const MAX_FILES = 200;

export interface GitSyncPluginLike {
	app: App;
	settings: {
		repositoryPath: string;
	};
}

type ToolOutput = { success: true; content: string } | { error: string };

type CapabilityExecute = (
	args: Record<string, unknown>,
	context: unknown,
) => Promise<ToolOutput>;

interface RepositoryAccess {
	adapter: GitSyncPluginLike["app"]["vault"]["adapter"];
	repositoryPath: string;
	branch: string | null;
	head: string | null;
}

function repositoryAccess(plugin: GitSyncPluginLike): {
	adapter: RepositoryAccess["adapter"];
	repositoryPath: string;
} {
	return {
		adapter: plugin.app.vault.adapter,
		repositoryPath: plugin.settings.repositoryPath.trim() || ".",
	};
}

async function requireRepository(
	plugin: GitSyncPluginLike,
): Promise<RepositoryAccess | { error: string }> {
	const { adapter, repositoryPath } = repositoryAccess(plugin);
	const state = await inspectLocalRepository(adapter, repositoryPath);
	if (state.kind === "missing") {
		return {
			error: `No Git repository found at "${state.repositoryPath}". Configure the repository path in the Git Sync plugin settings.`,
		};
	}
	return {
		adapter,
		repositoryPath,
		branch: "branch" in state ? state.branch : null,
		head: "head" in state ? state.head : null,
	};
}

function formatFileList(files: ChangedFile[]): string {
	return files
		.map((file) => `- ${file.path} (${file.status})${file.staged ? " [staged]" : ""}`)
		.join("\n");
}

function readLimit(value: unknown, fallback: number): number {
	const limit = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(limit, MAX_FILES));
}

function readDepth(value: unknown): number {
	const depth = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 10;
	return Math.max(1, Math.min(depth, MAX_DEPTH));
}

export function createIntegrationProvider(plugin: GitSyncPluginLike): {
	id: string;
	displayName: string;
	apiVersion: number;
	capabilities: Array<{
		id: string;
		title: string;
		description: string;
		risk: "read";
		inputSchema: Record<string, unknown>;
		execute: CapabilityExecute;
	}>;
} {
	const guard = async (
		run: (repo: RepositoryAccess) => Promise<ToolOutput>,
	): Promise<ToolOutput> => {
		try {
			const repo = await requireRepository(plugin);
			if ("error" in repo) return repo;
			return await run(repo);
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};

	return {
		id: "obsidian-git",
		displayName: "Git Sync",
		apiVersion: INTEGRATION_PROVIDER_API_VERSION,
		capabilities: [
			{
				id: "git.status",
				title: "Repository status",
				description:
					"Show the configured Git repository's branch, HEAD commit, and a summary of working-tree changes (counts plus changed paths). Read-only.",
				risk: "read",
				inputSchema: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
				execute: async () =>
					guard(async (repo) => {
						const files = await readChanges(repo.adapter, repo.repositoryPath);
						const staged = files.filter((file) => file.staged);
						const unstaged = files.filter((file) => !file.staged);
						const byStatus = new Map<string, number>();
						for (const file of files) {
							byStatus.set(file.status, (byStatus.get(file.status) ?? 0) + 1);
						}
						const lines = [
							`Repository: ${repo.repositoryPath}`,
							`Branch: ${repo.branch ?? "(detached HEAD)"}`,
							`HEAD: ${repo.head ?? "(unknown)"}`,
							`Changes: ${files.length} total (${staged.length} staged, ${unstaged.length} unstaged)`,
						];
						for (const [status, count] of byStatus) lines.push(`  ${status}: ${count}`);
						if (files.length > 0) {
							lines.push("", formatFileList(files.slice(0, MAX_FILES)));
							if (files.length > MAX_FILES) {
								lines.push(`... ${files.length - MAX_FILES} more (use git.changed_files)`);
							}
						}
						return { success: true, content: lines.join("\n") };
					}),
			},
			{
				id: "git.changed_files",
				title: "List changed files",
				description:
					"List files that differ between the working tree, index, and HEAD. Optionally filter by status (e.g. Modified, Added, Deleted, Untracked) and limit the number of results. Read-only.",
				risk: "read",
				inputSchema: {
					type: "object",
					properties: {
						status: {
							type: "string",
							description:
								"Only return files with this status label (e.g. Modified, Added, Deleted, Untracked).",
						},
						limit: {
							type: "number",
							description: `Maximum number of files to return (default 100, max ${MAX_FILES}).`,
						},
					},
					additionalProperties: false,
				},
				execute: async (args) =>
					guard(async (repo) => {
						const files = await readChanges(repo.adapter, repo.repositoryPath);
						const statusFilter =
							typeof args.status === "string" && args.status.trim()
								? args.status.trim().toLowerCase()
								: null;
						const filtered = statusFilter
							? files.filter((file) => file.status.toLowerCase() === statusFilter)
							: files;
						const limit = readLimit(args.limit, 100);
						const shown = filtered.slice(0, limit);
						const lines =
							shown.length > 0
								? formatFileList(shown)
								: "No matching changed files.";
						return {
							success: true,
							content:
								filtered.length > limit
									? `${lines}\n... ${filtered.length - limit} more`
									: lines,
						};
					}),
			},
			{
				id: "git.log",
				title: "Commit history",
				description:
					"List recent commits on the current branch, newest first: short hash, message, author, and date. Optionally pass depth (default 10, max 50). Read-only.",
				risk: "read",
				inputSchema: {
					type: "object",
					properties: {
						depth: {
							type: "number",
							description: `Number of commits to return (default 10, max ${MAX_DEPTH}).`,
						},
					},
					additionalProperties: false,
				},
				execute: async (args) =>
					guard(async (repo) => {
						const history = await readCommits(
							repo.adapter,
							repo.repositoryPath,
							readDepth(args.depth),
						);
						if (history.commits.length === 0) {
							return { success: true, content: "No commits yet." };
						}
						const lines = history.commits.map((commit) => {
							const date = new Date(commit.author.timestamp * 1000)
								.toISOString()
								.slice(0, 10);
							const firstLine = commit.message.split(/\r?\n/, 1)[0];
							return `- ${commit.oid.slice(0, 8)} ${firstLine} (${commit.author.name}, ${date})`;
						});
						if (history.hasMore) lines.push("... older commits available");
						return { success: true, content: lines.join("\n") };
					}),
			},
			{
				id: "git.commit_changes",
				title: "Files changed in a commit",
				description:
					"List the files added, modified, or deleted in a specific commit given its full or short hash. Read-only.",
				risk: "read",
				inputSchema: {
					type: "object",
					properties: {
						oid: {
							type: "string",
							description: "Commit hash (full or unambiguous short form).",
						},
					},
					required: ["oid"],
					additionalProperties: false,
				},
				execute: async (args) =>
					guard(async (repo) => {
						const oid = typeof args.oid === "string" ? args.oid.trim() : "";
						if (!oid) return { error: "Missing required argument: oid." };
						const changes = await readCommitChanges(repo.adapter, repo.repositoryPath, oid);
						if (changes.length === 0) {
							return { success: true, content: "No file changes in this commit." };
						}
						return {
							success: true,
							content: changes
								.map((change) => `- ${change.status}: ${change.path}`)
								.join("\n"),
						};
					}),
			},
		],
	};
}
