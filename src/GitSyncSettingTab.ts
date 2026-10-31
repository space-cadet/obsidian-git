import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type GitSyncPlugin from "./main";

export class GitSyncSettingTab extends PluginSettingTab {
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
		const repositoryPath = this.plugin.settings.repositoryPath || ".";
		const repositoryLabel = repositoryPath === "." ? "Vault root" : repositoryPath;
		containerEl.createEl("p", {
			text: "Configure the selected repository and vault-wide Git Sync options.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Selected repository")
			.setDesc(`${repositoryLabel} — switch or add repositories from the Git Sync panel.`);

		new Setting(containerEl)
			.setName("Background refresh delay")
			.setDesc("When Git Sync is in the background, refresh changed files after this quiet period. Only changed paths are checked.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("0", "Off")
					.addOption("5", "After 5 seconds")
					.addOption("15", "After 15 seconds")
					.addOption("30", "After 30 seconds")
					.addOption("60", "After 1 minute")
					.setValue(String(this.plugin.settings.backgroundRefreshDelaySeconds))
					.onChange(async (value) => {
						this.plugin.settings.backgroundRefreshDelaySeconds = Number(value);
						this.plugin.refreshBackgroundRefreshSetting();
						await this.plugin.saveSettings();
					}),
			);

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
					this.plugin.scheduleSettingsSave(false, true);
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

		const saveStatus = containerEl.createEl("p", {
			text: "Settings save automatically when changed.",
			cls: "setting-item-description git-sync-settings-save-status",
			attr: { "aria-live": "polite", "aria-busy": "false" },
		});
		this.plugin.setSettingsSaveIndicator(saveStatus);

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
					button.setButtonText("Exporting…");
					try {
						const path = await this.plugin.exportDataToVault();
						new Notice(`Plugin data exported to ${path}.`);
					} catch (error) {
						const detail = error instanceof Error ? error.message : "Unknown error";
						this.plugin.recordActivity(`Plugin data export failed: ${detail}`, "ERROR");
						new Notice(`Could not export plugin data: ${detail}`);
					} finally {
						button.setButtonText("Export to vault");
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

function maskRemoteToken(token: string): string {
	if (!token) return "";
	if (token.length <= 8) return `${token.slice(0, 2)}…${token.slice(-2)}`;
	return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
