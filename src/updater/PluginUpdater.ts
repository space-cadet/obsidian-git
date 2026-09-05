import { App, Modal, Notice, Setting, requestUrl } from "obsidian";

const GITHUB_REPOSITORY = "space-cadet/obsidian-git";
const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"] as const;

type ReleaseFile = (typeof RELEASE_FILES)[number];

export interface ReleaseInfo {
	tag_name: string;
	name: string;
	body: string;
	prerelease: boolean;
	published_at: string;
	updated_at: string;
	html_url: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
		size: number;
	}>;
}

export interface AvailableBuild {
	release: ReleaseInfo;
	branch: string;
	commit: string | null;
	updatedAt: string;
}

export type UpdateCheckResult =
	| { kind: "available"; release: ReleaseInfo; currentVersion: string; latestVersion: string; commit: string | null }
	| { kind: "up-to-date"; currentVersion: string }
	| { kind: "unavailable"; message: string }
	| { kind: "error"; message: string };

export class PluginUpdater {
	private readonly pluginDir: string;

	constructor(private readonly app: App, pluginId: string) {
		this.pluginDir = `.obsidian/plugins/${pluginId}`;
	}

	async checkForUpdate(options: {
		currentVersion: string;
		currentCommit: string;
		currentBranch: string;
		channel: "stable" | "dev";
	}): Promise<UpdateCheckResult> {
		try {
			const release = await this.findRelease(options.channel, options.currentBranch);
			if (!release) {
				return {
					kind: "unavailable",
					message: options.channel === "stable"
						? "No stable Git Sync release is published yet."
						: "No development build is published for this branch.",
				};
			}

			const latestVersion = release.tag_name.replace(/^v/, "");
			const commit = commitFromRelease(release);
			const isCurrentDevBuild =
				options.channel === "dev" &&
				commit !== null &&
				options.currentCommit !== "unknown" &&
				commit.slice(0, 7) === options.currentCommit.slice(0, 7);
			const hasUpdate = isCurrentDevBuild
				? false
				: options.channel === "dev"
					? true
					: compareVersions(latestVersion, options.currentVersion) > 0;

			return hasUpdate
				? {
						kind: "available",
						release,
						currentVersion: options.currentVersion,
						latestVersion,
						commit,
					}
				: { kind: "up-to-date", currentVersion: options.currentVersion };
		} catch (error) {
			return {
				kind: "error",
				message: error instanceof Error ? error.message : "Unable to check for updates.",
			};
		}
	}

	async downloadAndValidate(release: ReleaseInfo): Promise<string> {
		await this.cleanStaleTemporaryFiles();
		const tempDir = `${this.pluginDir}/.update-tmp-${Date.now()}`;
		await this.ensureDirectory(tempDir);

		try {
			for (const file of RELEASE_FILES) {
				const asset = release.assets.find((candidate) => candidate.name === file);
				if (!asset) throw new Error(`Release is missing ${file}.`);
				const response = await requestUrl({
					url: asset.browser_download_url,
					method: "GET",
					throw: false,
					headers: { "User-Agent": "obsidian-git-sync-updater" },
				});
				if (response.status < 200 || response.status >= 300) {
					throw new Error(`Could not download ${file} (HTTP ${response.status}).`);
				}
				if (!response.text) throw new Error(`Downloaded ${file} is empty.`);
				await this.app.vault.adapter.write(`${tempDir}/${file}`, response.text);
			}

			await this.validateDownloadedRelease(tempDir, release);
			return tempDir;
		} catch (error) {
			await this.removeDirectory(tempDir);
			throw error;
		}
	}

	async listAvailableBuilds(): Promise<AvailableBuild[]> {
		const releases = (await fetchJson(
			`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=100&_cb=${Date.now()}`,
		)) as ReleaseInfo[];

		return releases
			.filter((release) => release.prerelease && release.tag_name.startsWith("latest-dev"))
			.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
			.map((release) => ({
				release,
				branch: branchFromRelease(release),
				commit: commitFromRelease(release),
				updatedAt: release.updated_at,
			}));
	}

