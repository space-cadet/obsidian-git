import { normalizeRepositoryRoot, repositoryRootsOverlap } from "./repositoryPaths";

interface PendingMutation<T = unknown> {
	root: string;
	operation: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

/** Serializes writes to the same repository and prevents concurrent writes to overlapping roots. */
export class RepositoryMutationCoordinator {
	private readonly activeRoots = new Set<string>();
	private readonly pending: PendingMutation[] = [];

	run<T>(repositoryPath: string, operation: () => Promise<T>): Promise<T> {
		const root = normalizeRepositoryRoot(repositoryPath);
		return new Promise<T>((resolve, reject) => {
			this.pending.push({ root, operation, resolve, reject } as PendingMutation);
			this.pump();
		});
	}

	isBusy(repositoryPath?: string): boolean {
		if (repositoryPath === undefined) return this.activeRoots.size > 0 || this.pending.length > 0;
		const root = normalizeRepositoryRoot(repositoryPath);
		return [...this.activeRoots].some((active) => repositoryRootsOverlap(active, root))
			|| this.pending.some((item) => repositoryRootsOverlap(item.root, root));
	}

	private pump(): void {
		for (let index = 0; index < this.pending.length;) {
			const item = this.pending[index];
			if ([...this.activeRoots].some((active) => repositoryRootsOverlap(active, item.root))) {
				index += 1;
				continue;
			}
			this.pending.splice(index, 1);
			this.activeRoots.add(item.root);
			const finish = (): void => {
				this.activeRoots.delete(item.root);
				this.pump();
			};
			void Promise.resolve().then(item.operation).then(
				(value) => { item.resolve(value); finish(); },
				(error) => { item.reject(error); finish(); },
			);
		}
	}
}

export const repositoryMutationCoordinator = new RepositoryMutationCoordinator();
