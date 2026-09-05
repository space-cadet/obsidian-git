import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";

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
				view.render();
			}
		}
	}
}

class GitSyncView extends ItemView {
	private readonly plugin: GitSyncPlugin;
	private activeTab = "Changes";

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
			content.createDiv({ cls: "git-sync-state-title", text: "Set up your repository" });
			content.createEl("p", {
				text: "Choose a repository in Settings to start using Git Sync.",
				cls: "git-sync-state-description",
			});
			const settingsButton = content.createEl("button", {
				text: "Open Settings",
				cls: "mod-cta",
				attr: { type: "button" },
			});
			settingsButton.addEventListener("click", () => {
				const settings = (this.app as App & {
					setting: { open: () => void; openTabById: (id: string) => void };
				}).setting;
				settings.open();
				settings.openTabById(this.plugin.manifest.id);
			});
			return;
		}

		content.createDiv({ cls: "git-sync-state-title", text: this.activeTab });
		content.createEl("p", {
			text: "Git actions will appear here when the repository component is ready.",
			cls: "git-sync-state-description",
		});
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
					if (!settings.repositoryPath || !settings.branchName) {
						feedback.setText("Enter a repository path and branch before saving.");
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