	async installUpdate(tempDir: string): Promise<void> {
		const backupDir = `${this.pluginDir}/.update-backup`;
		await this.ensureDirectory(backupDir);
		const previous = new Map<ReleaseFile, string | null>();

		for (const file of RELEASE_FILES) {
			const currentPath = `${this.pluginDir}/${file}`;
			const content = (await this.app.vault.adapter.exists(currentPath))
				? await this.app.vault.adapter.read(currentPath)
				: null;
			previous.set(file, content);
			if (content !== null) await this.app.vault.adapter.write(`${backupDir}/${file}`, content);
		}

		try {
			for (const file of RELEASE_FILES) {
				const content = await this.app.vault.adapter.read(`${tempDir}/${file}`);
				await this.app.vault.adapter.write(`${this.pluginDir}/${file}`, content);
			}
		} catch (error) {
			await this.restorePreviousFiles(previous);
			throw new Error(
				`Update failed; the previous plugin files were restored. ${errorMessage(error)}`,
			);
		} finally {
			await this.removeDirectory(tempDir);
		}
	}

	private async findRelease(
		channel: "stable" | "dev",
		branch: string,
	): Promise<ReleaseInfo | null> {
		if (channel === "stable") {
			try {
				return (await fetchJson(
					`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest?_cb=${Date.now()}`,
				)) as ReleaseInfo;
			} catch (error) {
				if (errorStatus(error) === 404) return null;
				throw error;
			}
		}

		const releases = (await fetchJson(
			`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=30&_cb=${Date.now()}`,
		)) as ReleaseInfo[];
		const branchTag = `latest-dev-${branch}`;
		return (
			releases.find((release) => release.tag_name === branchTag) ??
			releases.find((release) => release.tag_name === "latest-dev") ??
			releases.find((release) => release.prerelease) ??
			null
		);
	}

	private async validateDownloadedRelease(tempDir: string, release: ReleaseInfo): Promise<void> {
		const manifestText = await this.app.vault.adapter.read(`${tempDir}/manifest.json`);
		let manifest: { id?: unknown; version?: unknown };
		try {
			manifest = JSON.parse(manifestText) as { id?: unknown; version?: unknown };
		} catch {
			throw new Error("Downloaded manifest.json is not valid JSON.");
		}
		if (manifest.id !== "obsidian-git-sync") {
			throw new Error("Downloaded manifest belongs to a different plugin.");
		}
		if (typeof manifest.version !== "string" || !manifest.version) {
			throw new Error("Downloaded manifest has no version.");
		}

		const expectedCommit = commitFromRelease(release);
		if (expectedCommit) {
			const main = await this.app.vault.adapter.read(`${tempDir}/main.js`);
			if (!main.includes(expectedCommit)) {
				throw new Error("Downloaded main.js does not match the published build commit.");
			}
		}
	}

	private async cleanStaleTemporaryFiles(): Promise<void> {
		try {
			const listing = await this.app.vault.adapter.list(this.pluginDir);
			for (const folder of listing.folders) {
				if (folder.startsWith(`${this.pluginDir}/.update-tmp-`)) {
					await this.removeDirectory(folder);
				}
			}
		} catch {
			// The plugin directory is created by Obsidian; no cleanup is needed if it is unavailable.
		}
	}

	private async ensureDirectory(path: string): Promise<void> {
		try {
			await this.app.vault.adapter.mkdir(path);
		} catch {
			if (!(await this.app.vault.adapter.exists(path))) throw new Error(`Could not create ${path}.`);
		}
	}

	private async restorePreviousFiles(previous: Map<ReleaseFile, string | null>): Promise<void> {
		for (const file of RELEASE_FILES) {
			const content = previous.get(file);
			const destination = `${this.pluginDir}/${file}`;
			if (content === null || content === undefined) {
				if (await this.app.vault.adapter.exists(destination)) await this.app.vault.adapter.remove(destination);
			} else {
				await this.app.vault.adapter.write(destination, content);
			}
		}
	}

	private async removeDirectory(path: string): Promise<void> {
		try {
			if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.rmdir(path, true);
		} catch {
			// Temporary cleanup is best effort and never hides an update failure.
		}
	}
}

