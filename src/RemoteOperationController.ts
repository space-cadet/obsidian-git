import { App, Notice } from "obsidian";
import { invalidateRepositorySnapshot } from "./repository";
import {
	cloneRepository,
	fetchRepository,
	forcePullRepository,
	forcePushRepository,
	pushRepository,
	pullRepository,
	testRemoteConnection,
} from "./remote";
import type { GitSyncSettings, ActivityLevel } from "./pluginData";
import { ConfirmActionModal, GitProgressModal, safeRemoteMessage } from "./dialogs";
import { describeOperationError, elapsedMilliseconds, formatMilliseconds } from "./operationDiagnostics";
import type { RemoteCredential, RemoteOperationResult, RemoteProgressEvent } from "./remote";

interface RemoteOperationHost {
	app: App;
	getRepositoryOperationContext(): RepositoryOperationContext;
	recordActivity(message: string, level?: ActivityLevel): void;
	refreshViews(reason?: string, refreshChanges?: boolean): void;
	refreshRemoteHistoryViews(reason?: string): void;
	markChangesRefreshRequiredViews(reason: string): void;
}

export interface RepositoryOperationContext {
	repositoryId: string;
	settings: GitSyncSettings;
	credential: RemoteCredential | null;
}

export class RemoteOperationController {
	private operationQueue: Promise<void> = Promise.resolve();
	private pendingOperations = 0;

	constructor(private readonly host: RemoteOperationHost) {}

	isBusy(): boolean {
		return this.pendingOperations > 0;
	}

	async checkConnection(): Promise<void> {
		const { settings, credential } = this.host.getRepositoryOperationContext();
		try {
			const info = await testRemoteConnection(settings.remoteUrl, credential);
			const branch = info.defaultBranch ? ` Default branch: ${info.defaultBranch}.` : "";
			this.host.recordActivity(`Remote connection succeeded: ${info.remoteUrl}.${branch}`);
			new Notice(`Remote connection succeeded.${branch}`);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Remote connection failed.";
			this.host.recordActivity(`Remote connection failed: ${detail}`, "ERROR");
			new Notice(detail);
		}
	}

	fetch(): Promise<void> {
		return this.run("Fetch", (context, modal) => fetchRepository(this.repositoryOptions(context, modal))).then(() => undefined);
	}

	pull(): Promise<void> {
		return this.run("Pull", (context, modal) => pullRepository(this.repositoryOptions(context, modal))).then(() => undefined);
	}

	forcePull(): void {
		const context = this.host.getRepositoryOperationContext();
		const branchName = context.settings.branchName;
		new ConfirmActionModal(
			this.host.app,
			"Reset local branch to remote?",
			`This resets ${context.settings.repositoryPath} to origin/${branchName} and discards local commits and tracked changes that are not on that remote branch.`,
			() => void this.run("Force Pull", (target, modal) => forcePullRepository(this.repositoryOptions(target, modal)), context),
			"Reset to Remote",
		).open();
	}

	push(): Promise<void> {
		return this.run("Push", (context, modal) => pushRepository(this.repositoryOptions(context, modal))).then(() => undefined);
	}

	forcePush(): void {
		const context = this.host.getRepositoryOperationContext();
		const branchName = context.settings.branchName;
		new ConfirmActionModal(
			this.host.app,
			"Force push to remote?",
			`This overwrites origin/${branchName} for ${context.settings.repositoryPath} and may discard commits currently on the remote.`,
			() => void this.run("Force Push", (target, modal) => forcePushRepository(this.repositoryOptions(target, modal)), context),
			"Force Push",
		).open();
	}

	clone(context?: RepositoryOperationContext): Promise<boolean> {
		return this.run("Clone", (target, modal) => cloneRepository(this.repositoryOptions(target, modal)), context);
	}

	private repositoryOptions(context: RepositoryOperationContext, progressModal?: GitProgressModal) {
		const { settings } = context;
		return {
			adapter: this.host.app.vault.adapter,
			repositoryPath: settings.repositoryPath,
			remoteUrl: settings.remoteUrl,
			branchName: settings.branchName,
			credential: context.credential,
			author: {
				name: settings.authorName.trim(),
				email: settings.authorEmail.trim(),
			},
			onDiagnostic: (message: string) => this.host.recordActivity(message, "DEBUG"),
			onPhase: progressModal
				? (phase: string) => progressModal.setPhase(phase)
				: undefined,
			onProgress: progressModal
				? (event: RemoteProgressEvent) => progressModal.updateProgress(event)
				: undefined,
			onMessage: progressModal
				? (message: string) => progressModal.addRemoteMessage(message)
				: undefined,
		};
	}

	private run(
		name: string,
		operation: (context: RepositoryOperationContext, modal: GitProgressModal) => Promise<RemoteOperationResult>,
		requestedContext?: RepositoryOperationContext,
	): Promise<boolean> {
		const target = requestedContext ?? this.host.getRepositoryOperationContext();
		let succeeded = false;
		this.pendingOperations += 1;
		this.host.recordActivity(`${name} requested for ${target.settings.repositoryPath} (${target.settings.branchName}).`);
		const next = this.operationQueue
			.catch(() => undefined)
			.then(async () => {
				const { settings } = target;
				this.host.recordActivity(`${name} started for ${settings.repositoryPath} on ${settings.branchName}.`);
				const startedAt = Date.now();
				const modal = new GitProgressModal(this.host.app, name, `${settings.repositoryPath} · ${settings.branchName}`, {
					onPhase: (phase) => this.host.recordActivity(`${name}: ${phase}.`, "DEBUG"),
					onMessage: (message) => this.host.recordActivity(`${name}: ${safeRemoteMessage(message)}`, "DEBUG"),
				});
				modal.open();
				try {
					const result = await operation(target, modal);
					succeeded = true;
					this.host.recordActivity(`${name} completed for ${settings.repositoryPath} on ${settings.branchName}.`);
					this.host.recordActivity(`${name} completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`, "METRIC");
					this.host.recordActivity(`${name}: ${result.summary}`);
					for (const detail of result.details) this.host.recordActivity(`${name}: ${detail}`, "DEBUG");
					if (name === "Pull" || name === "Force Pull" || name === "Clone") {
						this.host.refreshViews(`${name.toLowerCase()}-metadata-refresh`, false);
					} else {
						this.host.refreshRemoteHistoryViews(`${name.toLowerCase()}-history-refresh`);
					}
					modal.complete(result);
					new Notice(`${name} completed.`);
				} catch (error) {
					const detail = describeOperationError(error, `${name} failed.`);
					this.host.recordActivity(`${name} failed: ${detail}`, "ERROR");
					this.host.recordActivity(`${name} failed after ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`, "METRIC");
					if (name === "Pull" || name === "Force Pull" || name === "Clone") this.host.markChangesRefreshRequiredViews(name);
					modal.fail(detail);
					new Notice(`${name} failed: ${detail}`);
				} finally {
					invalidateRepositorySnapshot(target.settings.repositoryPath);
				}
			})
			.then(
				() => { this.pendingOperations -= 1; },
				(error) => { this.pendingOperations -= 1; throw error; },
			);
		this.operationQueue = next.then(() => undefined, () => undefined);
		return next.then(() => succeeded);
	}
}
