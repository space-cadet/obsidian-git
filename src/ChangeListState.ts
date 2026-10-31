import type { ChangedFile } from "./repository";

/** Apply a completed stage or unstage action to the in-memory Changes snapshot. */
export function applyStagingToSnapshot(
	current: ChangedFile[] | null,
	affectedChanges: readonly ChangedFile[],
	staged: boolean,
): ChangedFile[] | null {
	const paths = new Set(affectedChanges.map((change) => change.path));
	return current?.map((change) => {
		if (!paths.has(change.path)) return change;
		const status = staged && change.status === "Untracked"
			? "Added"
			: !staged && change.status === "Added"
				? "Untracked"
				: change.status;
		return { ...change, status, staged };
	}) ?? null;
}

/** Replace refreshed paths while retaining the rest of the current snapshot. */
export function replaceChangedPaths(
	current: ChangedFile[] | null,
	affectedPaths: readonly string[],
	updates: readonly ChangedFile[],
): ChangedFile[] {
	const affected = new Set(affectedPaths);
	return (current ?? [])
		.filter((change) => !affected.has(change.path))
		.concat([...updates]);
}
