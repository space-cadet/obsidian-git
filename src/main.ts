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
	readChanges,
	RepositoryState,
	stageFile,
	unstageFile,
	validateRepositoryPath,
} from "./repository";
import { AvailableBuildsModal, PluginUpdater, UpdateAvailableModal } from "./updater/PluginUpdater";

const VIEW_TYPE_GIT_SYNC = "git-sync-sidebar";

interface GitSyncSettings {
	repositoryPath: string;
	remoteUrl: string;
	branchName: string;
	authorName: string;
	authorEmail: string;
	checkForUpdates: boolean;
	updateChannel: "stable" | "dev";
	autoUpdate: boolean;
	lastUpdateCheck: number;
}

interface ActivityEntry {
	message: string;
	timestamp: number;
}

const DEFAULT_SETTINGS: GitSyncSettings = {
	repositoryPath: ".",
	remoteUrl: "",
	branchName: "main",
	authorName: "",
	authorEmail: "",
	checkForUpdates: true,
	updateChannel: "dev",
	autoUpdate: false,
	lastUpdateCheck: 0,
};

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncSettings = DEFAULT_SETTINGS;
	private activity: ActivityEntry[] = [];
	private updater: PluginUpdater | null = null;

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
		const saved = (await this.loadData()) as Partial<GitSyncSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			repositoryPath: saved?.repositoryPath?.trim() || DEFAULT_SETTINGS.repositoryPath,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.recordActivity("Saved repository settings.");
		this.refreshViews();
	}

	recordActivity(message: string): void {
		this.activity.unshift({ message, timestamp: Date.now() });
		this.activity = this.activity.slice(0, 50);
	}

	getActivity(): readonly ActivityEntry[] {
		return this.activity;
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
		await this.saveData(this.settings);

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
					this.recordActivity(`Automatic update failed: ${message}`);
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
	private changesError: string | null = null;
	private committing = false;
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

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("git-sync-sidebar");

		const header = root.createDiv({ cls: "git-sync-header" });
		const headerRow = header.createDiv({ cls: "git-sync-header-row" });
		headerRow.createDiv({ cls: "git-sync-title", text: "Git Sync" });
		const settingsButton = headerRow.createEl("button", {
			cls: "git-sync-settings-button",
			attr: { type: "button", "aria-label": "Open Git Sync settings", title: "Open Settings" },
		});
		setIcon(settingsButton, "settings");
		settingsButton.addEventListener("click", () => this.openSettings());
		const repository = this.plugin.settings.repositoryPath.trim();
		header.createDiv({
			cls: "git-sync-repository",
			text: repository || "No repository configured",
		});

		const tabs = root.createDiv({ cls: "git-sync-tabs", attr: { role: "tablist" } });
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

		this.renderRepositoryContext(root, repository);

		const content = root.createDiv({ cls: "git-sync-content" });
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
			this.renderChanges(content);
			return;
		}

		content.createDiv({ cls: "git-sync-state-title", text: this.activeTab });
		content.createEl("p", {
			text: `Local repository ready on ${this.repositoryState.branch}.`,
			cls: "git-sync-state-description",
		});
		if (this.repositoryState.head) {
			content.createEl("p", {
				text: `HEAD ${this.repositoryState.head.slice(0, 7)}`,
				cls: "git-sync-state-description",
			});
		}
		content.createEl("p", { text: "Commit history is next.", cls: "git-sync-state-description" });
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

		const comparison = context.createDiv({ cls: "git-sync-comparison-status" });
		const comparisonIcon = comparison.createSpan({ cls: "git-sync-comparison-icon" });
		setIcon(comparisonIcon, "alert-circle");
		comparison.createDiv({
			cls: "git-sync-comparison-text",
			text: repository ? "Repository comparison unavailable" : "Repository not configured",
		});
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
				this.changesError = null;
			} catch (error) {
				this.changes = null;
				this.changesError = error instanceof Error ? error.message : "Unable to read local changes.";
			}
		} else {
			this.changes = null;
			this.changesError = null;
		}
		if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
		this.recordRepositoryActivity(state);
		this.render();
	}

	private renderChanges(content: HTMLElement): void {
		content.createDiv({ cls: "git-sync-state-title", text: "Changes" });
		if (this.changesError) {
			content.createEl("p", { text: this.changesError, cls: "git-sync-state-description" });
			this.addRefreshButton(content);
			return;
		}
		if (!this.changes) {
			content.createEl("p", { text: "Reading local changes…", cls: "git-sync-state-description" });
			return;
		}
		if (this.changes.length === 0) {
			content.createEl("p", { text: "Working tree is clean.", cls: "git-sync-state-description" });
			this.addRefreshButton(content);
			return;
		}

		const list = content.createEl("ul", { cls: "git-sync-changes-list" });
		for (const change of this.changes) {
			const item = list.createEl("li", { cls: "git-sync-change" });
			const details = item.createDiv({ cls: "git-sync-change-details" });
			details.createDiv({ text: change.path, cls: "git-sync-change-path" });
			details.createDiv({ text: change.status, cls: "git-sync-change-status" });
			const action = item.createEl("button", {
				text: change.staged ? "Unstage" : "Stage",
				attr: { type: "button" },
			});
			action.disabled = this.committing;
			action.addEventListener("click", () => void this.toggleStage(change));
		}

		const stagedCount = this.changes.filter((change) => change.staged).length;
		const commit = content.createDiv({ cls: "git-sync-commit" });
		commit.createDiv({ text: `${stagedCount} file${stagedCount === 1 ? "" : "s"} staged`, cls: "git-sync-change-status" });
		const message = commit.createEl("textarea", {
			attr: { placeholder: "Commit message", "aria-label": "Commit message", rows: "3" },
		});
		const commitButton = commit.createEl("button", { text: "Commit", cls: "mod-cta", attr: { type: "button" } });
		commitButton.disabled = stagedCount === 0 || this.committing;
		commitButton.addEventListener("click", () => void this.commit(message.value));
		this.addRefreshButton(content);
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
			await this.refreshRepositoryState();
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update staging.";
			this.plugin.recordActivity(`Could not update ${change.path}: ${detail}`);
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
			new Notice("Commit created.");
			await this.refreshRepositoryState();
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to create the commit.";
			this.plugin.recordActivity(`Commit failed: ${detail}`);
			new Notice(detail);
		} finally {
			this.committing = false;
			this.render();
		}
	}

	private recordRepositoryActivity(state: RepositoryState): void {
		const message = repositoryActivityMessage(state);
		if (message === this.lastRepositoryActivity) return;
		this.lastRepositoryActivity = message;
		this.plugin.recordActivity(message);
	}

	private renderActivity(content: HTMLElement): void {
		content.createDiv({ cls: "git-sync-state-title", text: "Log" });
		const entries = this.plugin.getActivity();
		if (entries.length === 0) {
			content.createEl("p", {
				text: "No activity recorded yet.",
				cls: "git-sync-state-description",
			});
			return;
		}

		const list = content.createEl("ul", { cls: "git-sync-activity-list" });
		for (const entry of entries) {
			const item = list.createEl("li");
			item.createDiv({ text: entry.message });
			item.createDiv({
				text: new Date(entry.timestamp).toLocaleTimeString(),
				cls: "git-sync-activity-time",
			});
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
					await this.plugin.saveData(this.plugin.settings);
					this.plugin.recordActivity("Saved updater settings.");
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
			.setDesc("Optional until remote sync is enabled.")
			.addText((text) => {
				text.setPlaceholder("https://github.com/user/repository.git");
				text.setValue(this.plugin.settings.remoteUrl);
				text.onChange((value) => {
					this.plugin.settings.remoteUrl = value.trim();
				});
			});

		new Setting(containerEl)
			.setName("Branch")
			.setDesc("The branch to use for future sync operations.")
			.addText((text) => {
				text.setPlaceholder("main");
				text.setValue(this.plugin.settings.branchName);
				text.onChange((value) => {
					this.plugin.settings.branchName = value.trim();
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
				});
			});

		const feedback = containerEl.createDiv({ cls: "git-sync-settings-feedback" });
		new Setting(containerEl)
			.setName("Save settings")
			.setDesc("Repository path and branch are required. Commit identity is needed before committing.")
			.addButton((button) => {
				button.setButtonText("Save");
				button.setCta();
				button.onClick(async () => {
					const settings = this.plugin.settings;
					const pathError = validateRepositoryPath(settings.repositoryPath);
					if (pathError || !settings.branchName) {
						feedback.setText(pathError || "Enter a branch before saving.");
						feedback.addClass("is-error");
						return;
					}

					await this.plugin.saveSettings();
					feedback.removeClass("is-error");
					feedback.setText("Settings saved.");
				});
			});
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
