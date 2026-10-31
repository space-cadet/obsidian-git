export type ChangeSelectionSection = "staged" | "uncommitted";

interface PathChange {
	path: string;
}

/** Owns path selection and range anchors for the Changes view. */
export class ChangeSelection {
	private readonly selectedPaths = new Set<string>();
	private readonly anchors = new Map<ChangeSelectionSection, string>();

	isSelected(path: string): boolean {
		return this.selectedPaths.has(path);
	}

	select(path: string): void {
		this.selectedPaths.add(path);
	}

	deselect(path: string): void {
		this.selectedPaths.delete(path);
	}

	setSelected(paths: Iterable<string>, selected: boolean): void {
		for (const path of paths) {
			if (selected) this.select(path);
			else this.deselect(path);
		}
	}

	selectAll(changes: readonly PathChange[]): void {
		this.setSelected(changes.map((change) => change.path), true);
	}

	clear(): void {
		this.selectedPaths.clear();
	}

	clearPaths(paths: Iterable<string>): void {
		this.setSelected(paths, false);
	}

	countSelected(changes: readonly PathChange[]): number {
		return changes.reduce((count, change) => count + Number(this.isSelected(change.path)), 0);
	}

	retainAvailablePaths(availablePaths: ReadonlySet<string>): void {
		for (const path of this.selectedPaths) {
			if (!availablePaths.has(path)) this.selectedPaths.delete(path);
		}
	}

	handleClick(
		section: ChangeSelectionSection,
		path: string,
		extend: boolean,
		visibleChanges: readonly PathChange[],
	): void {
		if (extend) {
			const anchor = this.anchors.get(section);
			if (anchor) this.selectRange(anchor, path, visibleChanges);
			else this.select(path);
			return;
		}

		if (this.isSelected(path)) this.deselect(path);
		else this.select(path);
		this.anchors.set(section, path);
	}

	beginRange(section: ChangeSelectionSection, path: string): void {
		this.anchors.set(section, path);
		this.select(path);
	}

	selectRange(
		anchor: string,
		target: string,
		visibleChanges: readonly PathChange[],
	): void {
		const anchorIndex = visibleChanges.findIndex((change) => change.path === anchor);
		const targetIndex = visibleChanges.findIndex((change) => change.path === target);
		if (anchorIndex === -1 || targetIndex === -1) {
			this.select(target);
			return;
		}

		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);
		for (const change of visibleChanges.slice(start, end + 1)) this.select(change.path);
	}
}
