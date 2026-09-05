import { DataAdapter } from "obsidian";
import { Buffer } from "buffer";
import * as git from "isomorphic-git";

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

export function validateRepositoryPath(value: string): string | null {
	const path = value.trim();
	if (!path) return "Enter a repository path.";
	if (path.startsWith("/")) return "Use a vault-relative repository path.";
	if (path.split("/").indexOf("..") !== -1) return "Repository paths cannot leave the vault.";
	return null;
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

		const head = (await adapter.read(headPath)).trim();
		if (head.startsWith("ref: ")) {
			const ref = head.slice("ref: ".length);
			const branch = ref.replace("refs/heads/", "");
			const refPath = pathInRepository(path, `.git/${ref}`);
			const commit = (await adapter.exists(refPath))
				? (await adapter.read(refPath)).trim()
				: null;
			return { kind: "ready", repositoryPath: path, branch, head: commit };
		}

		return {
			kind: "ready",
			repositoryPath: path,
			branch: "Detached HEAD",
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

export async function readChanges(adapter: DataAdapter, repositoryPath: string): Promise<ChangedFile[]> {
	const fs = new ObsidianGitFs(adapter);
	const dir = normalizedRepositoryPath(repositoryPath);
	const matrix = await git.statusMatrix({ fs, dir, refresh: false });
	return matrix
		.filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
		.map(([path, head, workdir, stage]) => ({
			path,
			status: statusLabel(head, workdir, stage),
			staged: head === stage ? false : stage === workdir,
		}));
}

export async function stageFile(adapter: DataAdapter, repositoryPath: string, path: string): Promise<void> {
	await git.add({ fs: new ObsidianGitFs(adapter), dir: normalizedRepositoryPath(repositoryPath), filepath: path });
}

export async function unstageFile(adapter: DataAdapter, repositoryPath: string, path: string): Promise<void> {
	await git.resetIndex({ fs: new ObsidianGitFs(adapter), dir: normalizedRepositoryPath(repositoryPath), filepath: path });
}

export async function commitChanges(
	adapter: DataAdapter,
	repositoryPath: string,
	message: string,
	author: CommitAuthor,
): Promise<string> {
	return git.commit({
		fs: new ObsidianGitFs(adapter),
		dir: normalizedRepositoryPath(repositoryPath),
		message,
		author,
	});
}

function normalizedRepositoryPath(path: string): string {
	const trimmed = path.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
	return trimmed || ".";
}

function pathInRepository(repositoryPath: string, path: string): string {
	return repositoryPath === "." ? path : `${repositoryPath}/${path}`;
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

class ObsidianGitFs {
	readonly promises = {
		readFile: async (path: string, options?: string | { encoding?: string }): Promise<Uint8Array | string> => {
			try {
				const encoding = typeof options === "string" ? options : options?.encoding;
				if (encoding === "utf8" || encoding === "utf-8") {
					return this.adapter.read(this.normalized(path));
				}
				return new Uint8Array(await this.adapter.readBinary(this.normalized(path)));
			} catch (error) {
				throw this.fileSystemError(path, error);
			}
		},
		writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
			if (typeof data === "string") {
				await this.adapter.write(this.normalized(path), data);
				return;
			}
			await this.adapter.writeBinary(
				this.normalized(path),
				data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
			);
		},
		unlink: async (path: string): Promise<void> => this.adapter.remove(this.normalized(path)),
		readdir: async (path: string): Promise<string[]> => {
			try {
				const listed = await this.adapter.list(this.normalized(path));
				return [...listed.files, ...listed.folders].map((entry) => entry.split("/").pop() ?? entry);
			} catch (error) {
				throw this.fileSystemError(path, error);
			}
		},
		mkdir: async (path: string): Promise<void> => this.adapter.mkdir(this.normalized(path)),
		rmdir: async (path: string): Promise<void> => this.adapter.rmdir(this.normalized(path), false),
		stat: async (path: string): Promise<git.Stat> => this.stat(path),
		lstat: async (path: string): Promise<git.Stat> => this.stat(path),
		readlink: async (path: string): Promise<string> => {
			throw this.unsupportedLinkError(path);
		},
		symlink: async (_target: string, path: string): Promise<void> => {
			throw this.unsupportedLinkError(path);
		},
	};

	constructor(private readonly adapter: DataAdapter) {}

	private normalized(path: string): string {
		return path.replace(/^\.\//, "").replace(/\\/g, "/");
	}

	private async stat(path: string): Promise<git.Stat> {
		let value;
		try {
			value = await this.adapter.stat(this.normalized(path));
		} catch (error) {
			throw this.fileSystemError(path, error);
		}
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
}
