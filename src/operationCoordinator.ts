export interface GitOperationContext {
	id: number;
	name: string;
	signal: AbortSignal;
}

export class OperationInProgressError extends Error {
	readonly operationName: string;

	constructor(operationName: string) {
		super(`Git operation already in progress: ${operationName}`);
		this.name = 'OperationInProgressError';
		this.operationName = operationName;
	}
}

export class OperationCoordinator {
	private nextId = 1;
	private active: {
		id: number;
		name: string;
		controller: AbortController;
	} | null = null;
	private disposed = false;

	get activeOperation(): { id: number; name: string } | null {
		if (!this.active) return null;
		return { id: this.active.id, name: this.active.name };
	}

	async run<T>(name: string, operation: (context: GitOperationContext) => Promise<T>): Promise<T> {
		if (this.disposed) throw new Error('Git operation coordinator is unavailable after plugin unload.');
		if (this.active) throw new OperationInProgressError(this.active.name);

		const controller = new AbortController();
		const active = { id: this.nextId++, name, controller };
		this.active = active;
		try {
			return await operation({ id: active.id, name, signal: controller.signal });
		} finally {
			if (this.active?.id === active.id) this.active = null;
		}
	}

	cancelActive(): void {
		if (!this.active || this.active.controller.signal.aborted) return;
		this.active.controller.abort();
	}

	dispose(): void {
		this.disposed = true;
		this.cancelActive();
	}
}
