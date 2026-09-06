import { DataAdapter, requestUrl } from "obsidian";
import * as git from "isomorphic-git";
import { ObsidianGitFs, validateRepositoryPath } from "./repository";

export const REMOTE_TOKEN_SECRET_ID = "git-sync-remote-token";

export interface RemoteCredential {
	username: string;
	token: string;
}

export interface RemoteAuthor {
	name: string;
	email: string;
}

export interface RemoteConnectionInfo {
	remoteUrl: string;
	defaultBranch: string | null;
	branches: string[];
	capabilities: string[];
}

export interface RemoteRepositoryOptions {
	adapter: DataAdapter;
	repositoryPath: string;
	remoteUrl: string;
	branchName: string;
	credential: RemoteCredential | null;
	author: RemoteAuthor | null;
	onDiagnostic?: (message: string) => void;
}

export async function testRemoteConnection(
	remoteUrl: string,
	credential: RemoteCredential | null,
): Promise<RemoteConnectionInfo> {
	const url = validateRemoteUrl(remoteUrl);
	const info = await git.getRemoteInfo({
		http: obsidianHttp,
		url,
		onAuth: (_url, auth) => credential
			? { ...auth, username: credential.username, password: credential.token }
			: auth,
	});

	return {
		remoteUrl: url,
		defaultBranch: info.HEAD ?? null,
		branches: Object.keys(info.heads ?? {}).sort(),
		capabilities: info.capabilities,
	};
}

export async function fetchRepository(options: RemoteRepositoryOptions): Promise<void> {
	const { fs, dir, url, branch } = await prepareRemote(options);
	diagnostic(options, `Fetch: requesting origin/${branch} from ${url}.`);
	const result = await git.fetch({
		fs,
		http: obsidianHttp,
		dir,
		remote: "origin",
		url,
		ref: branch,
		singleBranch: true,
		onAuth: authCallback(options.credential),
	});
	diagnostic(options, `Fetch: received ${result.fetchHead ? result.fetchHead.slice(0, 7) : "no commit"}.`);
}

export async function pullRepository(options: RemoteRepositoryOptions): Promise<void> {
	const { fs, dir, url, branch } = await prepareRemote(options);
	if (!options.author?.name || !options.author.email) {
		throw new Error("Set your commit name and email before pulling.");
	}
	diagnostic(options, `Pull: requesting origin/${branch} from ${url}.`);
	await git.pull({
		fs,
		http: obsidianHttp,
		dir,
		remote: "origin",
		url,
		ref: branch,
		singleBranch: true,
		fastForwardOnly: true,
		author: options.author,
		committer: options.author,
		onAuth: authCallback(options.credential),
	});
	diagnostic(options, `Pull: completed fast-forward check for ${branch}.`);
}

export async function pushRepository(options: RemoteRepositoryOptions): Promise<void> {
	const { fs, dir, url, branch } = await prepareRemote(options);
	diagnostic(options, `Push: sending ${branch} to ${url}.`);
	const result = await git.push({
		fs,
		http: obsidianHttp,
		dir,
		remote: "origin",
		url,
		ref: branch,
		remoteRef: branch,
		onAuth: authCallback(options.credential),
	});
	diagnostic(options, `Push: server response ${result.ok ? "accepted" : result.error ?? "rejected"}.`);
	if (result.error) throw new Error(result.error);
}

export async function cloneRepository(options: RemoteRepositoryOptions): Promise<void> {
	const dir = validateRepositoryDirectory(options.repositoryPath);
	const url = validateRemoteUrl(options.remoteUrl);
	const branch = validateBranchName(options.branchName);
	const fs = new ObsidianGitFs(options.adapter);
	const listing = await listDirectory(options.adapter, dir);
	if (listing && (listing.files.length > 0 || listing.folders.length > 0)) {
		throw new Error(`The clone destination '${dir}' is not empty.`);
	}

	diagnostic(options, `Clone: requesting ${branch} from ${url} into ${dir}.`);
	await git.clone({
		fs,
		http: obsidianHttp,
		dir,
		url,
		ref: branch,
		singleBranch: true,
		onAuth: authCallback(options.credential),
	});
	diagnostic(options, `Clone: completed repository setup in ${dir}.`);
}

