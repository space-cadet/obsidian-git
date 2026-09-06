import { requestUrl } from "obsidian";
import * as git from "isomorphic-git";

export const REMOTE_TOKEN_SECRET_ID = "git-sync-remote-token";

export interface RemoteCredential {
	username: string;
	token: string;
}

export interface RemoteConnectionInfo {
	remoteUrl: string;
	defaultBranch: string | null;
	branches: string[];
	capabilities: string[];
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

async function collectBody(body: any): Promise<ArrayBuffer> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const result = await body.next();
		if (result.done) break;
		if (result.value) {
			chunks.push(result.value);
			size += result.value.byteLength;
		}
	}

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
	};
}
