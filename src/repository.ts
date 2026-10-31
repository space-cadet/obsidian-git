import { DataAdapter, Stat } from "obsidian";
import { Buffer } from "buffer";
import * as git from "isomorphic-git";
import { normalizeRepositoryFilePath, normalizeRepositoryRoot } from "./repositoryPaths";
import { repositoryMutationCoordinator } from "./RepositoryMutationCoordinator";

const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
browserGlobal.Buffer ??= Buffer;

export type RepositoryState =
	| { kind: "checking"; repositoryPath: string }
	| { kind: "missing"; repositoryPath: string }
	| { kind: "ready"; repositoryPath: string; branch: string; head: string | null }
	| { kind: "error"; repositoryPath: string; message: string };

export interface ChangedFile {
	path: string;
	status: string;
	staged: boolean;
}

export interface CommitAuthor {
	name: string;
	email: string;
}

export interface CommitFileChange {
	path: string;
	status: "Added" | "Modified" | "Deleted";
}

export interface LocalCommit {
	oid: string;
	message: string;
	author: CommitAuthor & {
		timestamp: number;
	};
	committer: CommitAuthor & {
		timestamp: number;
	};
	changes: CommitFileChange[];
	changesLoaded: boolean;
}

export interface CommitHistory {
	commits: LocalCommit[];
	hasMore: boolean;
}

export interface RemoteCommitHistory {
	commits: LocalCommit[];
	available: boolean;
	hasMore: boolean;
}

export function validateRepositoryPath(value: string): string | null {
	if (!value.trim()) return "Enter a repository path.";
	try {
		normalizeRepositoryRoot(value);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "Repository root must stay inside the open vault.";
	}
}

export async function initializeRepository(
	adapter: DataAdapter,
	repositoryPath: string,
	defaultBranch = "main",
): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		const validation = validateRepositoryPath(repositoryPath);
		if (validation) throw new Error(validation);
		const dir = normalizedRepositoryPath(repositoryPath);
		const gitEntryPath = pathInRepository(dir, ".git");
		if (await adapter.exists(gitEntryPath)) {
			throw new Error(`Git metadata already exists at "${dir}".`);
		}
		invalidateRepositorySnapshot(dir);
		try {
			await git.init({ fs: new ObsidianGitFs(adapter, dir), dir, defaultBranch });
		} finally {
			invalidateRepositorySnapshot(dir);
		}
	});
}

export async function inspectLocalRepository(
	adapter: DataAdapter,
	repositoryPath: string,
): Promise<RepositoryState> {
	const path = normalizedRepositoryPath(repositoryPath);
	const headPath = pathInRepository(path, ".git/HEAD");

	try {
		if (!(await adapter.exists(headPath))) {
			return { kind: "missing", repositoryPath: path };
		}

		const fs = new ObsidianGitFs(adapter, path);
		const branch = await git.currentBranch({ fs, dir: path, fullname: false });
		let head: string | null = null;
		try {
			head = await git.resolveRef({ fs, dir: path, ref: "HEAD" });
		} catch {
			// An initialized repository may not have a commit yet.
		}
		return {
			kind: "ready",
			repositoryPath: path,
			branch: branch ?? "Detached HEAD",
			head,
		};
	} catch (error) {
		return {
			kind: "error",
			repositoryPath: path,
			message: error instanceof Error ? error.message : "Unable to read the repository.",
		};
	}
}

export async function listLocalBranches(adapter: DataAdapter, repositoryPath: string): Promise<string[]> {
	const dir = normalizedRepositoryPath(repositoryPath);
	return git.listBranches({ fs: new ObsidianGitFs(adapter, dir), dir });
}

