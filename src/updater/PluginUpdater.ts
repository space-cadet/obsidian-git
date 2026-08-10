import { App, Modal, Notice, Setting, requestUrl } from 'obsidian';

export interface ReleaseAsset {
	name: string;
	browser_download_url: string;
	size?: number;
}

export interface ReleaseInfo {
	tag_name: string;
	name: string;
	body: string;
	prerelease: boolean;
	published_at: string;
	html_url: string;
	assets: ReleaseAsset[];
}

export interface UpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion: string;
	release: ReleaseInfo | null;
	isPrerelease: boolean;
	commitMatch?: boolean;
}

const GITHUB_REPO = 'space-cadet/obsidian-git';
const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];
const BACKUP_STATE_FILE = 'state.json';

/**
 * Compare the numeric portions of two plugin versions. Rolling development
 * tags such as `dev` are considered newer than a stable numeric version.
 */
export function compareVersions(version1: string, version2: string): number {
	const clean1 = version1.replace(/^v/, '');
	const clean2 = version2.replace(/^v/, '');
	const isSemver1 = /^\d+(\.\d+)*$/.test(clean1);
	const isSemver2 = /^\d+(\.\d+)*$/.test(clean2);

	if (!isSemver1 && isSemver2) return 1;
	if (isSemver1 && !isSemver2) return -1;
	if (!isSemver1 && !isSemver2) return clean1 === clean2 ? 0 : 1;

	const parts1 = clean1.split('.').map(Number);
	const parts2 = clean2.split('.').map(Number);
	for (let index = 0; index < Math.max(parts1.length, parts2.length); index += 1) {
		const part1 = parts1[index] || 0;
		const part2 = parts2[index] || 0;
		if (part1 !== part2) return part1 - part2;
	}
	return 0;
}

async function fetchJson(url: string): Promise<any> {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: { 'User-Agent': 'obsidian-git-sync-updater' },
	});
	return JSON.parse(response.text);
}

