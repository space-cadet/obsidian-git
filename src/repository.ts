import { DataAdapter } from "obsidian";

export type RepositoryState =
	| { kind: "checking"; repositoryPath: string }
	| { kind: "missing"; repositoryPath: string }
	| { kind: "ready"; repositoryPath: string; branch: string; head: string | null }
	| { kind: "error"; repositoryPath: string; message: string };

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

function normalizedRepositoryPath(path: string): string {
	const trimmed = path.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
	return trimmed || ".";
}

function pathInRepository(repositoryPath: string, path: string): string {
	return repositoryPath === "." ? path : `${repositoryPath}/${path}`;
}
