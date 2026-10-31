export function normalizeRepositoryRoot(value: unknown): string {
	if (typeof value !== "string") throw new Error("Repository root must be a vault-relative path.");
	const path = value.trim().replace(/\\/g, "/");
	if (path.includes("\0") || path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/.test(path)) {
		throw new Error("Repository root must stay inside the open vault.");
	}
	const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (segments.some((segment) => segment === "..")) {
		throw new Error("Repository root cannot contain parent-directory segments.");
	}
	return segments.join("/") || ".";
}

export function repositoryRootsOverlap(leftValue: unknown, rightValue: unknown): boolean {
	const left = normalizeRepositoryRoot(leftValue);
	const right = normalizeRepositoryRoot(rightValue);
	if (left === right || left === "." || right === ".") return true;
	return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function normalizeRepositoryFilePath(value: unknown): string {
	const path = normalizeRepositoryRoot(value);
	if (path === ".") throw new Error("Choose a file or folder inside the repository.");
	return path;
}