async function fetchLatestCommitSHA(branch = 'main'): Promise<string | null> {
	try {
		const data = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/commits/${branch}`);
		return typeof data?.sha === 'string' ? data.sha : null;
	} catch {
		return null;
	}
}

async function downloadFile(app: App, url: string, destination: string): Promise<void> {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: { 'User-Agent': 'obsidian-git-sync-updater' },
	});
	await app.vault.adapter.write(destination, response.text);
}

function hashesMatch(localHash: string, remoteHash: string): boolean {
	const local = localHash.trim().toLowerCase();
	const remote = remoteHash.trim().toLowerCase();
	if (!local || !remote || local === 'unknown' || remote === 'unknown') return false;
	return local.slice(0, 7) === remote.slice(0, 7);
}

export class PluginUpdater {
	private readonly app: App;
	private readonly pluginDir: string;

	constructor(app: App, pluginId: string) {
		this.app = app;
		this.pluginDir = `.obsidian/plugins/${pluginId}`;
	}

	private async ensureDir(path: string): Promise<void> {
		try {
			await this.app.vault.adapter.mkdir(path);
		} catch {
			// The directory may already exist.
		}
	}

	private async fileExists(path: string): Promise<boolean> {
		return this.app.vault.adapter.exists(path);
	}

	private async readFile(path: string): Promise<string> {
		return this.app.vault.adapter.read(path);
	}

	private async writeFile(path: string, data: string): Promise<void> {
		await this.app.vault.adapter.write(path, data);
	}

	private async removeFile(path: string): Promise<void> {
		const adapter = this.app.vault.adapter as any;
		if (typeof adapter.remove === 'function' && await this.fileExists(path)) {
			await adapter.remove(path);
		}
	}

	private async removeDirectory(path: string): Promise<void> {
		const adapter = this.app.vault.adapter as any;
		if (typeof adapter.rmdir === 'function') {
			try {
				await adapter.rmdir(path, true);
			} catch {
				// Temporary update files are best-effort cleanup only.
			}
		}
	}

	private async selectRelease(includePrerelease: boolean): Promise<ReleaseInfo | null> {
		if (!includePrerelease) {
			return await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
		}

		const releases = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`) as ReleaseInfo[];
		if (!Array.isArray(releases) || releases.length === 0) return null;
		// This repository uses a rolling `dev` release. Keep the fallback for
		// repositories that use a different prerelease tag.
		return releases.find((release) => release.tag_name === 'dev' && release.prerelease)
			?? releases.find((release) => release.prerelease)
			?? releases[0];
	}

	/** Check GitHub for a stable or development update. */
	async checkForUpdate(
		currentVersion: string,
		includePrerelease: boolean,
		currentCommitHash?: string,
	): Promise<UpdateCheckResult> {
		try {
			const release = await this.selectRelease(includePrerelease);
			if (!release) {
				return { hasUpdate: false, currentVersion, latestVersion: currentVersion, release: null, isPrerelease: false };
			}

			const latestVersion = release.tag_name.replace(/^v/, '');
			let commitMatch = false;
			if (includePrerelease && currentCommitHash) {
				const latestCommitSHA = await fetchLatestCommitSHA();
				if (latestCommitSHA) {
					commitMatch = hashesMatch(currentCommitHash, latestCommitSHA);
					if (commitMatch) {
						return {
							hasUpdate: false,
							currentVersion,
							latestVersion,
							release,
							isPrerelease: true,
							commitMatch: true,
						};
					}
				}
			}

			return {
				hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
				currentVersion,
				latestVersion,
				release,
				isPrerelease: release.prerelease,
				commitMatch,
			};
		} catch (error) {
			console.error('[PluginUpdater] Check failed:', error);
			return { hasUpdate: false, currentVersion, latestVersion: currentVersion, release: null, isPrerelease: false };
		}
	}

	/** Download required release assets using Obsidian's native HTTP and vault APIs. */
	async downloadUpdate(release: ReleaseInfo): Promise<string> {
		const tempDir = `${this.pluginDir}/.update-tmp-${Date.now()}`;
		await this.ensureDir(tempDir);

		for (const filename of RELEASE_FILES) {
			const asset = release.assets?.find((candidate) => candidate.name === filename);
			if (!asset) {
				throw new Error(`Release is missing ${filename}. Update the release workflow to publish direct plugin assets.`);
			}
			await downloadFile(this.app, asset.browser_download_url, `${tempDir}/${filename}`);
		}

		const manifest = JSON.parse(await this.readFile(`${tempDir}/manifest.json`));
		if (manifest.id !== this.pluginDir.split('/').pop()) {
			throw new Error('Downloaded update belongs to a different plugin.');
		}
		return tempDir;
	}

	private async readBackupState(backupDir: string): Promise<string[]> {
		const statePath = `${backupDir}/${BACKUP_STATE_FILE}`;
		if (!(await this.fileExists(statePath))) return RELEASE_FILES.slice();
		try {
			const state = JSON.parse(await this.readFile(statePath));
			return Array.isArray(state.existingFiles) ? state.existingFiles : RELEASE_FILES.slice();
		} catch {
			return RELEASE_FILES.slice();
		}
	}

	private async restoreFiles(backupDir: string, existingFiles: string[]): Promise<void> {
		for (const filename of RELEASE_FILES) {
			const backupPath = `${backupDir}/${filename}`;
			const destination = `${this.pluginDir}/${filename}`;
			if (existingFiles.includes(filename) && await this.fileExists(backupPath)) {
				await this.writeFile(destination, await this.readFile(backupPath));
			} else {
				await this.removeFile(destination);
			}
		}
	}

	/**
	 * Install an update transactionally. If any asset write fails, all plugin
	 * files are restored from the snapshot taken before installation started.
	 */
	async installUpdate(tempDir: string): Promise<void> {
		const backupDir = `${this.pluginDir}/.backup`;
		await this.ensureDir(backupDir);

		const existingFiles: string[] = [];
		for (const filename of RELEASE_FILES) {
			const currentPath = `${this.pluginDir}/${filename}`;
			const backupPath = `${backupDir}/${filename}`;
			if (await this.fileExists(currentPath)) {
				existingFiles.push(filename);
				await this.writeFile(backupPath, await this.readFile(currentPath));
			} else {
				await this.removeFile(backupPath);
			}
		}
		await this.writeFile(`${backupDir}/${BACKUP_STATE_FILE}`, JSON.stringify({ existingFiles }));

		try {
			for (const filename of RELEASE_FILES) {
				const source = `${tempDir}/${filename}`;
				if (!(await this.fileExists(source))) throw new Error(`Downloaded update is missing ${filename}.`);
				await this.writeFile(`${this.pluginDir}/${filename}`, await this.readFile(source));
			}
			await this.removeDirectory(tempDir);
		} catch (error: any) {
			try {
				await this.restoreFiles(backupDir, existingFiles);
			} catch (rollbackError) {
				console.error('[PluginUpdater] Automatic rollback failed:', rollbackError);
			}
			throw new Error(`Update installation failed and was rolled back: ${error?.message || String(error)}`);
		}
	}

	/** Restore the last successfully backed-up installation. */
	async rollback(): Promise<void> {
		const backupDir = `${this.pluginDir}/.backup`;
		if (!(await this.fileExists(backupDir))) throw new Error('No backup available for rollback');
		await this.restoreFiles(backupDir, await this.readBackupState(backupDir));
	}
}

/** Modal shown when a manual update requires confirmation. */
export class UpdateAvailableModal extends Modal {
	constructor(
		app: App,
		private readonly checkResult: UpdateCheckResult,
		private readonly onInstall: () => Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Update Available' });

		const info = contentEl.createDiv();
		info.createEl('p', { text: `Current version: ${this.checkResult.currentVersion}` });
		info.createEl('p', { text: `Latest version: ${this.checkResult.latestVersion}` });
		if (this.checkResult.isPrerelease) {
			info.createEl('p', { text: '⚠️ This is a pre-release (dev build).', cls: 'updater-prerelease-warning' });
		}

		if (this.checkResult.release?.body) {
			contentEl.createEl('h3', { text: 'Changelog' });
			contentEl.createDiv('updater-changelog').createEl('pre', { text: this.checkResult.release.body });
		}

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText('Install & Reload')
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Installing…');
					try {
						await this.onInstall();
						this.close();
						new Notice('✅ Update installed. Reloading Obsidian…');
						(this.app as any).commands.executeCommandById('app:reload');
					} catch (error: any) {
						button.setButtonText('Install & Reload');
						button.setDisabled(false);
						new Notice(`❌ Update failed: ${error?.message || String(error)}`);
					}
				}),
			)
			.addButton((button) => button.setButtonText('Skip').onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}
}
