import { Notice, Plugin } from "obsidian";
import { GIT_BRANCH, GIT_COMMIT_HASH } from "./build-info";
import { createIntegrationProvider } from "./integrationProvider";
import { GitSyncSettingTab } from "./GitSyncSettingTab";
import { GitSyncView, VIEW_TYPE_GIT_SYNC } from "./GitSyncView";
import {
	ACTIVITY_LOG_COMPACTION_THRESHOLD,
	DEFAULT_SETTINGS,
	MAX_ACTIVITY_ENTRIES,
	PLUGIN_DATA_FORMAT,
	PLUGIN_DATA_SCHEMA_VERSION,
	decodePluginData,
	mergeActivity,
	normalizeActivity,
	normalizeSettings,
	projectSelectedRepositorySettings,
	parseActivityEntry,
	serializeActivityEntry,
	normalizeRepositoryRoot,
	updateSelectedRepositorySettings,
} from "./pluginData";
import type {
	ActivityEntry,
	ActivityLevel,
	DecodedPluginData,
	GitSyncSettings,
	RepositoryConfig,
	StoredPluginData,
} from "./pluginData";
import { AvailableBuildsModal, PluginUpdater, UpdateAvailableModal } from "./updater/PluginUpdater";
import { REMOTE_TOKEN_SECRET_ID } from "./remote";
import type { RemoteCredential } from "./remote";
import { RemoteOperationController, type RepositoryOperationContext } from "./RemoteOperationController";
import { repositoryMutationCoordinator } from "./RepositoryMutationCoordinator";
import { repositoryRootsOverlap } from "./repositoryPaths";
import { inspectLocalRepository } from "./repository";

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncSettings = DEFAULT_SETTINGS;
	repositories: RepositoryConfig[] = [];
	selectedRepositoryId = "";
	private activity: ActivityEntry[] = [];
	private persistedActivity: ActivityEntry[] = [];
	private activityLogEntryCount = 0;
	private activityWrite: Promise<void> = Promise.resolve();
	private updater: PluginUpdater | null = null;
	private dataSave: Promise<void> = Promise.resolve();
	private remoteOperations!: RemoteOperationController;
	private integrationStageQueue: Promise<void> = Promise.resolve();
	private settingsSaveTimer: number | null = null;
	private settingsSaveIndicator: HTMLElement | null = null;
	private settingsRefreshQueued = false;
	private remoteHistoryRefreshQueued = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.remoteOperations = new RemoteOperationController({
			app: this.app,
			getRepositoryOperationContext: () => this.getRepositoryOperationContext(),
			recordActivity: (message, level) => this.recordActivity(message, level),
			refreshViews: (reason, refreshChanges) => this.refreshViews(reason, refreshChanges),
			refreshRemoteHistoryViews: (reason) => this.refreshRemoteHistoryViews(reason),
			markChangesRefreshRequiredViews: (reason) => this.markChangesRefreshRequiredViews(reason),
		});

		this.registerView(
			VIEW_TYPE_GIT_SYNC,
			(leaf) => new GitSyncView(leaf, this),
		);
		this.addRibbonIcon("git-branch", "Open Git Sync", () => {
			void this.activateView();
		});
		this.addCommand({
			id: "open-git-sync",
			name: "Open Git Sync",
			callback: () => void this.activateView(),
		});
		this.addSettingTab(new GitSyncSettingTab(this.app, this));
		this.updater = new PluginUpdater(this.app, this.manifest.id);
		this.addCommand({
			id: "check-for-updates",
			name: "Check for plugin updates",
			callback: () => void this.checkForUpdates(true),
		});
		this.recordActivity("Git Sync started.");

		(this as unknown as { api?: unknown }).api = {
			integrationProvider: createIntegrationProvider(this),
		};

		if (this.settings.checkForUpdates && Date.now() - this.settings.lastUpdateCheck > 24 * 60 * 60 * 1000) {
			void this.checkForUpdates(false);
		}
	}

	onunload(): void {
		if (this.settingsSaveTimer !== null) {
			window.clearTimeout(this.settingsSaveTimer);
			this.settingsSaveTimer = null;
		}
		void this.persistData();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_GIT_SYNC);
	}

	async activateView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Git Sync could not open its sidebar.");
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_GIT_SYNC, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const decoded = decodePluginData(await this.loadData(), true);
		this.repositories = decoded.repositories;
		this.selectedRepositoryId = decoded.selectedRepositoryId;
		this.settings = projectSelectedRepositorySettings(
			normalizeSettings(decoded.settings),
			{ repositories: this.repositories, selectedRepositoryId: this.selectedRepositoryId },
		);
		const logActivity = await this.loadActivityLog();
		const legacyActivity = normalizeActivity(decoded.activity);
		this.activity = mergeActivity(logActivity, legacyActivity);
		if (legacyActivity.length > 0) await this.replaceActivityLog(this.activity);
		if (decoded.legacy || legacyActivity.length > 0) await this.persistData();
	}

	async saveSettings(): Promise<void> {
		this.setSettingsSaveStatus("Saving settings…", true);
		try {
			await this.persistData();
			this.setSettingsSaveStatus("Settings saved.", false);
		} catch (error) {
			this.setSettingsSaveStatus("Settings could not be saved.", false);
			throw error;
		}
	}

	async selectRepository(repositoryId: string): Promise<void> {
		if (repositoryId !== this.selectedRepositoryId && this.isRepositorySwitchBlocked()) throw new Error("Finish the active Git operation before switching repositories.");
		const selected = this.repositories.find((repository) => repository.id === repositoryId);
		if (!selected) throw new Error("That repository is no longer registered.");

		const currentRegistry = updateSelectedRepositorySettings(
			{ repositories: this.repositories, selectedRepositoryId: this.selectedRepositoryId },
			this.settings,
		);
		if (repositoryId === this.selectedRepositoryId) {
			this.repositories = currentRegistry.repositories;
			await this.saveSettings();
			return;
		}
		const previousRepositories = this.repositories;
		const previousSelection = this.selectedRepositoryId;
		const previousSettings = this.settings;
		this.repositories = currentRegistry.repositories;
		this.selectedRepositoryId = repositoryId;
		this.settings = projectSelectedRepositorySettings(this.settings, {
			repositories: this.repositories,
			selectedRepositoryId: repositoryId,
		});
		try {
			await this.saveSettings();
		} catch (error) {
			this.repositories = previousRepositories;
			this.selectedRepositoryId = previousSelection;
			this.settings = previousSettings;
			throw error;
		}
		this.recordActivity(`Selected repository: ${selected.name} (${selected.root}).`);
		this.refreshViews("repository-switch");
	}

	async registerRepository(
		rootValue: string,
		branchName: string,
		remoteUrl = "",
		remoteUsername = "git",
		credentialToken = "",
	): Promise<void> {
		if (this.isRepositorySwitchBlocked()) throw new Error("Finish the active Git operation before changing repositories.");
		const root = normalizeRepositoryRoot(rootValue);
		const currentRegistry = updateSelectedRepositorySettings(
			{ repositories: this.repositories, selectedRepositoryId: this.selectedRepositoryId },
			this.settings,
		);
		const existing = currentRegistry.repositories.find((repository) => repository.root === root);
		if (existing) {
			this.repositories = currentRegistry.repositories;
			await this.selectRepository(existing.id);
			return;
		}
		const overlap = currentRegistry.repositories.find((repository) => repositoryRootsOverlap(root, repository.root));
		if (overlap) {
			const overlapState = await inspectLocalRepository(this.app.vault.adapter, overlap.root);
			const overlapGitEntry = overlap.root === "." ? ".git" : `${overlap.root}/.git`;
			if (overlapState.kind === "ready" || await this.app.vault.adapter.exists(overlapGitEntry)) {
				throw new Error(`Repository "${root}" overlaps registered repository "${overlap.root}". Parent and child Git repositories cannot be used together.`);
			}
		}

		let id = "";
		do {
			const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
			id = `repo-${random}`;
		} while (currentRegistry.repositories.some((repository) => repository.id === id));
		const credentialRef = credentialToken.trim() ? `${REMOTE_TOKEN_SECRET_ID}:${id}` : null;
		if (credentialRef) this.app.secretStorage.setSecret(credentialRef, credentialToken.trim());
		const repository: RepositoryConfig = {
			id,
			name: root === "." ? "Vault root" : root.split("/").pop() || root,
			root,
			remoteUrl: remoteUrl.trim(),
			remoteUsername: remoteUsername.trim() || "git",
			branchName: branchName.trim() || "main",
			credentialRef,
		};

		const previousRepositories = this.repositories;
		const previousSelection = this.selectedRepositoryId;
		const previousSettings = this.settings;
		this.repositories = [...currentRegistry.repositories, repository];
		this.selectedRepositoryId = repository.id;
		this.settings = projectSelectedRepositorySettings(this.settings, {
			repositories: this.repositories,
			selectedRepositoryId: repository.id,
		});
		try {
			await this.saveSettings();
		} catch (error) {
			this.repositories = previousRepositories;
			this.selectedRepositoryId = previousSelection;
			this.settings = previousSettings;
			throw error;
		}
		this.recordActivity(`Added repository: ${repository.name} (${repository.root}).`);
		this.refreshViews("repository-added");
	}

	async setSelectedRepositoryBranch(branchName: string, repositoryRoot: string): Promise<void> {
		if (normalizeRepositoryRoot(this.settings.repositoryPath) !== normalizeRepositoryRoot(repositoryRoot)) {
			throw new Error("The selected repository changed before the branch setting could be saved.");
		}
		const previous = this.settings;
		this.settings = { ...this.settings, branchName: branchName.trim() };
		try {
			await this.saveSettings();
		} catch (error) {
			this.settings = previous;
			throw error;
		}
	}

	isRepositorySwitchBlocked(): boolean {
		if (this.remoteOperations?.isBusy()) return true;
		if (repositoryMutationCoordinator.isBusy(this.settings.repositoryPath)) return true;
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC).some((leaf) =>
			leaf.view instanceof GitSyncView && leaf.view.hasPendingRepositoryMutation());
	}

	setSettingsSaveIndicator(element: HTMLElement): void {
		this.settingsSaveIndicator = element;
	}

	private setSettingsSaveStatus(message: string, saving: boolean): void {
		if (!this.settingsSaveIndicator?.isConnected) return;
		this.settingsSaveIndicator.setText(message);
		this.settingsSaveIndicator.toggleClass("is-saving", saving);
		this.settingsSaveIndicator.setAttribute("aria-busy", String(saving));
	}

	private persistData(): Promise<void> {
		const data = this.createStoredData();
		this.dataSave = this.dataSave
			.catch(() => undefined)
			.then(() => this.saveData(data));
		return this.dataSave;
	}

	private createStoredData(): StoredPluginData {
		const registry = updateSelectedRepositorySettings(
			{ repositories: this.repositories, selectedRepositoryId: this.selectedRepositoryId },
			this.settings,
		);
		this.repositories = registry.repositories;
		return {
			format: PLUGIN_DATA_FORMAT,
			schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
			settings: { ...this.settings },
			repositories: registry.repositories,
			selectedRepositoryId: registry.selectedRepositoryId,
		};
	}

	createExportData(includeActivity = this.settings.includeActivityInExports): string {
		return JSON.stringify({
			...this.createStoredData(),
			activity: includeActivity ? this.activity.slice(0, MAX_ACTIVITY_ENTRIES) : [],
			exportedAt: new Date().toISOString(),
			activityIncluded: includeActivity,
		}, null, 2);
	}

	async exportDataToVault(): Promise<string> {
		const path = `git-sync-data-${formatFileTimestamp(new Date())}.json`;
		await this.app.vault.adapter.write(path, this.createExportData());
		this.recordActivity(`Plugin data exported to ${path}.`);
		return path;
	}

	async importData(json: string): Promise<void> {
		let decoded: DecodedPluginData;
		try {
			decoded = decodePluginData(JSON.parse(json), true, true);
		} catch (error) {
			throw error instanceof Error ? error : new Error("The selected file is not valid Git Sync data.");
		}

		if (!window.confirm("Import Git Sync settings and activity? Existing plugin data will be replaced.")) return;
		this.repositories = decoded.repositories;
		this.selectedRepositoryId = decoded.selectedRepositoryId;
		this.settings = projectSelectedRepositorySettings(
			normalizeSettings(decoded.settings),
			{ repositories: this.repositories, selectedRepositoryId: this.selectedRepositoryId },
		);
		this.activity = normalizeActivity(decoded.activity);
		await this.replaceActivityLog(this.activity);
		await this.persistData();
		this.refreshViews();
		this.recordActivity("Plugin data imported.");
		new Notice("Plugin data imported. Remote credentials were left unchanged.");
	}

	scheduleSettingsSave(refreshRepository = false, refreshRemoteHistory = false): void {
		this.settingsRefreshQueued ||= refreshRepository;
		this.remoteHistoryRefreshQueued ||= refreshRemoteHistory;
		this.setSettingsSaveStatus("Saving settings…", true);
		if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
		this.settingsSaveTimer = window.setTimeout(() => {
			this.settingsSaveTimer = null;
			const refreshRepositoryAfterSave = this.settingsRefreshQueued;
			const refreshRemoteHistoryAfterSave = this.remoteHistoryRefreshQueued;
			this.settingsRefreshQueued = false;
			this.remoteHistoryRefreshQueued = false;
			void this.saveSettings().then(() => {
				if (refreshRepositoryAfterSave) this.refreshViews("repository-setting-change");
				else if (refreshRemoteHistoryAfterSave) this.refreshRemoteHistoryViews("branch-setting-change");
			}).catch((error) => {
				const detail = error instanceof Error ? error.message : "Unable to save settings.";
				this.recordActivity(`Settings save failed: ${detail}`, "ERROR");
			});
		}, 250);
	}

	recordActivity(message: string, level: ActivityLevel = "INFO"): void {
		const entry = { message, timestamp: Date.now(), level };
		this.activity.unshift(entry);
		this.activity = this.activity.slice(0, MAX_ACTIVITY_ENTRIES);
		void this.enqueueActivityWrite(async () => {
			await this.app.vault.adapter.append(this.activityLogPath(), `${serializeActivityEntry(entry)}\n`);
			this.persistedActivity.unshift(entry);
			this.persistedActivity = this.persistedActivity.slice(0, MAX_ACTIVITY_ENTRIES);
			this.activityLogEntryCount += 1;
			if (this.activityLogEntryCount > ACTIVITY_LOG_COMPACTION_THRESHOLD) {
				await this.writeActivityLog(this.persistedActivity);
				this.activityLogEntryCount = this.persistedActivity.length;
			}
		}).catch(() => undefined);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) view.refreshActivity();
		}
	}

	getActivity(): readonly ActivityEntry[] {
		return this.activity;
	}

	private activityLogPath(): string {
		const pluginDirectory = this.manifest.dir?.replace(/\/+$/, "")
			|| `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		return `${pluginDirectory}/activity.log`;
	}

	private async loadActivityLog(): Promise<ActivityEntry[]> {
		const path = this.activityLogPath();
		if (!(await this.app.vault.adapter.exists(path))) {
			this.persistedActivity = [];
			this.activityLogEntryCount = 0;
			return [];
		}

		const raw = await this.app.vault.adapter.read(path);
		const entries = raw.split(/\r?\n/)
			.map(parseActivityEntry)
			.filter((entry): entry is ActivityEntry => entry !== null);
		this.activityLogEntryCount = entries.length;
		this.persistedActivity = entries.slice(-MAX_ACTIVITY_ENTRIES).reverse();
		return this.persistedActivity.slice();
	}

	private enqueueActivityWrite(operation: () => Promise<void>): Promise<void> {
		this.activityWrite = this.activityWrite.catch(() => undefined).then(operation);
		return this.activityWrite;
	}

	private async replaceActivityLog(entries: ActivityEntry[]): Promise<void> {
		await this.enqueueActivityWrite(async () => {
			const recent = entries.slice(0, MAX_ACTIVITY_ENTRIES);
			await this.writeActivityLog(recent);
			this.persistedActivity = recent.slice();
			this.activityLogEntryCount = recent.length;
		});
	}

	private async writeActivityLog(entries: readonly ActivityEntry[]): Promise<void> {
		const lines = entries.slice().reverse().map(serializeActivityEntry);
		await this.app.vault.adapter.write(this.activityLogPath(), lines.length > 0 ? `${lines.join("\n")}\n` : "");
	}

	getRemoteToken(): string | null {
		return this.getRemoteTokenForRepository(this.selectedRepositoryId);
	}

	getRemoteTokenForRepository(repositoryId: string): string | null {
		const selected = this.repositories.find((repository) => repository.id === repositoryId);
		return selected?.credentialRef ? this.app.secretStorage.getSecret(selected.credentialRef) : null;
	}

	getRemoteCredential(): RemoteCredential | null {
		return this.getRemoteCredentialForRepository(this.selectedRepositoryId, this.settings);
	}

	getRemoteCredentialForRepository(repositoryId: string, settings?: GitSyncSettings): RemoteCredential | null {
		const token = this.getRemoteTokenForRepository(repositoryId);
		if (!token) return null;
		return {
			username: settings?.remoteUsername.trim() || "git",
			token,
		};
	}

	getRepositoryOperationContext(repositoryId = this.selectedRepositoryId): {
		repositoryId: string;
		settings: GitSyncSettings;
		credential: RemoteCredential | null;
	} {
		const settings = projectSelectedRepositorySettings(this.settings, {
			repositories: this.repositories,
			selectedRepositoryId: repositoryId,
		});
		return {
			repositoryId,
			settings,
			credential: this.getRemoteCredentialForRepository(repositoryId, settings),
		};
	}

	saveRemoteToken(value: string): void {
		const token = value.trim();
		const selectedIndex = this.repositories.findIndex((repository) => repository.id === this.selectedRepositoryId);
		if (selectedIndex < 0) {
			this.app.secretStorage.setSecret(REMOTE_TOKEN_SECRET_ID, token);
			return;
		}
		const selected = this.repositories[selectedIndex];
		const credentialRef = selected.credentialRef || `${REMOTE_TOKEN_SECRET_ID}:${selected.id}`;
		this.app.secretStorage.setSecret(credentialRef, token);
		if (selected.credentialRef !== credentialRef) {
			this.repositories = this.repositories.slice();
			this.repositories[selectedIndex] = { ...selected, credentialRef };
			void this.persistData().catch((error) => {
				const detail = error instanceof Error ? error.message : "Unable to save repository credentials.";
				this.recordActivity(`Credential reference save failed: ${detail}`, "ERROR");
			});
		}
	}

	async checkRemoteConnection(): Promise<void> {
		return this.remoteOperations.checkConnection();
	}

	async fetchRemote(): Promise<void> {
		return this.remoteOperations.fetch();
	}

	async pullRemote(): Promise<void> {
		return this.remoteOperations.pull();
	}

	forcePullRemote(): void {
		this.remoteOperations.forcePull();
	}

	async pushRemote(): Promise<void> {
		return this.remoteOperations.push();
	}

	forcePushRemote(): void {
		this.remoteOperations.forcePush();
	}

	async cloneRemote(context?: RepositoryOperationContext): Promise<boolean> {
		return this.remoteOperations.clone(context);
	}

	async checkForUpdates(manual: boolean): Promise<void> {
		if (!this.updater) return;
		const result = await this.updater.checkForUpdate({
			currentVersion: this.manifest.version,
			currentCommit: GIT_COMMIT_HASH,
			currentBranch: GIT_BRANCH,
			channel: this.settings.updateChannel,
		});
		this.settings.lastUpdateCheck = Date.now();
		await this.persistData();

		if (result.kind === "available") {
			this.recordActivity(`Update available: ${result.release.tag_name}.`);
			if (this.settings.autoUpdate && !result.release.prerelease) {
				try {
					const tempDir = await this.updater.downloadAndValidate(result.release);
					await this.updater.installUpdate(tempDir);
					this.recordActivity(`Installed stable update ${result.release.tag_name}.`);
					new Notice("Stable update installed. Reload Obsidian to apply it.");
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unable to install the update.";
					this.recordActivity(`Automatic update failed: ${message}`, "ERROR");
					if (manual) new Notice(`Update failed: ${message}`);
				}
				return;
			}
			new UpdateAvailableModal(this.app, result, async () => {
				const tempDir = await this.updater!.downloadAndValidate(result.release);
				await this.updater!.installUpdate(tempDir);
				this.recordActivity(`Installed update ${result.release.tag_name}.`);
			}).open();
			return;
		}

		if (result.kind === "up-to-date") {
			this.recordActivity("Update check: current build is up to date.");
			if (manual) new Notice(`Git Sync is up to date (${result.currentVersion}).`);
			return;
		}

		this.recordActivity(`Update check: ${result.message}`);
		if (manual) new Notice(result.message);
	}

	showAvailableBuilds(): void {
		if (!this.updater) return;
		new AvailableBuildsModal(this.app, this.updater, async (build) => {
			const tempDir = await this.updater!.downloadAndValidate(build.release);
			await this.updater!.installUpdate(tempDir);
			this.recordActivity(`Installed development build ${build.release.tag_name}.`);
		}).open();
	}

	refreshViews(reason = "view-refresh", refreshChanges = true): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) {
				void view.refreshRepositoryState(reason, refreshChanges);
			}
		}
	}

	refreshBackgroundRefreshSetting(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) view.backgroundRefreshSettingChanged();
		}
	}

	refreshIntegrationStage(paths: string[], repositoryPath?: string): Promise<void> {
		this.integrationStageQueue = this.integrationStageQueue
			.catch(() => undefined)
			.then(async () => {
				const views = this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)
					.map((leaf) => leaf.view)
					.filter((view): view is GitSyncView => view instanceof GitSyncView);
					await Promise.all(views.map((view) => view.refreshIntegrationStage(paths, repositoryPath)));
			});
		return this.integrationStageQueue;
	}

	refreshRemoteHistoryViews(reason = "remote-history-refresh"): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) void view.refreshRemoteHistory(reason);
		}
	}

	markChangesRefreshRequiredViews(reason: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) view.markChangesRefreshRequired(reason);
		}
	}
}


function formatFileTimestamp(date: Date): string {
	return date.toISOString().replace(/[:.]/g, "-");
}