async function prepareRemote(options: RemoteRepositoryOptions): Promise<{
	fs: ObsidianGitFs;
	dir: string;
	url: string;
	branch: string;
}> {
	const dir = validateRepositoryDirectory(options.repositoryPath);
	const url = validateRemoteUrl(options.remoteUrl);
	const branch = validateBranchName(options.branchName);
	const fs = new ObsidianGitFs(options.adapter);
	diagnostic(options, `Remote setup: validated ${dir} and branch ${branch}.`);
	await git.addRemote({ fs, dir, remote: "origin", url, force: true });
	diagnostic(options, `Remote setup: origin configured for ${url}.`);
	return { fs, dir, url, branch };
}

function validateRepositoryDirectory(value: string): string {
	const error = validateRepositoryPath(value);
	if (error) throw new Error(error);
	const path = value.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") || ".";
	if (path === ".") return path;
	return path;
}

function validateBranchName(value: string): string {
	const branch = value.trim();
	if (!branch) throw new Error("Enter a branch before using a remote operation.");
	if (branch.startsWith("-") || branch.includes("..") || branch.includes(" ")) {
		throw new Error("Use a simple branch name without spaces or '..'.");
	}
	return branch;
}

async function listDirectory(adapter: DataAdapter, path: string): Promise<{ files: string[]; folders: string[] } | null> {
	try {
		return await adapter.list(path);
	} catch {
		return null;
	}
}

function authCallback(credential: RemoteCredential | null): (url: string, auth: git.GitAuth) => git.GitAuth {
	return (_url, auth) => credential
		? { ...auth, username: credential.username, password: credential.token }
		: auth;
}

function diagnostic(options: RemoteRepositoryOptions, message: string): void {
	options.onDiagnostic?.(`[remote] ${message}`);
}

function validateRemoteUrl(value: string): string {
	const url = value.trim();
	if (!url) throw new Error("Enter a remote URL before testing the connection.");
	if (!/^https?:\/\//i.test(url)) {
		throw new Error("Use an HTTP or HTTPS Git remote URL.");
	}
	return url;
}

const obsidianHttp: any = {
	request: async (request: any): Promise<any> => {
		const response = await requestUrl({
			url: request.url,
			method: request.method,
			headers: request.headers,
			body: request.body ? await collectBody(request.body) : undefined,
			throw: false,
		});

		return {
			url: request.url,
			method: request.method,
			headers: response.headers,
			statusCode: response.status,
			statusMessage: response.status === 200 ? "OK" : `HTTP ${response.status}`,
			body: responseBody(response.arrayBuffer),
		};
	},
};

const ASYNC_ITERATOR = (Symbol as unknown as { asyncIterator: symbol }).asyncIterator;

async function collectBody(body: any): Promise<ArrayBuffer> {
	const chunks: Uint8Array[] = [];
	if (Array.isArray(body)) {
		for (const chunk of body) chunks.push(toUint8Array(chunk));
	} else if (body && typeof body[ASYNC_ITERATOR] === "function") {
		for await (const chunk of body) chunks.push(toUint8Array(chunk));
	} else if (body && typeof body.next === "function") {
		while (true) {
			const result = await body.next();
			if (result.done) break;
			if (result.value) chunks.push(toUint8Array(result.value));
		}
	} else {
		throw new Error("Git HTTP request body is not readable.");
	}

	return combineChunks(chunks);
}

function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function combineChunks(chunks: Uint8Array[]): ArrayBuffer {
	let size = 0;
	for (const chunk of chunks) size += chunk.byteLength;

	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result.buffer;
}

function responseBody(buffer: ArrayBuffer): any {
	let consumed = false;
	return {
		next: async () => {
			if (consumed) return { done: true, value: undefined };
			consumed = true;
			return { done: false, value: new Uint8Array(buffer) };
		},
		[ASYNC_ITERATOR]() {
			return this;
		},
	};
}
