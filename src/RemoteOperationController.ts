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
	getSettings(): GitSyncSettings;
	getRemoteCredential(): RemoteCredential | null;
	recordActivity(message: string, level?: ActivityLevel): void;
	refreshViews(reason?: string, refreshChanges?: boolean): void;
	refreshRemoteHistoryViews(reason?: string): void;
	markChangesRefreshRequiredViews(reason: string): void;
}

export class RemoteOperationController {
	private operationQueue: Promise<void> = Promise.resolve();

	constructor(private readonly host: RemoteOperationHost) {}

	async checkConnection(): Promise<void> {
		const settings = this.host.getSettings();
		try {
			const info = await testRemoteConnection(settings.remoteUrl, this.host.getRemoteCredential());
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
		return this.run("Fetch", (modal) => fetchRepository(this.repositoryOptions(modal)));
	}

	pull(): Promise<void> {
		return this.run("Pull", (modal) => pullRepository(this.repositoryOptions(modal)));
	}

	forcePull(): void {
		const branchName = this.host.getSettings().branchName;
		new ConfirmActionModal(
			this.host.app,
			"Reset local branch to remote?",
			`This fetches origin/${branchName} and discards local commits and tracked changes that are not on the remote branch.`,
			() => void this.run("Force Pull", (modal) => forcePullRepository(this.repositoryOptions(modal))),
			"Reset to Remote",
		).open();
	}

	push(): Promise<void> {
		return this.run("Push", (modal) => pushRepository(this.repositoryOptions(modal)));
	}

	forcePush(): void {
		const branchName = this.host.getSettings().branchName;
		new ConfirmActionModal(
			this.host.app,
			"Force push to remote?",
			`This overwrites origin/${branchName} with the local branch and may discard commits currently on the remote.`,
			() => void this.run("Force Push", (modal) => forcePushRepository(this.repositoryOptions(modal))),
			"Force Push",
		).open();
	}

	clone(): Promise<void> {
		return this.run("Clone", (modal) => cloneRepository(this.repositoryOptions(modal)));
	}

	private repositoryOptions(progressModal?: GitProgressModal) {
		const settings = this.host.getSettings();
		return {
			adapter: this.host.app.vault.adapter,
			repositoryPath: settings.repositoryPath,
			remoteUrl: settings.remoteUrl,
			branchName: settings.branchName,
			credential: this.host.getRemoteCredential(),
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

	private run(name: string, operation: (modal: GitProgressModal) => Promise<RemoteOperationResult>): Promise<void> {
		this.host.recordActivity(`${name} requested.`);
		const next = this.operationQueue
			.catch(() => undefined)
			.then(async () => {
				const settings = this.host.getSettings();
				this.host.recordActivity(`${name} started for ${settings.branchName}.`);
				const startedAt = Date.now();
				const modal = new GitProgressModal(this.host.app, name, settings.branchName, {
					onPhase: (phase) => this.host.recordActivity(`${name}: ${phase}.`, "DEBUG"),
					onMessage: (message) => this.host.recordActivity(`${name}: ${safeRemoteMessage(message)}`, "DEBUG"),
				});
				modal.open();
				try {
					const result = await operation(modal);
					this.host.recordActivity(`${name} completed for ${settings.branchName}.`);
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
					invalidateRepositorySnapshot(this.host.getSettings().repositoryPath);
				}
			});
		this.operationQueue = next;
		return next;
	}
}
