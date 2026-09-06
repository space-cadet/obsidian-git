import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	WorkspaceLeaf,
} from "obsidian";
import { GIT_BRANCH, GIT_COMMIT_HASH } from "./build-info";
import {
	ChangedFile,
	commitChanges,
	inspectLocalRepository,
	LocalCommit,
	readCommits,
	readRemoteCommits,
	readChanges,
	RepositoryState,
	stageFile,
	unstageFile,
} from "./repository";
import { AvailableBuildsModal, PluginUpdater, UpdateAvailableModal } from "./updater/PluginUpdater";
import {
	cloneRepository,
	fetchRepository,
	pushRepository,
	pullRepository,
	REMOTE_TOKEN_SECRET_ID,
	RemoteCredential,
	testRemoteConnection,
} from "./remote";

const VIEW_TYPE_GIT_SYNC = "git-sync-sidebar";
const PLUGIN_DATA_FORMAT = "obsidian-git-sync";
const PLUGIN_DATA_SCHEMA_VERSION = 1 as const;
const MAX_ACTIVITY_ENTRIES = 50;

interface GitSyncSettings {
	repositoryPath: string;
	remoteUrl: string;
	remoteUsername: string;
	branchName: string;
	authorName: string;
	authorEmail: string;
	checkForUpdates: boolean;
	updateChannel: "stable" | "dev";
	autoUpdate: boolean;
	lastUpdateCheck: number;
	includeActivityInExports: boolean;
}

interface ActivityEntry {
	message: string;
	timestamp: number;
	level: ActivityLevel;
}

type ActivityLevel = "DEBUG" | "INFO" | "METRIC" | "ERROR";
type CommitSource = "local" | "remote";

interface StoredPluginData {
	format: typeof PLUGIN_DATA_FORMAT;
	schemaVersion: typeof PLUGIN_DATA_SCHEMA_VERSION;
	settings: GitSyncSettings;
	activity: ActivityEntry[];
}

interface DecodedPluginData {
	settings: Partial<GitSyncSettings>;
	activity: unknown;
	legacy: boolean;
}

const DEFAULT_SETTINGS: GitSyncSettings = {
	repositoryPath: ".",
	remoteUrl: "",
	remoteUsername: "git",
	branchName: "main",
	authorName: "",
	authorEmail: "",
	checkForUpdates: true,
	updateChannel: "dev",
	autoUpdate: false,
	lastUpdateCheck: 0,
	includeActivityInExports: false,
};

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncSettings = DEFAULT_SETTINGS;
	private activity: ActivityEntry[] = [];
	private updater: PluginUpdater | null = null;
	private dataSave: Promise<void> = Promise.resolve();
	private remoteOperationQueue: Promise<void> = Promise.resolve();
	private settingsSaveTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

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
		this.settings = normalizeSettings(decoded.settings);
		this.activity = normalizeActivity(decoded.activity);
		if (decoded.legacy) void this.persistData();
	}

	async saveSettings(): Promise<void> {
		await this.persistData();
		this.refreshViews();
	}

	private persistData(): Promise<void> {
		const data = this.createStoredData();
		this.dataSave = this.dataSave
			.catch(() => undefined)
			.then(() => this.saveData(data));
		return this.dataSave;
	}

	private createStoredData(): StoredPluginData {
		return {
			format: PLUGIN_DATA_FORMAT,
			schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
			settings: { ...this.settings },
			activity: this.activity.slice(0, MAX_ACTIVITY_ENTRIES),
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
		this.settings = normalizeSettings(decoded.settings);
		this.activity = normalizeActivity(decoded.activity);
		await this.persistData();
		this.refreshViews();
		this.recordActivity("Plugin data imported.");
		new Notice("Plugin data imported. Remote credentials were left unchanged.");
	}

	scheduleSettingsSave(): void {
		if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
		this.settingsSaveTimer = window.setTimeout(() => {
			this.settingsSaveTimer = null;
			void this.saveSettings();
		}, 250);
	}

	recordActivity(message: string, level: ActivityLevel = "INFO"): void {
		this.activity.unshift({ message, timestamp: Date.now(), level });
		this.activity = this.activity.slice(0, 50);
		void this.persistData();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) view.refreshActivity();
		}
	}

	getActivity(): readonly ActivityEntry[] {
		return this.activity;
	}

	getRemoteToken(): string | null {
		return this.app.secretStorage.getSecret(REMOTE_TOKEN_SECRET_ID);
	}

	getRemoteCredential(): RemoteCredential | null {
		const token = this.getRemoteToken();
		if (!token) return null;
		return {
			username: this.settings.remoteUsername.trim() || "git",
			token,
		};
	}

	saveRemoteToken(value: string): void {
		const token = value.trim();
		this.app.secretStorage.setSecret(REMOTE_TOKEN_SECRET_ID, token);
	}

	async checkRemoteConnection(): Promise<void> {
		try {
			const info = await testRemoteConnection(this.settings.remoteUrl, this.getRemoteCredential());
			const branch = info.defaultBranch ? ` Default branch: ${info.defaultBranch}.` : "";
			this.recordActivity(`Remote connection succeeded: ${info.remoteUrl}.${branch}`);
			new Notice(`Remote connection succeeded.${branch}`);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Remote connection failed.";
			this.recordActivity(`Remote connection failed: ${detail}`, "ERROR");
			new Notice(detail);
		}
	}

	async fetchRemote(): Promise<void> {
		return this.runRemoteOperation("Fetch", () => fetchRepository(this.remoteRepositoryOptions()));
	}

	async pullRemote(): Promise<void> {
		return this.runRemoteOperation("Pull", () => pullRepository(this.remoteRepositoryOptions()));
	}

	async pushRemote(): Promise<void> {
		return this.runRemoteOperation("Push", () => pushRepository(this.remoteRepositoryOptions()));
	}

	async cloneRemote(): Promise<void> {
		return this.runRemoteOperation("Clone", () => cloneRepository(this.remoteRepositoryOptions()));
	}

	private remoteRepositoryOptions() {
		return {
			adapter: this.app.vault.adapter,
			repositoryPath: this.settings.repositoryPath,
			remoteUrl: this.settings.remoteUrl,
			branchName: this.settings.branchName,
			credential: this.getRemoteCredential(),
			onDiagnostic: (message: string) => this.recordActivity(message, "DEBUG"),
		};
	}

	private runRemoteOperation(name: string, operation: () => Promise<void>): Promise<void> {
		this.recordActivity(`${name} requested.`);
		const next = this.remoteOperationQueue
			.catch(() => undefined)
			.then(async () => {
				this.recordActivity(`${name} started for ${this.settings.branchName}.`);
				new Notice(`${name} in progress…`);
				try {
					await operation();
					this.recordActivity(`${name} completed for ${this.settings.branchName}.`);
					this.refreshViews();
					new Notice(`${name} completed.`);
				} catch (error) {
					const detail = describeOperationError(error, `${name} failed.`);
					this.recordActivity(`${name} failed: ${detail}`, "ERROR");
					new Notice(`${name} failed: ${detail}`);
				}
			});
		this.remoteOperationQueue = next;
		return next;
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

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SYNC)) {
			const view = leaf.view;
			if (view instanceof GitSyncView) {
				void view.refreshRepositoryState();
			}
		}
	}
}