export class UpdateAvailableModal extends Modal {
	constructor(
		app: App,
		private readonly result: Extract<UpdateCheckResult, { kind: "available" }>,
		private readonly onInstall: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Git Sync update available" });
		this.contentEl.createEl("p", {
			text: `Current version: ${this.result.currentVersion}`,
		});
		this.contentEl.createEl("p", {
			text: `Available build: ${this.result.latestVersion}`,
		});
		if (this.result.release.prerelease) {
			this.contentEl.createEl("p", {
				text: "This is a development build.",
				cls: "git-sync-update-warning",
			});
		}
		if (this.result.commit) {
			this.contentEl.createEl("p", {
				text: `Build commit: ${this.result.commit.slice(0, 7)}`,
			});
		}
		if (this.result.release.body) {
			this.contentEl.createEl("h3", { text: "Changelog" });
			this.contentEl.createEl("pre", {
				text: this.result.release.body,
				cls: "git-sync-update-changelog",
			});
		}

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Install & Reload").setCta().onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("Installing…");
					try {
						await this.onInstall();
						new Notice("Update installed. Reloading Obsidian…");
						this.close();
						const commands = (this.app as App & {
							commands: { executeCommandById: (id: string) => unknown };
						}).commands;
						void commands.executeCommandById("app:reload");
					} catch (error) {
						button.setDisabled(false);
						button.setButtonText("Install & Reload");
						new Notice(`Update failed: ${errorMessage(error)}`);
					}
				}),
			)
			.addButton((button) => button.setButtonText("Not now").onClick(() => this.close()));
	}
}

export class AvailableBuildsModal extends Modal {
	constructor(
		app: App,
		private readonly updater: PluginUpdater,
		private readonly onInstall: (build: AvailableBuild) => Promise<void>,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Available development builds" });
		this.contentEl.createEl("p", {
			text: "Choose a branch build to download and install. Newest updated build appears first.",
		});
		const status = this.contentEl.createEl("p", { text: "Loading builds…" });

		try {
			const builds = await this.updater.listAvailableBuilds();
			status.remove();
			if (builds.length === 0) {
				this.contentEl.createEl("p", { text: "No development builds are currently available." });
				return;
			}

			for (const build of builds) {
				const timestamp = new Date(build.updatedAt).toLocaleString();
				new Setting(this.contentEl)
					.setName(build.branch)
					.setDesc(
						`${build.release.name || build.release.tag_name} · ${build.commit?.slice(0, 7) ?? "commit unavailable"} · Updated ${timestamp}`,
					)
					.addButton((button) =>
						button.setButtonText("Install").onClick(async () => {
							button.setDisabled(true);
							button.setButtonText("Installing…");
							try {
								await this.onInstall(build);
								this.close();
								new Notice("Build installed. Reloading Obsidian…");
								const commands = (this.app as App & {
									commands: { executeCommandById: (id: string) => unknown };
								}).commands;
								void commands.executeCommandById("app:reload");
							} catch (error) {
								button.setDisabled(false);
								button.setButtonText("Install");
								new Notice(`Install failed: ${errorMessage(error)}`);
							}
						}),
					);
			}
		} catch (error) {
			status.setText(`Could not load builds: ${errorMessage(error)}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await requestUrl({
		url,
		method: "GET",
		throw: false,
		headers: { "User-Agent": "obsidian-git-sync-updater" },
	});
	if (response.status < 200 || response.status >= 300) {
		const error = new Error(response.text || `HTTP ${response.status}`) as Error & { status?: number };
		error.status = response.status;
		throw error;
	}
	try {
		return JSON.parse(response.text);
	} catch {
		throw new Error("GitHub returned an invalid update response.");
	}
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.replace(/^v/, "").split(".").map(Number);
	const rightParts = right.replace(/^v/, "").split(".").map(Number);
	if (leftParts.some(isNaN) || rightParts.some(isNaN)) return left === right ? 0 : 1;
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
		const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
		if (difference) return difference;
	}
	return 0;
}

function commitFromRelease(release: ReleaseInfo): string | null {
	return release.body.match(/\*\*Commit:\*\*\s*`([^`]+)`/)?.[1] ?? null;
}

function branchFromRelease(release: ReleaseInfo): string {
	const prefix = "latest-dev-";
	return release.tag_name.startsWith(prefix) ? release.tag_name.slice(prefix.length) : "main";
}

function errorStatus(error: unknown): number | undefined {
	return typeof error === "object" && error !== null && "status" in error
		? (error as { status?: number }).status
		: undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unexpected error.";
}
