import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";
import { inspectLocalRepository, RepositoryState, validateRepositoryPath } from "./repository";

const VIEW_TYPE_GIT_SYNC = "git-sync-sidebar";

interface GitSyncSettings {
	repositoryPath: string;
	remoteUrl: string;
	branchName: string;
}

const DEFAULT_SETTINGS: GitSyncSettings = {
	repositoryPath: "",
	remoteUrl: "",
	branchName: "main",
};

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncSettings = DEFAULT_SETTINGS;

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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshViews();
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
	private refreshGeneration = 0;

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
		header.createDiv({ cls: "git-sync-title", text: "Git Sync" });
		const repository = this.plugin.settings.repositoryPath.trim();
		header.createDiv({
			cls: "git-sync-repository",
			text: repository || "No repository configured",
		});

		const tabs = root.createDiv({ cls: "git-sync-tabs", attr: { role: "tablist" } });
		for (const tabName of ["Changes", "Commits", "Activity"]) {
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

		const content = root.createDiv({ cls: "git-sync-content" });
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
		content.createEl("p", {
			text: "Changes and commit actions are next.",
			cls: "git-sync-state-description",
		});
		this.addRefreshButton(content);
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
		this.render();
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
			.setDesc("Path to the Git repository, relative to the vault when possible.")
			.addText((text) => {
				text.setPlaceholder("path/to/repository");
				text.setValue(this.plugin.settings.repositoryPath);
				text.onChange((value) => {
					this.plugin.settings.repositoryPath = value.trim();
				});
			});

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

		const feedback = containerEl.createDiv({ cls: "git-sync-settings-feedback" });
		new Setting(containerEl)
			.setName("Save settings")
			.setDesc("Repository path and branch are required.")
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