class GitSyncView extends ItemView {
	private readonly plugin: GitSyncPlugin;
	private activeTab = "Changes";
	private repositoryState: RepositoryState | null = null;
	private changes: ChangedFile[] | null = null;
	private commits: LocalCommit[] | null = null;
	private remoteCommits: LocalCommit[] | null = null;
	private remoteHistoryAvailable = false;
	private commitsError: string | null = null;
	private remoteCommitsError: string | null = null;
	private commitSource: CommitSource = "local";
	private selectedCommitOid: string | null = null;
	private readonly selectedPaths = new Set<string>();
	private readonly collapsedSections = new Set<"staged" | "uncommitted">();
	private changesError: string | null = null;
	private committing = false;
	private commitMessage = "";
	private changesContentEl: HTMLElement | null = null;
	private changesActionBarEl: HTMLElement | null = null;
	private refreshGeneration = 0;
	private lastRepositoryActivity = "";

	constructor(leaf: WorkspaceLeaf, plugin: GitSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_GIT_SYNC;
	}

	getDisplayText(): string {
		return "Git Sync";
	}

	getIcon(): string {
		return "git-branch";
	}

	onOpen(): Promise<void> {
		this.render();
		void this.refreshRepositoryState();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	refreshActivity(): void {
		if (this.activeTab === "Log") this.render();
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("git-sync-sidebar");

		const topbar = root.createDiv({ cls: "git-sync-topbar" });
		const tabs = topbar.createDiv({ cls: "git-sync-tabs", attr: { role: "tablist" } });
		for (const tabName of ["Changes", "Commits", "Log"]) {
			const tab = tabs.createEl("button", {
				text: tabName,
				cls: tabName === this.activeTab ? "git-sync-tab is-active" : "git-sync-tab",
				attr: { type: "button", role: "tab", "aria-selected": String(tabName === this.activeTab) },
			});
			tab.addEventListener("click", () => {
				this.activeTab = tabName;
				this.render();
			});
		}

		const settingsButton = topbar.createEl("button", {
			cls: "git-sync-settings-button",
			attr: { type: "button", "aria-label": "Open Git Sync settings", title: "Open Settings" },
		});
		setIcon(settingsButton, "settings");
		settingsButton.addEventListener("click", () => this.openSettings());
		const repository = this.plugin.settings.repositoryPath.trim();
		this.renderRepositoryContext(root, repository);

		const content = root.createDiv({ cls: "git-sync-content" });
		this.changesContentEl = null;
		this.changesActionBarEl = null;
		if (this.activeTab === "Log") {
			this.renderActivity(content);
			return;
		}

		if (!repository) {
			this.renderSettingsPrompt(content, "Set up your repository");
			return;
		}

		if (!this.repositoryState || this.repositoryState.kind === "checking") {
			content.createDiv({ cls: "git-sync-state-title", text: "Checking repository" });
			content.createEl("p", {
				text: "Reading local repository information…",
				cls: "git-sync-state-description",
			});
			return;
		}

		if (this.repositoryState.kind === "missing") {
			content.createDiv({ cls: "git-sync-state-title", text: "No Git repository found" });
			content.createEl("p", {
				text: `No .git directory was found at ${this.repositoryState.repositoryPath}.`,
				cls: "git-sync-state-description",
			});
			this.addRefreshButton(content);
			return;
		}

		if (this.repositoryState.kind === "error") {
			content.createDiv({ cls: "git-sync-state-title", text: "Could not read repository" });
			content.createEl("p", {
				text: this.repositoryState.message,
				cls: "git-sync-state-description",
			});
			this.addRefreshButton(content);
			return;
		}

		if (this.activeTab === "Changes") {
			this.changesContentEl = content;
			this.renderChanges(content);
			this.changesActionBarEl = this.renderChangesActionBar(root);
			return;
		}

		if (this.activeTab === "Commits") {
			this.renderCommits(content);
			return;
		}

		content.createDiv({ cls: "git-sync-state-title", text: this.activeTab });
		content.createEl("p", { text: `Local repository ready on ${this.repositoryState.branch}.`, cls: "git-sync-state-description" });
		this.addRefreshButton(content);
	}

	private renderRepositoryContext(root: HTMLElement, repository: string): void {
		const context = root.createDiv({ cls: "git-sync-repository-context" });
		const branch = context.createDiv({ cls: "git-sync-branch-context" });
		const branchIcon = branch.createSpan({ cls: "git-sync-branch-icon" });
		setIcon(branchIcon, "git-branch");
		const branchName = this.repositoryState?.kind === "ready"
			? this.repositoryState.branch
			: this.plugin.settings.branchName.trim() || "No branch";
		branch.createSpan({ cls: "git-sync-branch-name", text: branchName });

		const refreshButton = branch.createEl("button", {
			cls: "git-sync-context-action",
			attr: { type: "button", "aria-label": "Refresh repository", title: "Refresh repository" },
		});
		setIcon(refreshButton, "refresh-cw");
		refreshButton.disabled = !repository;
		refreshButton.addEventListener("click", () => void this.refreshRepositoryState());

		const comparisonState = this.getComparisonState(repository);
		const comparison = context.createDiv({ cls: "git-sync-comparison-status" });
		const comparisonIcon = comparison.createSpan({ cls: "git-sync-comparison-icon" });
		comparisonIcon.setAttribute("data-comparison-state", comparisonState.kind);
		setIcon(comparisonIcon, comparisonState.icon);
		comparison.createDiv({
			cls: "git-sync-comparison-text",
			text: comparisonState.label,
		});
	}

	private getComparisonState(repository: string): {
		kind: "unconfigured" | "checking" | "unavailable" | "up-to-date" | "local-ahead" | "remote-ahead" | "diverged";
		icon: string;
		label: string;
	} {
		if (!repository) return { kind: "unconfigured", icon: "alert-circle", label: "Repository not configured" };
		if (this.repositoryState?.kind !== "ready" || !this.commits || this.remoteCommits === null) {
			return { kind: "checking", icon: "loader", label: "Checking repository comparison" };
		}
		if (!this.remoteHistoryAvailable) {
			return { kind: "unavailable", icon: "alert-circle", label: "Remote comparison unavailable" };
		}

		const localHead = this.commits[0]?.oid;
		const remoteHead = this.remoteCommits[0]?.oid;
		if ((!localHead && !remoteHead) || localHead === remoteHead) {
			return { kind: "up-to-date", icon: "check-circle", label: "Up to date" };
		}
		if (!localHead || !remoteHead) {
			return localHead
				? { kind: "local-ahead", icon: "arrow-up", label: "Local is ahead" }
				: { kind: "remote-ahead", icon: "arrow-down", label: "Remote is ahead" };
		}
		if (this.remoteCommits.some((commit) => commit.oid === localHead)) {
			return { kind: "remote-ahead", icon: "arrow-down", label: "Remote is ahead" };
		}
		if (this.commits.some((commit) => commit.oid === remoteHead)) {
			return { kind: "local-ahead", icon: "arrow-up", label: "Local is ahead" };
		}
		return { kind: "diverged", icon: "git-compare", label: "Branches have diverged" };
	}

	async refreshRepositoryState(): Promise<void> {
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (!repositoryPath) {
			this.repositoryState = null;
			this.render();
			return;
		}

		const generation = ++this.refreshGeneration;
		this.repositoryState = { kind: "checking", repositoryPath };
		this.render();
		const state = await inspectLocalRepository(this.app.vault.adapter, repositoryPath);
		if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
		this.repositoryState = state;
		if (state.kind === "ready") {
			try {
				this.changes = await readChanges(this.app.vault.adapter, repositoryPath);
				const availablePaths = new Set(this.changes.map((change) => change.path));
				for (const selectedPath of this.selectedPaths) {
					if (!availablePaths.has(selectedPath)) this.selectedPaths.delete(selectedPath);
				}
				this.changesError = null;
			} catch (error) {
				this.changes = null;
				this.changesError = error instanceof Error ? error.message : "Unable to read local changes.";
			}
			try {
				this.commits = await readCommits(this.app.vault.adapter, repositoryPath);
				this.commitsError = null;
				if (this.selectedCommitOid && !this.commits.some((commit) => commit.oid === this.selectedCommitOid)) {
					this.selectedCommitOid = null;
				}
			} catch (error) {
				this.commits = null;
				this.commitsError = error instanceof Error ? error.message : "Unable to read local commits.";
			}
			try {
				const remoteHistory = await readRemoteCommits(
					this.app.vault.adapter,
					repositoryPath,
					this.plugin.settings.branchName,
				);
				this.remoteCommits = remoteHistory.commits;
				this.remoteHistoryAvailable = remoteHistory.available;
				this.remoteCommitsError = null;
			} catch (error) {
				this.remoteCommits = null;
				this.remoteHistoryAvailable = false;
				this.remoteCommitsError = error instanceof Error ? error.message : "Unable to read remote commits.";
			}
		} else {
			this.changes = null;
			this.changesError = null;
			this.commits = null;
			this.remoteCommits = null;
			this.remoteHistoryAvailable = false;
			this.commitsError = null;
			this.remoteCommitsError = null;
			this.selectedCommitOid = null;
		}
		if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
		this.recordRepositoryActivity(state);
		this.render();
	}

	private renderChanges(content: HTMLElement): void {
		if (this.changesError) {
			content.createEl("p", { text: this.changesError, cls: "git-sync-state-description" });
			return;
		}
		if (!this.changes) {
			content.createEl("p", { text: "Reading local changes…", cls: "git-sync-state-description" });
			return;
		}
		const staged = this.changes.filter((change) => change.staged);
		const uncommitted = this.changes.filter((change) => !change.staged);
		this.renderChangeSection(content, "staged", "STAGED", staged, "Unstage selected");
		this.renderChangeSection(content, "uncommitted", "UNCOMMITTED CHANGES", uncommitted, "Stage selected");

		const stagedCount = staged.length;
		const commit = content.createDiv({ cls: "git-sync-commit" });
		commit.createDiv({ text: "Commit staged changes", cls: "git-sync-commit-title" });
		commit.createDiv({ text: `${stagedCount} file${stagedCount === 1 ? "" : "s"} staged`, cls: "git-sync-commit-meta" });
		const message = commit.createEl("textarea", {
			attr: { placeholder: "Commit message", "aria-label": "Commit message", rows: "3" },
		});
		message.value = this.commitMessage;
		message.addEventListener("input", () => {
			this.commitMessage = message.value;
		});
		const commitActions = commit.createDiv({ cls: "git-sync-commit-actions" });
		const commitButton = commitActions.createEl("button", { text: "Commit", cls: "mod-cta", attr: { type: "button" } });
		commitButton.disabled = stagedCount === 0 || this.committing;
		commitButton.addEventListener("click", () => void this.commit(message.value));
	}

	private renderCommits(content: HTMLElement): void {
		const commits = this.commitSource === "local" ? this.commits : this.remoteCommits;
		const sourceLabel = this.commitSource === "local" ? "local" : "remote";
		const header = content.createDiv({ cls: "git-sync-commits-header" });
		header.createDiv({ cls: "git-sync-state-title", text: "Commits" });
		header.createDiv({
			cls: "git-sync-commits-count",
			text: commits ? `${commits.length} ${sourceLabel} commit${commits.length === 1 ? "" : "s"}` : `${sourceLabel} history`,
		});

		const sourceToggle = content.createDiv({ cls: "git-sync-source-toggle", attr: { role: "tablist" } });
		for (const source of ["local", "remote"] as const) {
			const button = sourceToggle.createEl("button", {
				text: source === "local" ? "Local" : "Remote",
				cls: source === this.commitSource ? "is-active" : "",
				attr: {
					type: "button",
					role: "tab",
					"aria-selected": String(source === this.commitSource),
				},
			});
			button.addEventListener("click", () => {
				this.commitSource = source;
				this.selectedCommitOid = null;
				this.render();
			});
		}

		if (this.commitSource === "remote" && this.remoteCommitsError) {
			content.createEl("p", { text: this.remoteCommitsError, cls: "git-sync-state-description" });
			this.addRefreshButton(content);
			return;
		}
		if (this.commitSource === "remote" && !this.remoteCommits) {
			content.createEl("p", { text: "Reading remote commit history…", cls: "git-sync-state-description" });
			return;
		}
		if (this.commitSource === "remote" && !this.remoteHistoryAvailable) {
			const unavailable = content.createDiv({ cls: "git-sync-history-unavailable" });
			const icon = unavailable.createSpan({ cls: "git-sync-history-unavailable-icon" });
			setIcon(icon, "cloud-off");
			unavailable.createDiv({ cls: "git-sync-state-title", text: "No fetched remote history" });
			unavailable.createEl("p", {
				text: `Fetch origin/${this.plugin.settings.branchName} to load the remote commit history here.`,
				cls: "git-sync-state-description",
			});
			return;
		}

		if (this.commitsError) {
			content.createEl("p", { text: this.commitsError, cls: "git-sync-state-description" });
			this.addRefreshButton(content);
			return;
		}
		if (!this.commits) {
			content.createEl("p", { text: "Reading local commit history…", cls: "git-sync-state-description" });
			return;
		}
		if (commits!.length === 0) {
			content.createDiv({
				cls: "git-sync-history-empty",
				text: this.commitSource === "local" ? "No local commits yet." : "No commits on the fetched remote branch.",
			});
			return;
		}

		this.renderCommitList(content, commits!, this.commitSource === "local" ? "LOCAL" : "ORIGIN");
	}

	private renderCommitList(content: HTMLElement, commits: LocalCommit[], badge: "LOCAL" | "ORIGIN"): void {
		const list = content.createEl("ol", { cls: "git-sync-commit-list" });
		for (const commit of commits) {
			const item = list.createEl("li", { cls: "git-sync-commit-item" });
			const selected = this.selectedCommitOid === commit.oid;
			const button = item.createEl("button", {
				cls: selected ? "git-sync-commit-row is-selected" : "git-sync-commit-row",
				attr: {
					type: "button",
					"aria-expanded": String(selected),
					"aria-label": `${selected ? "Hide" : "Show"} details for ${commitTitle(commit.message)}`,
				},
			});
			const marker = button.createSpan({ cls: "git-sync-commit-marker" });
			marker.setAttribute("aria-hidden", "true");
			const summary = button.createDiv({ cls: "git-sync-commit-summary" });
			const title = summary.createDiv({ cls: "git-sync-commit-message", text: commitTitle(commit.message) });
			title.setAttribute("title", commit.message);
			const meta = summary.createDiv({ cls: "git-sync-commit-meta" });
			meta.createSpan({ cls: "git-sync-commit-oid", text: commit.oid.slice(0, 7) });
			meta.createSpan({ text: commit.author.name || "Unknown author" });
			meta.createSpan({ cls: badge === "ORIGIN" ? "git-sync-commit-origin-badge" : "git-sync-commit-local-badge", text: badge });
			const time = button.createSpan({ cls: "git-sync-commit-time", text: formatRelativeCommitTime(commit.author.timestamp) });
			time.setAttribute("title", formatCommitTimestamp(commit.author.timestamp));
			const chevron = button.createSpan({ cls: "git-sync-commit-chevron" });
			setIcon(chevron, selected ? "chevron-down" : "chevron-right");
			button.addEventListener("click", () => {
				this.selectedCommitOid = selected ? null : commit.oid;
				this.render();
			});

			if (selected) this.renderCommitDetails(item, commit);
		}
	}

	private renderCommitDetails(item: HTMLElement, commit: LocalCommit): void {
		const details = item.createDiv({ cls: "git-sync-commit-details" });
		details.createDiv({ cls: "git-sync-commit-detail-message", text: commit.message.trim() });
		const author = details.createDiv({ cls: "git-sync-commit-detail-meta" });
		author.createSpan({ text: `${commit.author.name || "Unknown author"} <${commit.author.email}>` });
		author.createSpan({ text: formatCommitTimestamp(commit.author.timestamp) });
		details.createDiv({ cls: "git-sync-commit-detail-hash", text: commit.oid });

		const filesTitle = details.createDiv({ cls: "git-sync-commit-files-title", text: `Changed files (${commit.changes.length})` });
		if (commit.changes.length === 0) {
			details.createDiv({ cls: "git-sync-commit-files-empty", text: "No changed files recorded." });
			return;
		}
		const files = details.createEl("ul", { cls: "git-sync-commit-files" });
		for (const file of commit.changes) {
			const row = files.createEl("li");
			const status = row.createSpan({ cls: "git-sync-commit-file-status", text: commitFileCode(file.status) });
			status.setAttribute("data-commit-file-status", file.status);
			row.createSpan({ cls: "git-sync-commit-file-path", text: file.path });
		}
		filesTitle.setAttribute("aria-hidden", "true");
	}

	private renderChangeSection(
		content: HTMLElement,
		section: "staged" | "uncommitted",
		title: string,
		changes: ChangedFile[],
		bulkAction: string,
	): void {
		const sectionEl = content.createDiv({ cls: "git-sync-change-section" });
		const header = sectionEl.createDiv({ cls: "git-sync-change-section-header" });
		header.createDiv({ cls: "git-sync-section-title", text: title });
		header.createDiv({ cls: "git-sync-section-count", text: String(changes.length) });
		const collapse = header.createEl("button", {
			cls: "git-sync-icon-button",
			attr: { type: "button", "aria-label": `${this.collapsedSections.has(section) ? "Expand" : "Collapse"} ${title}` },
		});
		setIcon(collapse, this.collapsedSections.has(section) ? "chevron-right" : "chevron-down");
		collapse.addEventListener("click", () => {
			if (this.collapsedSections.has(section)) this.collapsedSections.delete(section);
			else this.collapsedSections.add(section);
			this.render();
		});

		if (this.collapsedSections.has(section)) return;

		const selectedInSection = changes.filter((change) => this.selectedPaths.has(change.path));
		const toolbar = sectionEl.createDiv({ cls: "git-sync-change-toolbar" });
		toolbar.createDiv({ cls: "git-sync-select-label", text: "Select files" });
		const clear = toolbar.createEl("button", { text: "Clear selection", attr: { type: "button" } });
		clear.disabled = selectedInSection.length === 0;
		clear.addEventListener("click", () => {
			for (const change of changes) this.selectedPaths.delete(change.path);
			this.render();
		});
		const action = toolbar.createEl("button", { text: bulkAction, attr: { type: "button" } });
		action.disabled = selectedInSection.length === 0 || this.committing;
		action.addEventListener("click", () => void this.applySelectedStage(section === "staged"));

		if (changes.length === 0) {
			sectionEl.createDiv({ cls: "git-sync-section-empty", text: section === "staged" ? "No staged files" : "No uncommitted changes" });
			return;
		}

		const list = sectionEl.createEl("ul", { cls: "git-sync-changes-list" });
		for (const change of changes) this.renderChangeRow(list, change);
	}

	private renderChangeRow(list: HTMLElement, change: ChangedFile): void {
		const item = list.createEl("li", { cls: "git-sync-change" });
		const checkbox = item.createEl("input", {
			attr: { type: "checkbox", "aria-label": `Select ${change.path}`, "data-change-path": change.path },
		});
		checkbox.checked = this.selectedPaths.has(change.path);
		checkbox.disabled = this.committing;
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) this.selectedPaths.add(change.path);
			else this.selectedPaths.delete(change.path);
			this.render();
		});

		const code = item.createSpan({ cls: "git-sync-change-code", text: changeCode(change.status) });
		code.setAttribute("data-change-status", change.status);
		const path = item.createDiv({ cls: "git-sync-change-path", text: change.path });
		path.setAttribute("title", change.path);
		const action = item.createEl("button", {
			cls: "git-sync-change-menu",
			attr: {
				type: "button",
				"aria-label": `${change.staged ? "Unstage" : "Stage"} ${change.path}`,
				title: change.staged ? "Unstage" : "Stage",
				"data-change-path": change.path,
			},
		});
		setIcon(action, "more-horizontal");
		action.disabled = this.committing;
		action.addEventListener("click", () => void this.toggleStage(change));
	}

	private renderChangesActionBar(root: HTMLElement): HTMLElement {
		const bar = root.createDiv({ cls: "git-sync-bottom-bar" });
		const selectAll = bar.createEl("button", {
			cls: "git-sync-bottom-action is-primary",
			attr: { type: "button", "aria-label": "Select all changed files", title: "Select all" },
		});
		setIcon(selectAll, "check-square");
		selectAll.addEventListener("click", () => {
			this.selectAllChanges();
			this.render();
		});

		const stage = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Stage selected files", title: "Stage selected", "data-git-sync-action": "stage" },
		});
		setIcon(stage, "arrow-down-to-line");
		stage.disabled = !this.hasSelectedUncommitted() || this.committing;
		stage.addEventListener("click", () => void this.applySelectedStage(false));

		const unstage = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Unstage selected files", title: "Unstage selected", "data-git-sync-action": "unstage" },
		});
		setIcon(unstage, "arrow-up-to-line");
		unstage.disabled = !this.hasSelectedStaged() || this.committing;
		unstage.addEventListener("click", () => void this.applySelectedStage(true));

		const pull = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Pull from remote", title: "Pull from remote", "data-git-sync-action": "pull" },
		});
		setIcon(pull, "download");
		pull.addEventListener("click", () => void this.plugin.pullRemote());

		const push = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Push to remote", title: "Push to remote", "data-git-sync-action": "push" },
		});
		setIcon(push, "upload");
		push.addEventListener("click", () => void this.plugin.pushRemote());

		const refresh = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Refresh repository", title: "Refresh repository" },
		});
		setIcon(refresh, "refresh-cw");
		refresh.addEventListener("click", () => void this.refreshRepositoryState());
		return bar;
	}

	private updateChangesActionBar(): void {
		if (!this.changesActionBarEl) return;
		const stage = this.changesActionBarEl.querySelector<HTMLButtonElement>('[data-git-sync-action="stage"]');
		const unstage = this.changesActionBarEl.querySelector<HTMLButtonElement>('[data-git-sync-action="unstage"]');
		if (stage) stage.disabled = !this.hasSelectedUncommitted() || this.committing;
		if (unstage) unstage.disabled = !this.hasSelectedStaged() || this.committing;
	}

	private selectAllChanges(): void {
		for (const change of this.changes ?? []) this.selectedPaths.add(change.path);
	}

	private hasSelectedStaged(): boolean {
		return (this.changes ?? []).some((change) => change.staged && this.selectedPaths.has(change.path));
	}

	private hasSelectedUncommitted(): boolean {
		return (this.changes ?? []).some((change) => !change.staged && this.selectedPaths.has(change.path));
	}

	private async applySelectedStage(unstage: boolean): Promise<void> {
		const selected = (this.changes ?? []).filter((change) =>
			this.selectedPaths.has(change.path) && change.staged === unstage,
		);
		if (selected.length === 0) return;

		try {
			for (const change of selected) {
				if (unstage) await unstageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
				else await stageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
				this.plugin.recordActivity(`${unstage ? "Unstaged" : "Staged"} ${change.path}.`);
				this.selectedPaths.delete(change.path);
			}
			await this.refreshChangesOnly();
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update selected files.";
			this.plugin.recordActivity(`Could not update selected files: ${detail}`, "ERROR");
			new Notice(detail);
		}
	}

	private async toggleStage(change: ChangedFile): Promise<void> {
		try {
			if (change.staged) {
				await unstageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
				this.plugin.recordActivity(`Unstaged ${change.path}.`);
			} else {
				await stageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
				this.plugin.recordActivity(`Staged ${change.path}.`);
			}
			await this.refreshChangesOnly();
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update staging.";
			this.plugin.recordActivity(`Could not update ${change.path}: ${detail}`, "ERROR");
			new Notice(detail);
		}
	}

	private async commit(message: string): Promise<void> {
		const trimmedMessage = message.trim();
		if (!trimmedMessage) {
			new Notice("Enter a commit message.");
			return;
		}
		const authorName = this.plugin.settings.authorName.trim();
		const authorEmail = this.plugin.settings.authorEmail.trim();
		if (!authorName || !authorEmail) {
			new Notice("Enter your commit name and email in Git Sync settings.");
			this.openSettings();
			return;
		}
		this.committing = true;
		this.render();
		try {
			const oid = await commitChanges(this.app.vault.adapter, this.plugin.settings.repositoryPath, trimmedMessage, {
				name: authorName,
				email: authorEmail,
			});
			this.plugin.recordActivity(`Committed ${oid.slice(0, 7)}: ${trimmedMessage}`);
			this.commitMessage = "";
			new Notice("Commit created.");
			await this.refreshRepositoryState();
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to create the commit.";
			this.plugin.recordActivity(`Commit failed: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.committing = false;
			this.render();
		}
	}

	private async refreshChangesOnly(): Promise<void> {
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (!repositoryPath || this.repositoryState?.kind !== "ready") {
			await this.refreshRepositoryState();
			return;
		}

		try {
			this.changes = await readChanges(this.app.vault.adapter, repositoryPath);
			const availablePaths = new Set(this.changes.map((change) => change.path));
			for (const selectedPath of this.selectedPaths) {
				if (!availablePaths.has(selectedPath)) this.selectedPaths.delete(selectedPath);
			}
			this.changesError = null;
		} catch (error) {
			this.changes = null;
			this.changesError = error instanceof Error ? error.message : "Unable to read local changes.";
		}

		this.updateChangesContent();
	}

	private updateChangesContent(): void {
		const content = this.changesContentEl;
		if (!content || !content.isConnected || this.activeTab !== "Changes") {
			this.render();
			return;
		}

		const scrollTop = content.scrollTop;
		const activeElement = content.ownerDocument.activeElement;
		const focusedPath = activeElement instanceof HTMLElement
			? activeElement.getAttribute("data-change-path")
			: null;
		const focusedTextarea = activeElement instanceof HTMLTextAreaElement && content.contains(activeElement);
		const textareaSelection = focusedTextarea && activeElement instanceof HTMLTextAreaElement
			? { start: activeElement.selectionStart, end: activeElement.selectionEnd }
			: null;

		content.empty();
		this.renderChanges(content);
		content.scrollTop = scrollTop;
		this.updateChangesActionBar();

		if (focusedTextarea) {
			const textarea = content.querySelector<HTMLTextAreaElement>(".git-sync-commit textarea");
			if (textarea) {
				textarea.focus();
				if (textareaSelection) textarea.setSelectionRange(textareaSelection.start, textareaSelection.end);
			}
		} else if (focusedPath) {
			const focusedControl = Array.from(content.querySelectorAll<HTMLElement>("[data-change-path]"))
				.find((element) => element.getAttribute("data-change-path") === focusedPath);
			focusedControl?.focus();
		}
	}

	private recordRepositoryActivity(state: RepositoryState): void {
		const message = repositoryActivityMessage(state);
		if (message === this.lastRepositoryActivity) return;
		this.lastRepositoryActivity = message;
		this.plugin.recordActivity(message);
	}

	private renderActivity(content: HTMLElement): void {
		const entries = this.plugin.getActivity();
		if (entries.length === 0) {
			content.createEl("p", {
				text: "No log entries recorded yet.",
				cls: "git-sync-state-description",
			});
			return;
		}

		const list = content.createDiv({ cls: "git-sync-log-list" });
		for (const entry of entries) {
			const item = list.createDiv({ cls: "git-sync-log-entry" });
			item.createDiv({ text: formatLogTimestamp(entry.timestamp), cls: "git-sync-log-time" });
			const level = item.createDiv({ text: entry.level, cls: "git-sync-log-level" });
			level.setAttribute("data-log-level", entry.level);
			item.createDiv({ text: entry.message, cls: "git-sync-log-message" });
		}
	}

	private renderSettingsPrompt(content: HTMLElement, title: string): void {
		content.createDiv({ cls: "git-sync-state-title", text: title });
		content.createEl("p", {
			text: "Choose a vault-relative repository path in Settings to start using Git Sync.",
			cls: "git-sync-state-description",
		});
		const settingsButton = content.createEl("button", {
			text: "Open Settings",
			cls: "mod-cta",
			attr: { type: "button" },
		});
		settingsButton.addEventListener("click", () => this.openSettings());
	}

	private addRefreshButton(content: HTMLElement): void {
		const refreshButton = content.createEl("button", {
			text: "Refresh repository",
			attr: { type: "button" },
		});
		refreshButton.addEventListener("click", () => void this.refreshRepositoryState());
	}

	private openSettings(): void {
		const settings = (this.app as App & {
			setting: { open: () => void; openTabById: (id: string) => void };
		}).setting;
		settings.open();
		settings.openTabById(this.plugin.manifest.id);
	}
}

class GitSyncSettingTab extends PluginSettingTab {
	private readonly plugin: GitSyncPlugin;

	constructor(app: App, plugin: GitSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("git-sync-settings");
		containerEl.createEl("h2", { text: "Git Sync settings" });
		containerEl.createEl("p", {
			text: "Configure the repository used by this vault.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Repository path")
			.setDesc("Vault-relative path to the Git repository. Use . for the vault root.")
			.addText((text) => {
				text.setPlaceholder("path/to/repository");
				text.setValue(this.plugin.settings.repositoryPath);
				text.onChange((value) => {
					this.plugin.settings.repositoryPath = value.trim();
					this.plugin.scheduleSettingsSave();
				});
			});

		containerEl.createEl("h3", { text: "Updates" });
		new Setting(containerEl)
			.setName("Check for updates on startup")
			.setDesc("Checks GitHub releases at most once per day.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.checkForUpdates).onChange(async (value) => {
					this.plugin.settings.checkForUpdates = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Release channel")
			.setDesc("Development builds follow this branch; stable builds use the latest stable release.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("dev", "Development")
					.addOption("stable", "Stable")
					.setValue(this.plugin.settings.updateChannel)
					.onChange(async (value) => {
						this.plugin.settings.updateChannel = value as "stable" | "dev";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-install stable updates")
			.setDesc("Installs stable releases without prompting. Development builds always require confirmation.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoUpdate).onChange(async (value) => {
					this.plugin.settings.autoUpdate = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Check now")
			.setDesc(`Installed version ${this.plugin.manifest.version}.`)
			.addButton((button) =>
				button.setButtonText("Check for updates").setCta().onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("Checking…");
					try {
						await this.plugin.checkForUpdates(true);
					} finally {
						button.setButtonText("Check for updates");
						button.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl)
			.setName("Available branch builds")
			.setDesc("Browse and install published development builds from any branch.")
			.addButton((button) => button.setButtonText("Browse builds").onClick(() => this.plugin.showAvailableBuilds()));

		new Setting(containerEl)
			.setName("Remote URL")
			.setDesc("HTTP or HTTPS URL for the Git remote.")
			.addText((text) => {
				text.setPlaceholder("https://github.com/user/repository.git");
				text.setValue(this.plugin.settings.remoteUrl);
				text.onChange((value) => {
					this.plugin.settings.remoteUrl = value.trim();
					this.plugin.scheduleSettingsSave();
				});
			});

		new Setting(containerEl)
			.setName("Remote username")
			.setDesc("Username sent with the remote token or password.")
			.addText((text) => {
				text.setPlaceholder("git");
				text.setValue(this.plugin.settings.remoteUsername);
				text.onChange((value) => {
					this.plugin.settings.remoteUsername = value.trim();
					this.plugin.scheduleSettingsSave();
				});
			});

		let revealToken = false;
		let tokenInput: HTMLInputElement | null = null;
		const updateTokenField = (button: HTMLElement): void => {
			if (tokenInput) {
				const token = this.plugin.getRemoteToken() ?? "";
				tokenInput.value = revealToken ? token : maskRemoteToken(token);
				tokenInput.readOnly = !revealToken;
			}
			setIcon(button, revealToken ? "eye-off" : "eye");
			button.setAttribute("aria-label", revealToken ? "Hide remote token" : "Show remote token");
			button.setAttribute("title", revealToken ? "Hide token" : "Show token");
		};
		new Setting(containerEl)
			.setName("Remote token or password")
			.setDesc("Stored in Obsidian SecretStorage and never in plugin settings.")
			.addText((text) => {
				tokenInput = text.inputEl;
				text.inputEl.type = "text";
				text.inputEl.autocomplete = "off";
				text.inputEl.readOnly = true;
				text.setPlaceholder("Enter a token or password");
				text.inputEl.value = maskRemoteToken(this.plugin.getRemoteToken() ?? "");
				text.onChange((value) => {
					if (revealToken) this.plugin.saveRemoteToken(value);
				});
			})
			.addButton((button) => {
				button.buttonEl.empty();
				updateTokenField(button.buttonEl);
				button.onClick(() => {
					revealToken = !revealToken;
					updateTokenField(button.buttonEl);
				});
			});

		new Setting(containerEl)
			.setName("Test remote connection")
			.setDesc("Checks the configured HTTP remote and reports its default branch.")
			.addButton((button) =>
				button.setButtonText("Test connection").onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("Testing…");
					try {
						await this.plugin.checkRemoteConnection();
					} finally {
						button.setButtonText("Test connection");
						button.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl)
			.setName("Branch")
			.setDesc("The branch to use for future sync operations.")
			.addText((text) => {
				text.setPlaceholder("main");
				text.setValue(this.plugin.settings.branchName);
				text.onChange((value) => {
					this.plugin.settings.branchName = value.trim();
					this.plugin.scheduleSettingsSave();
				});
			});

		containerEl.createEl("h3", { text: "Commit identity" });
		containerEl.createEl("p", {
			text: "Used only when creating local commits.",
			cls: "setting-item-description",
		});
		new Setting(containerEl)
			.setName("Commit name")
			.setDesc("Your name in new Git commits.")
			.addText((text) => {
				text.setPlaceholder("Your name");
				text.setValue(this.plugin.settings.authorName);
				text.onChange((value) => {
					this.plugin.settings.authorName = value.trim();
					this.plugin.scheduleSettingsSave();
				});
			});

		new Setting(containerEl)
			.setName("Commit email")
			.setDesc("Your email address in new Git commits.")
			.addText((text) => {
				text.setPlaceholder("you@example.com");
				text.setValue(this.plugin.settings.authorEmail);
				text.onChange((value) => {
					this.plugin.settings.authorEmail = value.trim();
					this.plugin.scheduleSettingsSave();
				});
			});

		containerEl.createEl("p", {
			text: "Settings save automatically when changed.",
			cls: "setting-item-description",
		});

		containerEl.createEl("h3", { text: "Plugin data" });
		containerEl.createEl("p", {
			text: "Export or import versioned settings and activity data. Remote credentials stay in Obsidian SecretStorage and are never included.",
			cls: "setting-item-description",
		});
		new Setting(containerEl)
			.setName("Include activity in exports")
			.setDesc("Adds the recent Activity history to exported files. Disabled by default.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.includeActivityInExports)
				.onChange(async (value) => {
					this.plugin.settings.includeActivityInExports = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName("Export plugin data")
			.setDesc("Writes a timestamped JSON backup to the vault root. Remote credentials are not included.")
			.addButton((button) => button
				.setButtonText("Export to vault")
				.onClick(async () => {
					button.setDisabled(true);
					try {
						const path = await this.plugin.exportDataToVault();
						new Notice(`Plugin data exported to ${path}.`);
					} catch (error) {
						const detail = error instanceof Error ? error.message : "Unknown error";
						this.plugin.recordActivity(`Plugin data export failed: ${detail}`, "ERROR");
						new Notice(`Could not export plugin data: ${detail}`);
					} finally {
						button.setDisabled(false);
					}
				}));
		new Setting(containerEl)
			.setName("Import plugin data")
			.setDesc("Replaces settings and activity from a Git Sync JSON backup. The current remote credential is kept.")
			.addButton((button) => button
				.setButtonText("Import JSON")
				.onClick(() => chooseImportFile(this.plugin)));
	}
}

function repositoryActivityMessage(state: RepositoryState): string {
	switch (state.kind) {
		case "missing":
			return `No Git repository found at ${state.repositoryPath}.`;
		case "ready":
			return `Read local repository on ${state.branch}.`;
		case "error":
			return `Could not read repository: ${state.message}`;
		case "checking":
			return `Checking repository at ${state.repositoryPath}.`;
	}
}

function formatLogTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number): string => `0${value}`.slice(-2);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function commitTitle(message: string): string {
	return message.split("\n", 1)[0].trim() || "(no commit message)";
}

function formatRelativeCommitTime(timestamp: number): string {
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
	if (seconds < 60) return "just now";
	if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 60 * 60 * 24) return `${Math.floor(seconds / (60 * 60))}h ago`;
	if (seconds < 60 * 60 * 24 * 30) return `${Math.floor(seconds / (60 * 60 * 24))}d ago`;
	if (seconds < 60 * 60 * 24 * 365) return `${Math.floor(seconds / (60 * 60 * 24 * 30))}mo ago`;
	return `${Math.floor(seconds / (60 * 60 * 24 * 365))}y ago`;
}

function formatCommitTimestamp(timestamp: number): string {
	return formatLogTimestamp(timestamp * 1000);
}

function formatFileTimestamp(date: Date): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function chooseImportFile(plugin: GitSyncPlugin): void {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".json,application/json";
	input.style.display = "none";
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		input.remove();
		if (!file) return;

		const reader = new FileReader();
		reader.onload = () => {
			void plugin.importData(String(reader.result ?? "")).catch((error) => {
				new Notice(`Could not import plugin data: ${error instanceof Error ? error.message : "Unknown error"}`);
			});
		};
		reader.onerror = () => new Notice("Could not read the selected plugin data file.");
		reader.readAsText(file);
	});
	document.body.appendChild(input);
	input.click();
}

function decodePluginData(value: unknown, allowLegacy: boolean, requireRecognizedData = false): DecodedPluginData {
	if (!isRecord(value)) {
		if (requireRecognizedData) throw new Error("Git Sync data must be a JSON object.");
		return { settings: {}, activity: [], legacy: false };
	}
	if ("format" in value && value.format !== PLUGIN_DATA_FORMAT) {
		throw new Error("This file belongs to a different plugin or data format.");
	}

	if (value.format === PLUGIN_DATA_FORMAT) {
		if (value.schemaVersion !== PLUGIN_DATA_SCHEMA_VERSION) {
			throw new Error(`Unsupported Git Sync data schema: ${String(value.schemaVersion)}.`);
		}
		if (!isRecord(value.settings)) throw new Error("Git Sync data is missing its settings object.");
		return { settings: value.settings as Partial<GitSyncSettings>, activity: value.activity, legacy: false };
	}

	if (!allowLegacy) throw new Error("This is not a Git Sync data file.");
	const legacyKeys = [
		"repositoryPath",
		"remoteUrl",
		"remoteUsername",
		"branchName",
		"authorName",
		"authorEmail",
		"checkForUpdates",
		"updateChannel",
		"autoUpdate",
		"lastUpdateCheck",
		"includeActivityInExports",
		"activity",
	];
	if (requireRecognizedData && !legacyKeys.some((key) => key in value)) {
		throw new Error("The selected file is not Git Sync plugin data.");
	}
	return {
		settings: value as Partial<GitSyncSettings>,
		activity: value.activity,
		legacy: true,
	};
}

function normalizeSettings(value: Partial<GitSyncSettings>): GitSyncSettings {
	const settings = isRecord(value) ? value : {};
	const updateChannel = settings.updateChannel === "stable" ? "stable" : "dev";
	return {
		repositoryPath: nonEmptyString(settings.repositoryPath) || DEFAULT_SETTINGS.repositoryPath,
		remoteUrl: stringValue(settings.remoteUrl),
		remoteUsername: nonEmptyString(settings.remoteUsername) || DEFAULT_SETTINGS.remoteUsername,
		branchName: nonEmptyString(settings.branchName) || DEFAULT_SETTINGS.branchName,
		authorName: stringValue(settings.authorName),
		authorEmail: stringValue(settings.authorEmail),
		checkForUpdates: booleanValue(settings.checkForUpdates, DEFAULT_SETTINGS.checkForUpdates),
		updateChannel,
			autoUpdate: booleanValue(settings.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
			lastUpdateCheck: finiteNumber(settings.lastUpdateCheck, DEFAULT_SETTINGS.lastUpdateCheck),
			includeActivityInExports: booleanValue(settings.includeActivityInExports, DEFAULT_SETTINGS.includeActivityInExports),
		};
}

function normalizeActivity(value: unknown): ActivityEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is Record<string, unknown> => isRecord(entry))
		.filter((entry) => typeof entry.message === "string" && Number.isFinite(entry.timestamp))
		.map((entry): ActivityEntry => ({
			message: String(entry.message),
			timestamp: Number(entry.timestamp),
			level: entry.level === "DEBUG" || entry.level === "METRIC" || entry.level === "ERROR" ? entry.level : "INFO",
		}))
		.slice(0, MAX_ACTIVITY_ENTRIES);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function nonEmptyString(value: unknown): string {
	return stringValue(value).trim();
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function commitFileCode(status: "Added" | "Modified" | "Deleted"): string {
	switch (status) {
		case "Added":
			return "A";
		case "Deleted":
			return "D";
		default:
			return "M";
	}
}

function maskRemoteToken(token: string): string {
	if (!token) return "";
	if (token.length <= 8) return `${token.slice(0, 2)}…${token.slice(-2)}`;
	return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function describeOperationError(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		const details: string[] = [error.message || fallback];
		if (isRecord(error) && typeof error.code === "string") details.push(`code=${error.code}`);
		if (isRecord(error) && typeof error.caller === "string") details.push(`caller=${error.caller}`);
		return details.join(" ");
	}
	return typeof error === "string" && error ? error : fallback;
}

function changeCode(status: string): string {
	switch (status) {
		case "Untracked":
			return "?";
		case "Added":
			return "A";
		case "Deleted":
		case "Added, deleted":
			return "D";
		default:
			return "M";
	}
}
