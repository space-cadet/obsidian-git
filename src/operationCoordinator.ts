export interface GitOperationContext {
	id: number;
	name: string;
	signal: AbortSignal;
}

export type OperationLifecycle = 'started' | 'completed' | 'failed' | 'cancelled' | 'idle';

export interface OperationLifecycleEvent {
	lifecycle: OperationLifecycle;
	id: number;
	name: string;
	startedAt: number;
	elapsedMs?: number;
	error?: unknown;
}

export class OperationCancelledError extends Error {
	constructor(message = 'Git operation cancelled') {
		super(message);
		this.name = 'AbortError';
	}
}

function isAbortError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
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
		startedAt: number;
	} | null = null;
	private disposed = false;
	private listeners = new Set<(event: OperationLifecycleEvent) => void>();

	get activeOperation(): { id: number; name: string } | null {
		if (!this.active) return null;
		return { id: this.active.id, name: this.active.name };
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	subscribe(listener: (event: OperationLifecycleEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async run<T>(name: string, operation: (context: GitOperationContext) => Promise<T>): Promise<T> {
		if (this.disposed) throw new Error('Git operation coordinator is unavailable after plugin unload.');
		if (this.active) throw new OperationInProgressError(this.active.name);

		const controller = new AbortController();
		const active = { id: this.nextId++, name, controller, startedAt: Date.now() };
		this.active = active;
		this.emit({ lifecycle: 'started', id: active.id, name, startedAt: active.startedAt });
		try {
			const result = await operation({ id: active.id, name, signal: controller.signal });
			// A callback may finish after cancellation if the underlying API does
			// not observe AbortSignal. Never turn that late result into a false
			// success for the caller.
			if (controller.signal.aborted) throw new OperationCancelledError();
			this.emit({
				lifecycle: 'completed',
				id: active.id,
				name,
				startedAt: active.startedAt,
				elapsedMs: Date.now() - active.startedAt,
			});
			return result;
		} catch (error) {
			const cancelled = controller.signal.aborted || isAbortError(error);
			const finalError = cancelled && !(error instanceof OperationCancelledError)
				? new OperationCancelledError()
				: error;
			this.emit({
				lifecycle: cancelled ? 'cancelled' : 'failed',
				id: active.id,
				name,
				startedAt: active.startedAt,
				elapsedMs: Date.now() - active.startedAt,
				error: finalError,
			});
			throw finalError;
		} finally {
			if (this.active?.id === active.id) {
				this.active = null;
				this.emit({
					lifecycle: 'idle',
					id: active.id,
					name,
					startedAt: active.startedAt,
					elapsedMs: Date.now() - active.startedAt,
				});
			}
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

	private emit(event: OperationLifecycleEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Lifecycle observers must never change the operation result.
			}
		}
	}
}