export async function switchLocalBranch(
	adapter: DataAdapter,
	repositoryPath: string,
	branchName: string,
): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		const branch = branchName.trim();
		const branches = await listLocalBranches(adapter, repositoryPath);
		if (branches.indexOf(branch) === -1) throw new Error(`Local branch "${branch}" does not exist.`);
		const dir = normalizedRepositoryPath(repositoryPath);
		const fs = new ObsidianGitFs(adapter, dir);
		if (await git.currentBranch({ fs, dir, fullname: false }) === branch) return;
		const changes = await readChanges(adapter, repositoryPath);
		if (changes.length > 0) throw new Error("Commit or discard local changes before switching branches.");
		invalidateRepositorySnapshot(repositoryPath);
		try {
			await git.checkout({ fs, dir, ref: branch });
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function createAndSwitchLocalBranch(
	adapter: DataAdapter,
	repositoryPath: string,
	branchName: string,
): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		const branch = branchName.trim();
		if (!branch) throw new Error("Enter a branch name.");
		const changes = await readChanges(adapter, repositoryPath);
		if (changes.length > 0) throw new Error("Commit or discard local changes before creating a branch.");
		invalidateRepositorySnapshot(repositoryPath);
		try {
			await git.branch({
				fs: new ObsidianGitFs(adapter, normalizedRepositoryPath(repositoryPath)),
				dir: normalizedRepositoryPath(repositoryPath),
				ref: branch,
				checkout: true,
			});
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function readChanges(
	adapter: DataAdapter,
	repositoryPath: string,
	filepaths?: string[],
	onMetrics?: (metrics: RepositoryScanMetrics) => void,
): Promise<ChangedFile[]> {
	const matrix = await readStatusMatrix(adapter, repositoryPath, filepaths, onMetrics);
	return matrix
		.filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
		.map(([path, head, workdir, stage]) => ({
			path,
			status: statusLabel(head, workdir, stage),
			staged: head !== stage,
		}));
}

export async function assertNoNestedRepositoryPaths(
	adapter: DataAdapter,
	repositoryPath: string,
	paths: string[],
): Promise<void> {
	const root = normalizedRepositoryPath(repositoryPath);
	const checked = new Set<string>();
	for (const path of paths) {
		const safePath = normalizeRepositoryFilePath(path);
		const segments = safePath.split("/");
		for (let length = 1; length <= segments.length; length += 1) {
			const relative = segments.slice(0, length).join("/");
			const candidate = pathInRepository(root, relative);
			if (checked.has(candidate)) continue;
			checked.add(candidate);
			if (candidate !== root && await adapter.exists(`${candidate}/.git`)) {
				throw new Error(`Operation blocked because "${candidate}" contains a nested Git repository. Remove or move that repository before continuing.`);
			}
		}
	}
}

export interface RepositoryScanMetrics {
	directoryLists: number;
	statCalls: number;
	indexStatCalls: number;
	nestedRepositoryChecks: number;
	worktreeFileReads: number;
	worktreeBytesRead: number;
}

type StatusMatrixRow = [string, 0 | 1, 0 | 1 | 2, 0 | 1 | 2 | 3];

async function readStatusMatrix(
	adapter: DataAdapter,
	repositoryPath: string,
	filepaths?: string[],
	onMetrics?: (metrics: RepositoryScanMetrics) => void,
): Promise<StatusMatrixRow[]> {
	const dir = normalizedRepositoryPath(repositoryPath);
	const paths = filepaths ? filepaths.map(normalizeRepositoryRoot) : ["."];
	const fs = new ObsidianGitFs(adapter, dir, { filepaths: paths });
	try {
		if (paths.length === 0) return [];
		return await git.statusMatrix({
			fs,
			dir,
			refresh: false,
			ignored: false,
			filepaths: paths,
		});
	} finally {
		onMetrics?.({ ...fs.scanMetrics });
	}
}

export interface RepositorySnapshot {
	at: number;
	state: RepositoryState;
	counts: {
		total: number;
		staged: number;
		unstaged: number;
		conflicts: number;
	};
	changes: ChangedFile[];
}

/** How long a snapshot stays fresh before the next read walks the tree again. */
export const REPOSITORY_SNAPSHOT_TTL_MS = 120_000;

const repositorySnapshotCache = new Map<string, RepositorySnapshot>();
const repositorySnapshotGeneration = new Map<string, number>();

export function invalidateRepositorySnapshot(repositoryPath: string): void {
	const key = normalizedRepositoryPath(repositoryPath);
	repositorySnapshotCache.delete(key);
	repositorySnapshotGeneration.set(key, (repositorySnapshotGeneration.get(key) ?? 0) + 1);
}

/**
 * One repository pass (statusMatrix is the expensive walk) shared by the
 * integration provider's status-style capabilities. A full-tree statusMatrix
 * over a large vault can take tens of seconds on mobile storage, so
 * back-to-back tool calls reuse the same snapshot for a short TTL.
 */
export async function readRepositorySnapshot(
	adapter: DataAdapter,
	repositoryPath: string,
): Promise<RepositorySnapshot> {
	const key = normalizedRepositoryPath(repositoryPath);
	const generation = repositorySnapshotGeneration.get(key) ?? 0;
	const cached = repositorySnapshotCache.get(key);
	if (cached && Date.now() - cached.at < REPOSITORY_SNAPSHOT_TTL_MS) {
		return cached;
	}
	const state = await inspectLocalRepository(adapter, repositoryPath);
	if (state.kind !== "ready") {
		return {
			at: Date.now(),
			state,
			counts: { total: 0, staged: 0, unstaged: 0, conflicts: 0 },
			changes: [],
		};
	}
	const matrix = await readStatusMatrix(adapter, repositoryPath);
	let staged = 0;
	let unstaged = 0;
	let conflicts = 0;
	const changes: ChangedFile[] = [];
	for (const [path, head, workdir, stage] of matrix) {
		if (head !== workdir || head !== stage) {
			changes.push({
				path,
				status: statusLabel(head, workdir, stage),
			staged: head !== stage,
			});
		}
		if (head !== stage && !(head === 0 && stage === 0)) staged += 1;
		if (workdir !== stage) unstaged += 1;
		if (stage === 3) conflicts += 1;
	}
	const snapshot: RepositorySnapshot = {
		at: Date.now(),
		state,
		counts: { total: changes.length, staged, unstaged, conflicts },
		changes,
	};
	if ((repositorySnapshotGeneration.get(key) ?? 0) !== generation) {
		return readRepositorySnapshot(adapter, repositoryPath);
	}
	repositorySnapshotCache.set(key, snapshot);
	return snapshot;
}

export async function stageFile(adapter: DataAdapter, repositoryPath: string, path: string | string[]): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		invalidateRepositorySnapshot(repositoryPath);
		try {
			const dir = normalizedRepositoryPath(repositoryPath);
			const fs = new ObsidianGitFs(adapter, dir);
			const paths = (Array.isArray(path) ? path : [path]).map(normalizeRepositoryFilePath);
			assertPathsDoNotTargetGitMetadata(paths);
			const present: string[] = [];
			const missing: string[] = [];
			for (const candidate of paths) {
				if (await adapter.exists(pathInRepository(repositoryPath, candidate))) present.push(candidate);
				else missing.push(candidate);
			}
			if (present.length > 0) await git.add({ fs, dir, filepath: present });
			for (const candidate of missing) {
				await git.remove({ fs, dir, filepath: candidate });
			}
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function unstageFile(adapter: DataAdapter, repositoryPath: string, path: string): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		invalidateRepositorySnapshot(repositoryPath);
		try {
			const safePath = normalizeRepositoryFilePath(path);
			assertPathsDoNotTargetGitMetadata([safePath]);
			const dir = normalizedRepositoryPath(repositoryPath);
			await git.resetIndex({ fs: new ObsidianGitFs(adapter, dir), dir, filepath: safePath });
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function unstageFiles(adapter: DataAdapter, repositoryPath: string, paths: string[]): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		invalidateRepositorySnapshot(repositoryPath);
		const dir = normalizedRepositoryPath(repositoryPath);
		const fs = new ObsidianGitFs(adapter, dir);
		const cache = {};
		try {
			for (const path of paths) {
				const safePath = normalizeRepositoryFilePath(path);
				assertPathsDoNotTargetGitMetadata([safePath]);
				await git.resetIndex({ fs, dir, filepath: safePath, cache });
			}
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function restoreFilesFromIndex(
	adapter: DataAdapter,
	repositoryPath: string,
	paths: string[],
): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		const safePaths = paths.map(normalizeRepositoryFilePath);
		if (safePaths.length === 0) throw new Error("Select at least one file to restore.");
		assertPathsDoNotTargetGitMetadata(safePaths);
		invalidateRepositorySnapshot(repositoryPath);
		try {
			await git.checkout({
				fs: new ObsidianGitFs(adapter, normalizedRepositoryPath(repositoryPath)),
				dir: normalizedRepositoryPath(repositoryPath),
				filepaths: safePaths,
				noUpdateHead: true,
				force: true,
			});
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function removeFile(adapter: DataAdapter, repositoryPath: string, path: string): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		invalidateRepositorySnapshot(repositoryPath);
		try {
			const safePath = normalizeRepositoryFilePath(path);
			assertPathsDoNotTargetGitMetadata([safePath]);
			const dir = normalizedRepositoryPath(repositoryPath);
			await git.remove({ fs: new ObsidianGitFs(adapter, dir), dir, filepath: safePath });
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function addToGitignore(adapter: DataAdapter, repositoryPath: string, path: string): Promise<void> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		invalidateRepositorySnapshot(repositoryPath);
		const repository = normalizedRepositoryPath(repositoryPath);
		const gitignorePath = repository === "." ? ".gitignore" : `${repository}/.gitignore`;
		const current = await adapter.exists(gitignorePath) ? await adapter.read(gitignorePath) : "";
		const normalizedPath = normalizeRepositoryFilePath(path);
		assertPathsDoNotTargetGitMetadata([normalizedPath]);

		const lines = current.split(/\r?\n/);
		if (lines.some((line) => line.trim() === normalizedPath)) return;
		const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
		await adapter.write(gitignorePath, `${prefix}${normalizedPath}\n`);
		invalidateRepositorySnapshot(repositoryPath);
	});
}

export async function commitChanges(
	adapter: DataAdapter,
	repositoryPath: string,
	message: string,
	author: CommitAuthor,
): Promise<string> {
	return repositoryMutationCoordinator.run(repositoryPath, async () => {
		invalidateRepositorySnapshot(repositoryPath);
		try {
			return await git.commit({
				fs: new ObsidianGitFs(adapter, normalizedRepositoryPath(repositoryPath)),
				dir: normalizedRepositoryPath(repositoryPath),
				message,
				author,
			});
		} finally {
			invalidateRepositorySnapshot(repositoryPath);
		}
	});
}

export async function readCommits(
	adapter: DataAdapter,
	repositoryPath: string,
	depth = 100,
): Promise<CommitHistory> {
	return readCommitsAtRef(adapter, repositoryPath, "HEAD", depth);
}

export async function readCommitChanges(
	adapter: DataAdapter,
	repositoryPath: string,
	commitOid: string,
): Promise<CommitFileChange[]> {
	const resolvedOid = await resolveCommitOid(adapter, repositoryPath, commitOid);
	let result: Awaited<ReturnType<typeof git.log>>;
	try {
		result = await git.log({
				fs: new ObsidianGitFs(adapter, normalizedRepositoryPath(repositoryPath)),
				dir: normalizedRepositoryPath(repositoryPath),
			ref: resolvedOid,
			depth: 1,
			includeChanges: true,
		});
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "NoCommitError") return [];
		throw error;
	}

	return mapCommitChanges(result[0]?.commit.changes);
}

export async function readRemoteCommits(
	adapter: DataAdapter,
	repositoryPath: string,
	branchName: string,
	depth = 100,
): Promise<RemoteCommitHistory> {
	const dir = normalizedRepositoryPath(repositoryPath);
	const fs = new ObsidianGitFs(adapter, dir);
	const branch = branchName.trim();
	if (!branch) return { commits: [], available: false, hasMore: false };

	const branches = await git.listBranches({ fs, dir, remote: "origin" });
	if (branches.indexOf(branch) === -1) return { commits: [], available: false, hasMore: false };
	const history = await readCommitsAtRef(adapter, repositoryPath, `refs/remotes/origin/${branch}`, depth);

	return {
		commits: history.commits,
		available: true,
		hasMore: history.hasMore,
	};
}

async function readCommitsAtRef(
	adapter: DataAdapter,
	repositoryPath: string,
	ref: string,
	depth: number,
): Promise<CommitHistory> {
	let result: Awaited<ReturnType<typeof git.log>>;
	try {
		result = await git.log({
				fs: new ObsidianGitFs(adapter, normalizedRepositoryPath(repositoryPath)),
				dir: normalizedRepositoryPath(repositoryPath),
			ref,
			depth: depth + 1,
			includeChanges: false,
		});
	} catch (error) {
		if (error && typeof error === "object" && "code" in error &&
			(error.code === "NoCommitError" || error.code === "NotFoundError")) {
			return { commits: [], hasMore: false };
		}
		throw error;
	}

	return {
		commits: result.slice(0, depth).map(({ oid, commit }) => ({
			oid,
			message: commit.message,
			author: {
				name: commit.author.name,
				email: commit.author.email,
				timestamp: commit.author.timestamp,
			},
			committer: {
				name: commit.committer.name,
				email: commit.committer.email,
				timestamp: commit.committer.timestamp,
			},
			changes: [],
			changesLoaded: false,
		})),
		hasMore: result.length > depth,
	};
}

async function resolveCommitOid(
	adapter: DataAdapter,
	repositoryPath: string,
	commitOid: string,
): Promise<string> {
	const oid = commitOid.trim();
	if (oid.length >= 40) return oid;
	try {
		return await git.expandOid({
			fs: new ObsidianGitFs(adapter, normalizedRepositoryPath(repositoryPath)),
			dir: normalizedRepositoryPath(repositoryPath),
			oid,
		});
	} catch {
		return oid;
	}
}

function mapCommitChanges(changes: Awaited<ReturnType<typeof git.log>>[number]["commit"]["changes"]): CommitFileChange[] {
	return (changes ?? []).map(([newOid, oldOid, path]) => ({
		path: String(path),
		status: newOid === null ? "Deleted" : oldOid === null ? "Added" : "Modified",
	}));
}

function normalizedRepositoryPath(path: string): string {
	return normalizeRepositoryRoot(path);
}

function pathInRepository(repositoryPath: string, path: string): string {
	const root = normalizedRepositoryPath(repositoryPath);
	const safePath = normalizeRepositoryFilePath(path);
	return root === "." ? safePath : `${root}/${safePath}`;
}

function assertPathsDoNotTargetGitMetadata(paths: string[]): void {
	if (paths.some((path) => path === ".git" || path.startsWith(".git/"))) {
		throw new Error("Git metadata cannot be changed as a repository file.");
	}
}

function statusLabel(head: number, workdir: number, stage: number): string {
	if (head === 0 && workdir === 2 && stage === 0) return "Untracked";
	if (head === 0 && stage === 2) return workdir === 2 ? "Added" : "Added, deleted";
	if (head === 1 && workdir === 0 && stage === 1) return "Deleted";
	if (head === 1 && stage === 0) return "Deleted";
	if (head === 1 && workdir === 2 && stage === 1) return "Modified";
	if (head === 1 && stage === 2) return workdir === 2 ? "Modified" : "Deleted";
	return "Changed";
}

export class ObsidianGitFs {
	// Obsidian's mobile vault index can briefly retain a path after the backing
	// file has been moved or deleted. Validate listed entries once and reuse the
	// result for isomorphic-git's immediately following lstat call.
	private readonly validatedStats = new Map<string, Stat>();
	private readonly nestedGitDirectoryCache = new Map<string, boolean>();
	private readonly knownFilePaths = new Set<string>();
	// Only status scans reuse index metadata. Mutating Git operations keep fresh
	// stats, and each new scan starts with an empty cache.
	private indexStat: Promise<Stat | null> | null = null;
	readonly scanMetrics: RepositoryScanMetrics = {
		directoryLists: 0,
		statCalls: 0,
		indexStatCalls: 0,
		nestedRepositoryChecks: 0,
		worktreeFileReads: 0,
		worktreeBytesRead: 0,
	};

	readonly promises = {
		readFile: async (path: string, options?: string | { encoding?: string }): Promise<Uint8Array | string> => {
			try {
				const normalizedPath = this.normalized(path);
				await this.assertRepositoryBoundary(normalizedPath);
				const encoding = typeof options === "string" ? options : options?.encoding;
				const data = encoding === "utf8" || encoding === "utf-8"
					? await this.adapter.read(normalizedPath)
					: new Uint8Array(await this.adapter.readBinary(normalizedPath));
				if (!this.isGitMetadata(normalizedPath)) {
					this.scanMetrics.worktreeFileReads += 1;
					this.scanMetrics.worktreeBytesRead += typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
				}
				return data;
			} catch (error) {
				throw this.fileSystemError(path, error);
			}
		},
		writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
			this.assertWritable();
			this.forgetPath(path);
			const normalizedPath = this.normalized(path);
			try {
				await this.assertRepositoryBoundary(normalizedPath);
				if (typeof data === "string") {
					await this.adapter.write(normalizedPath, data);
					return;
				}
				await this.adapter.writeBinary(
					normalizedPath,
					data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
				);
			} catch (error) {
				throw this.adapterOperationError("write", normalizedPath, error);
			}
		},
		unlink: async (path: string): Promise<void> => {
			this.assertWritable();
			this.forgetPath(path);
			const normalizedPath = this.normalized(path);
			try {
				await this.assertRepositoryBoundary(normalizedPath);
				await this.adapter.remove(normalizedPath);
			} catch (error) {
				throw this.adapterOperationError("remove", normalizedPath, error);
			}
		},
		readdir: async (path: string): Promise<string[]> => {
			try {
				const directory = this.normalized(path);
				await this.assertRepositoryBoundary(directory);
				if (this.statusScan && !this.isStatusPathRelevant(directory)) return [];
				this.scanMetrics.directoryLists += 1;
				const listed = await this.adapter.list(directory);
				const stripDirectoryPrefix = (entry: string): string => {
					const normalizedEntry = entry.replace(/^\.\//, "");
					if (directory !== "." && normalizedEntry.startsWith(`${directory}/`)) {
						return normalizedEntry.slice(directory.length + 1);
					}
					return normalizedEntry;
				};
				const entries = [...listed.files, ...listed.folders];
				const existingEntries = await Promise.all(
					entries.map(async (entry) => {
						const relativePath = stripDirectoryPrefix(entry);
						const candidatePath = directory === "." ? relativePath : `${directory}/${relativePath}`;
						if (this.statusScan && !this.isStatusPathRelevant(candidatePath)) return null;
						try {
							const stat = await this.readStat(candidatePath, candidatePath);
							if (!stat) return null;
							if (stat.type === "file") this.knownFilePaths.add(candidatePath);
							else {
								this.knownFilePaths.delete(candidatePath);
								if (await this.isNestedGitRepository(candidatePath)) return null;
							}
							return { relativePath, candidatePath, stat };
						} catch (error) {
							if (isMissingPathError(error)) return null;
							throw error;
						}
					}),
				);

				for (const entry of existingEntries) {
					if (entry) this.validatedStats.set(entry.candidatePath, entry.stat);
				}
				return existingEntries
					.filter((entry): entry is { relativePath: string; candidatePath: string; stat: Stat } => entry !== null)
					.map((entry) => entry.relativePath);
			} catch (error) {
				throw this.fileSystemError(path, error);
			}
		},
		mkdir: async (path: string): Promise<void> => {
			this.assertWritable();
			this.forgetPath(path);
			const normalizedPath = this.normalized(path);
			try {
				await this.assertRepositoryBoundary(normalizedPath);
				await this.adapter.mkdir(normalizedPath);
			} catch (error) {
				throw this.adapterOperationError("create folder", normalizedPath, error);
			}
		},
		rmdir: async (path: string): Promise<void> => {
			this.assertWritable();
			this.forgetPath(path);
			const normalizedPath = this.normalized(path);
			try {
				await this.assertRepositoryBoundary(normalizedPath);
				await this.adapter.rmdir(normalizedPath, false);
			} catch (error) {
				throw this.adapterOperationError("remove folder", normalizedPath, error);
			}
		},
		stat: async (path: string): Promise<git.Stat> => this.stat(path),
		lstat: async (path: string): Promise<git.Stat> => this.stat(path),
		readlink: async (path: string): Promise<string> => {
			throw this.unsupportedLinkError(path);
		},
		symlink: async (_target: string, path: string): Promise<void> => {
			throw this.unsupportedLinkError(path);
		},
	};

	constructor(
		private readonly adapter: DataAdapter,
		private readonly repositoryRoot = ".",
		private readonly statusScan?: { filepaths: readonly string[] },
	) {
		this.repositoryRoot = normalizeRepositoryRoot(repositoryRoot);
	}

	private normalized(path: string): string {
		return normalizeRepositoryRoot(path);
	}

	private async stat(path: string): Promise<git.Stat> {
		const normalizedPath = this.normalized(path);
		await this.assertRepositoryBoundary(normalizedPath);
		const validated = this.validatedStats.get(normalizedPath);
		const value = validated ?? await this.readStat(normalizedPath, path);
		if (validated) this.validatedStats.delete(normalizedPath);
		if (!value) {
			throw this.fileSystemError(path);
		}
		const directory = value.type === "folder";
		return {
			ctimeSeconds: Math.floor(value.ctime / 1000),
			ctimeNanoseconds: 0,
			mtimeSeconds: Math.floor(value.mtime / 1000),
			mtimeNanoseconds: 0,
			dev: 0,
			ino: 0,
			mode: directory ? 0o040000 : 0o100644,
			uid: 0,
			gid: 0,
			size: value.size,
			isDirectory: () => directory,
			isFile: () => !directory,
			isSymbolicLink: () => false,
		} as git.Stat;
	}

	private async readStat(path: string, originalPath: string): Promise<Stat | null> {
		const isIndex = path === pathInRepository(this.repositoryRoot, ".git/index");
		if (this.statusScan && isIndex) {
			this.indexStat ??= this.readAdapterStat(path, originalPath);
			return this.indexStat;
		}
		return this.readAdapterStat(path, originalPath);
	}

	private async readAdapterStat(path: string, originalPath: string): Promise<Stat | null> {
		try {
			this.scanMetrics.statCalls += 1;
			if (path === pathInRepository(this.repositoryRoot, ".git/index")) this.scanMetrics.indexStatCalls += 1;
			return await this.adapter.stat(path);
		} catch (error) {
			throw this.fileSystemError(originalPath, error);
		}
	}

	private isGitMetadata(path: string): boolean {
		const gitdir = pathInRepository(this.repositoryRoot, ".git");
		return path === gitdir || path.startsWith(`${gitdir}/`);
	}

	private isStatusPathRelevant(path: string): boolean {
		if (this.isGitMetadata(path)) return false;
		const relative = path === this.repositoryRoot ? "."
			: this.repositoryRoot === "." ? path : path.slice(this.repositoryRoot.length + 1);
		return this.statusScan!.filepaths.some((target) => target === "." || relative === "." || relative === target ||
			relative.startsWith(`${target}/`) || target.startsWith(`${relative}/`));
	}

	private assertWritable(): void {
		if (this.statusScan) throw new Error("Status scans cannot write repository files.");
	}

	private forgetPath(path: string): void {
		const normalized = this.normalized(path);
		this.knownFilePaths.delete(normalized);
		this.validatedStats.delete(normalized);
		this.nestedGitDirectoryCache.delete(normalized);
	}

	private async assertRepositoryBoundary(path: string): Promise<void> {
		const normalizedPath = this.normalized(path);
		let relativePath: string;
		if (this.repositoryRoot === ".") relativePath = normalizedPath;
		else if (normalizedPath === this.repositoryRoot) relativePath = "";
		else if (normalizedPath.startsWith(`${this.repositoryRoot}/`)) relativePath = normalizedPath.slice(this.repositoryRoot.length + 1);
		else throw new Error(`Git operation path "${normalizedPath}" escapes repository root "${this.repositoryRoot}".`);

		const segments = relativePath.split("/").filter(Boolean);
		let candidate = this.repositoryRoot === "." ? "" : this.repositoryRoot;
		for (const segment of segments) {
			candidate = candidate ? `${candidate}/${segment}` : segment;
			if (segment === ".git" && candidate === (this.repositoryRoot === "." ? ".git" : `${this.repositoryRoot}/.git`)) break;
			if (candidate !== this.repositoryRoot && await this.isNestedGitRepository(candidate)) {
				throw new Error(`Repository boundary blocked access into nested Git repository at "${candidate}".`);
			}
		}
	}

	private async isNestedGitRepository(path: string): Promise<boolean> {
		const normalizedPath = this.normalized(path);
		if (normalizedPath === this.repositoryRoot || this.knownFilePaths.has(normalizedPath)) return false;
		const cached = this.nestedGitDirectoryCache.get(normalizedPath);
		if (cached !== undefined) return cached;
		this.scanMetrics.nestedRepositoryChecks += 1;
		const hasMetadata = await this.adapter.exists(`${normalizedPath}/.git`);
		this.nestedGitDirectoryCache.set(normalizedPath, hasMetadata);
		return hasMetadata;
	}

	private fileSystemError(path: string, cause?: unknown): Error & { code: string } {
		if (cause && typeof cause === "object" && "code" in cause) {
			return cause as Error & { code: string };
		}
		const error = new Error(`ENOENT: no such file or directory, '${path}'`) as Error & { code: string };
		error.code = "ENOENT";
		return error;
	}

	private unsupportedLinkError(path: string): Error & { code: string } {
		const error = new Error(`EINVAL: symbolic links are not supported for '${path}'`) as Error & { code: string };
		error.code = "EINVAL";
		return error;
	}

	private adapterOperationError(operation: string, path: string, cause: unknown): Error & { code?: string } {
		const record = cause && typeof cause === "object" ? cause as Record<string, unknown> : null;
		const code = record && typeof record.code === "string" ? record.code : "";
		const message = cause instanceof Error
			? cause.message
			: record && typeof record.message === "string"
				? record.message
				: String(cause ?? "adapter error");
		const detail = message || code || "adapter error";
		const error = new Error(`${operation} '${path}' failed: ${detail}`) as Error & { code?: string };
		if (code) error.code = code;
		return error;
	}
}

function isMissingPathError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as { code?: unknown; message?: unknown };
	return candidate.code === "ENOENT" || /no such file|not found/i.test(String(candidate.message ?? ""));
}
