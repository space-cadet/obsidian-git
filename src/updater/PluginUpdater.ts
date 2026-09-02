import { App, Modal, Notice, Setting, requestUrl } from 'obsidian';

/** Small logger interface so updater diagnostics use the plugin activity log. */
export interface UpdaterLogger {
	log?: (level: string, ...args: any[]) => void;
	debug?: (context: string, message: string, data?: any) => void;
	info?: (context: string, message: string, data?: any) => void;
	error?: (context: string, message: string, error?: Error) => void;
}

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

export interface AvailableBuild {
	release: ReleaseInfo;
	branch: string;
	commitHash?: string;
	commitMessage?: string;
	/** Git commit timestamp; release publication time is the fallback. */
	committedAt?: string;
}

export interface CommitInfo {
	sha: string;
	message: string;
	authorName: string;
	committedAt: string;
}

export interface UpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion: string;
	release: ReleaseInfo | null;
	isPrerelease: boolean;
	commitMatch?: boolean;
	latestCommit?: CommitInfo | null;
	error?: string;
}

const GITHUB_REPO = 'space-cadet/obsidian-git';
const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];
const BACKUP_STATE_FILE = 'state.json';
const UPDATE_REQUEST_TIMEOUT_MS = 30_000;

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

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}

async function requestUpdate(url: string, label: string): Promise<any> {
	return withTimeout(
		requestUrl({
			url,
			method: 'GET',
			headers: { 'User-Agent': 'obsidian-git-sync-updater' },
		}),
		UPDATE_REQUEST_TIMEOUT_MS,
		`Timed out downloading ${label}. Check your network connection and try again.`,
	);
}

async function fetchJson(url: string): Promise<any> {
	const response = await requestUpdate(url, 'the update information');
	if (response.status < 200 || response.status >= 300) {
		let message = `HTTP ${response.status}`;
		try {
			message = JSON.parse(response.text)?.message || message;
		} catch {
			// Keep the HTTP status when GitHub does not return JSON.
		}
		const error: any = new Error(message);
		error.status = response.status;
		throw error;
	}
	return JSON.parse(response.text);
}

async function fetchLatestCommit(branch = 'main'): Promise<CommitInfo | null> {
	try {
		const data = await fetchJson(
			`https://api.github.com/repos/${GITHUB_REPO}/commits/${encodeURIComponent(branch)}?_cb=${Date.now()}`,
		);
		if (!data?.sha) return null;
		return {
			sha: data.sha,
			message: data.commit?.message?.split('\n')[0] ?? '',
			authorName: data.commit?.author?.name ?? data.author?.login ?? '',
			committedAt: data.commit?.author?.date ?? data.commit?.committer?.date ?? '',
		};
	} catch {
		return null;
	}
}

async function downloadFile(app: App, url: string, destination: string, label: string): Promise<void> {
	const response = await requestUpdate(url, label);
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Download failed: HTTP ${response.status}`);
	}
	await withTimeout(
		app.vault.adapter.write(destination, response.text),
		UPDATE_REQUEST_TIMEOUT_MS,
		`Timed out writing ${label}. Check that the vault storage is available and try again.`,
	);
}

async function downloadBinary(url: string, label: string): Promise<Uint8Array> {
	const response = await requestUpdate(url, label);
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Download failed: HTTP ${response.status}`);
	}

	const binary = (response as any).arrayBuffer;
	if (binary instanceof ArrayBuffer) return new Uint8Array(binary);
	if (binary instanceof Uint8Array) return binary;
	if (typeof binary === 'function') return new Uint8Array(await binary.call(response));
	throw new Error('The downloaded release archive did not contain binary data.');
}

function readZipUint16(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readZipUint32(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		(bytes[offset + 3] << 24)
	) >>> 0;
}

function zipSignatureAt(bytes: Uint8Array, offset: number, signature: number): boolean {
	return readZipUint32(bytes, offset) === signature;
}

async function inflateZipEntry(bytes: Uint8Array): Promise<Uint8Array> {
	const DecompressionStreamImpl = (globalThis as any).DecompressionStream;
	if (!DecompressionStreamImpl) {
		throw new Error('The release archive is compressed. Install a build with direct plugin assets.');
	}
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamImpl('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read one plugin file from the ZIP format produced by scripts/build-archive.mjs. */
async function readZipEntry(archive: Uint8Array, filename: string): Promise<Uint8Array | null> {
	const minimumEndRecordOffset = Math.max(0, archive.length - 0xffff - 22);
	let endRecordOffset = -1;
	for (let offset = archive.length - 22; offset >= minimumEndRecordOffset; offset -= 1) {
		if (zipSignatureAt(archive, offset, 0x06054b50)) {
			endRecordOffset = offset;
			break;
		}
	}
	if (endRecordOffset < 0) throw new Error('The downloaded release archive is not a valid ZIP file.');

	const entryCount = readZipUint16(archive, endRecordOffset + 10);
	const centralDirectoryOffset = readZipUint32(archive, endRecordOffset + 16);
	let offset = centralDirectoryOffset;
	for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
		if (!zipSignatureAt(archive, offset, 0x02014b50)) {
			throw new Error('The downloaded release archive has an invalid directory.');
		}
		const compressionMethod = readZipUint16(archive, offset + 10);
		const compressedSize = readZipUint32(archive, offset + 20);
		const filenameLength = readZipUint16(archive, offset + 28);
		const extraLength = readZipUint16(archive, offset + 30);
		const commentLength = readZipUint16(archive, offset + 32);
		const localHeaderOffset = readZipUint32(archive, offset + 42);
		const entryName = new TextDecoder().decode(archive.slice(offset + 46, offset + 46 + filenameLength)).replace(/\\/g, '/');
		const matches = entryName === filename || entryName.endsWith(`/${filename}`);

		if (matches) {
			if (!zipSignatureAt(archive, localHeaderOffset, 0x04034b50)) {
				throw new Error(`The release archive entry for ${filename} is invalid.`);
			}
			const localFilenameLength = readZipUint16(archive, localHeaderOffset + 26);
			const localExtraLength = readZipUint16(archive, localHeaderOffset + 28);
			const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
			const compressed = archive.slice(dataStart, dataStart + compressedSize);
			if (compressionMethod === 0) return compressed;
			if (compressionMethod === 8) return await inflateZipEntry(compressed);
			throw new Error(`The release archive uses an unsupported compression method for ${filename}.`);
		}

		offset += 46 + filenameLength + extraLength + commentLength;
	}
	return null;
}

function branchFromRelease(release: ReleaseInfo): string {
	const prefix = 'latest-dev-';
	return release.tag_name.startsWith(prefix) ? release.tag_name.slice(prefix.length) : 'main';
}

export function releaseLabel(release: ReleaseInfo): string {
	const version = release.tag_name.replace(/^v/, '');
	if (!release.prerelease) return `Stable · ${version}`;
	if (release.tag_name === 'dev') return 'Dev · main';
	if (release.tag_name.startsWith('latest-dev-')) {
		return `Dev · ${branchFromRelease(release)}`;
	}
	return `Dev · ${version}`;
}

/** Extract the immutable source identity recorded in an automated release. */
export function commitInfoFromRelease(release: ReleaseInfo): CommitInfo | null {
	const sha = release.body?.match(/^\s*(?:-\s*)?(?:\*\*)?Commit:(?:\*\*)?\s*`?([^`\s]+)`?\s*$/im)?.[1];
	if (!sha) return null;
	const builtAt = release.body?.match(/^\s*(?:-\s*)?(?:\*\*)?(?:Built at|Timestamp):(?:\*\*)?\s*(.+)\s*$/im)?.[1]?.trim();
	const subject = release.body?.match(/^\s*(?:-\s*)?(?:\*\*)?(?:Subject|Commit message):(?:\*\*)?\s*`?(.+?)`?\s*$/im)?.[1]?.trim();
	return {
		sha,
		message: subject ?? '',
		authorName: 'GitHub Actions',
		committedAt: builtAt ?? release.published_at,
	};
}

export class PluginUpdater {
	private readonly app: App;
	private readonly pluginDir: string;
	private readonly logger: UpdaterLogger | null;

	constructor(app: App, pluginId: string, logger?: UpdaterLogger) {
		this.app = app;
		this.pluginDir = `.obsidian/plugins/${pluginId}`;
		this.logger = logger ?? null;
	}

	private log(level: string, ...args: any[]): void {
		if (this.logger) {
			if (this.logger.log) {
				this.logger.log(level, '[PluginUpdater]', ...args);
				return;
			}
			const message = args.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
			if (level === 'error' && this.logger.error) {
				this.logger.error('PluginUpdater', message);
			} else if (level === 'debug' && this.logger.debug) {
				this.logger.debug('PluginUpdater', message);
			} else if (this.logger.info) {
				this.logger.info('PluginUpdater', message);
			}
			return;
		}
		const fn = level === 'error' ? console.error : console.log;
		fn('[PluginUpdater]', ...args);
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
		return withTimeout(
			this.app.vault.adapter.read(path),
			UPDATE_REQUEST_TIMEOUT_MS,
			`Timed out reading ${path}. Check that the vault storage is available and try again.`,
		);
	}

	private async writeFile(path: string, data: string): Promise<void> {
		await withTimeout(
			this.app.vault.adapter.write(path, data),
			UPDATE_REQUEST_TIMEOUT_MS,
			`Timed out writing ${path}. Check that the vault storage is available and try again.`,
		);
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

	/** Remove temporary directories left by an interrupted earlier update. */
	private async cleanupStaleUpdateDirectories(): Promise<void> {
		const adapter = this.app.vault.adapter as any;
		if (typeof adapter.list !== 'function') return;

		try {
			const listed = await adapter.list(this.pluginDir);
			const prefix = `${this.pluginDir}/`;
			for (const folder of listed?.folders ?? []) {
				const normalized = String(folder).replace(/\\/g, '/');
				const name = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
				if (/^\.update-tmp-\d+$/.test(name)) {
					this.log('info', 'Removing stale updater folder:', normalized);
					await this.removeDirectory(normalized.startsWith(prefix) ? normalized : `${this.pluginDir}/${name}`);
				}
			}
		} catch (error) {
			// Cleanup should never prevent a new update from being attempted.
			this.log('debug', 'Could not inspect stale updater folders:', error);
		}
	}

	private async selectRelease(includePrerelease: boolean, currentBranch?: string): Promise<ReleaseInfo | null> {
		if (!includePrerelease) {
			return await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest?_cb=${Date.now()}`);
		}

		const releases = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30&_cb=${Date.now()}`) as ReleaseInfo[];
		if (!Array.isArray(releases) || releases.length === 0) return null;
		const branchRelease = currentBranch && currentBranch !== 'main'
			? releases.find((release) => release.tag_name === `latest-dev-${currentBranch}`)
			: undefined;
		// Prefer a branch build when one exists, then use this repository's rolling
		// main build. Keep a generic prerelease fallback for older releases.
		return branchRelease
			?? releases.find((release) => release.tag_name === 'dev' && release.prerelease)
			?? releases.find((release) => release.tag_name === 'latest-dev' && release.prerelease)
			?? releases.find((release) => release.prerelease)
			?? releases[0];
	}

	/** Check GitHub for a stable or development update. */
	async checkForUpdate(
		currentVersion: string,
		includePrerelease: boolean,
		currentCommitHash?: string,
		currentBranch?: string,
	): Promise<UpdateCheckResult> {
		this.log('info', 'checkForUpdate:', {
			currentVersion,
			includePrerelease,
			currentCommitHash: currentCommitHash?.slice(0, 7),
			currentBranch,
		});
		try {
			const release = await this.selectRelease(includePrerelease, currentBranch);
			if (!release) {
				return { hasUpdate: false, currentVersion, latestVersion: currentVersion, release: null, isPrerelease: false };
			}

			const latestVersion = release.tag_name.replace(/^v/, '');
			const latestCommit = includePrerelease
				? commitInfoFromRelease(release) ?? await fetchLatestCommit(branchFromRelease(release))
				: await fetchLatestCommit('main');
			this.log('info', 'latestCommit:', latestCommit?.sha?.slice(0, 7));
			let commitMatch = false;
			if (includePrerelease && currentCommitHash && latestCommit) {
				const shortLocal = currentCommitHash.slice(0, 7).toLowerCase();
				const shortRemote = latestCommit.sha.slice(0, 7).toLowerCase();
				commitMatch = shortLocal === shortRemote;
				this.log('info', 'commit compare:', shortLocal, 'vs', shortRemote, 'match:', commitMatch);
				if (commitMatch) {
					return {
						hasUpdate: false,
						currentVersion,
						latestVersion,
						release,
						isPrerelease: true,
						commitMatch: true,
						latestCommit,
					};
				}
			}

			// Rolling dev releases reuse one tag, so compare the recorded release
			// commit, or the branch head when older metadata has no commit line.
			const hasUpdate =
				includePrerelease && currentCommitHash
					? latestCommit ? !commitMatch : false
					: compareVersions(latestVersion, currentVersion) > 0;
			this.log('info', 'version compare:', latestVersion, 'vs', currentVersion, 'hasUpdate:', hasUpdate);

			return {
				hasUpdate,
				currentVersion,
				latestVersion,
				release,
				isPrerelease: release.prerelease,
				commitMatch,
				latestCommit,
			};
		} catch (error) {
			this.log('error', 'Check failed:', error);
			return {
				hasUpdate: false,
				currentVersion,
				latestVersion: currentVersion,
				release: null,
				isPrerelease: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/** Return every published stable and development build. */
	async listAvailableBuilds(): Promise<AvailableBuild[]> {
		const releases: ReleaseInfo[] = [];
		let page = 1;
		while (true) {
			const pageReleases = await fetchJson(
				`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}&_cb=${Date.now()}`,
			) as ReleaseInfo[];
			if (!Array.isArray(pageReleases) || pageReleases.length === 0) break;
			releases.push(...pageReleases);
			if (pageReleases.length < 100) break;
			page += 1;
		}
		return (releases ?? [])
			.map((release) => {
				const commitInfo = commitInfoFromRelease(release);
				return {
					release,
					branch: branchFromRelease(release),
					commitHash: commitInfo?.sha,
					commitMessage: commitInfo?.message,
					committedAt: commitInfo?.committedAt ?? release.published_at,
				};
			});
	}

	/** Download required release assets using Obsidian's native HTTP and vault APIs. */
	async downloadUpdate(release: ReleaseInfo): Promise<string> {
		const tempDir = `${this.pluginDir}/.update-tmp-${Date.now()}`;
		try {
			await this.cleanupStaleUpdateDirectories();
			await this.ensureDir(tempDir);

			const assets = release.assets ?? [];
			const directAssets = RELEASE_FILES.map((filename) => assets.find((asset) => asset.name === filename));
			if (directAssets.every((asset): asset is ReleaseAsset => Boolean(asset))) {
				for (let index = 0; index < RELEASE_FILES.length; index += 1) {
					const filename = RELEASE_FILES[index];
					this.log('info', 'Downloading update asset:', filename);
					await downloadFile(this.app, directAssets[index].browser_download_url, `${tempDir}/${filename}`, filename);
				}
			} else {
				const archive = assets.find((asset) => /\.zip$/i.test(asset.name));
				if (!archive) {
					const missing = RELEASE_FILES.filter((_, index) => !directAssets[index]).join(', ');
					throw new Error(`Release has no installable plugin assets (missing ${missing}). Publish direct plugin assets or a ZIP archive.`);
				}
				this.log('info', 'Downloading update archive:', archive.name);
				const archiveBytes = await downloadBinary(archive.browser_download_url, archive.name);
				for (const filename of RELEASE_FILES) {
					const contents = await readZipEntry(archiveBytes, filename);
					if (!contents) throw new Error(`Release archive is missing ${filename}.`);
					await this.writeFile(`${tempDir}/${filename}`, new TextDecoder().decode(contents));
				}
			}

			const manifest = JSON.parse(await this.readFile(`${tempDir}/manifest.json`));
			if (manifest.id !== this.pluginDir.split('/').pop()) {
				throw new Error('Downloaded update belongs to a different plugin.');
			}
			return tempDir;
		} catch (error) {
			await this.removeDirectory(tempDir);
			throw error;
		}
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
		} finally {
			await this.removeDirectory(tempDir);
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

		if (this.checkResult.latestCommit) {
			const commit = this.checkResult.latestCommit;
			contentEl.createEl('h3', { text: 'Build information' });
			const buildInfo = contentEl.createDiv('updater-build-info');
			const commitLink = buildInfo.createEl('a', {
				text: commit.sha.slice(0, 7),
				href: `https://github.com/${GITHUB_REPO}/commit/${commit.sha}`,
			});
			commitLink.setAttr('target', '_blank');
			buildInfo.createEl('span', { text: ` — ${commit.message || 'No commit message'}` });
			buildInfo.createEl('br');
			buildInfo.createEl('span', {
				text: `${commit.authorName ? `${commit.authorName} · ` : ''}${commit.committedAt ? new Date(commit.committedAt).toLocaleString() : 'Timestamp unavailable'}`,
			});
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

/** Modal for selecting any published stable or development build. */
export class AvailableBuildsModal extends Modal {
	private builds: AvailableBuild[] = [];

	constructor(
		app: App,
		private readonly updater: PluginUpdater,
		private readonly onInstall: (build: AvailableBuild) => Promise<void>,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Available builds' });
		contentEl.createEl('p', { text: 'Choose any published stable or development build to download and install.' });
		const status = contentEl.createEl('p', { text: 'Loading builds…' });

		try {
			this.builds = await this.updater.listAvailableBuilds();
			status.remove();
			if (this.builds.length === 0) {
				contentEl.createEl('p', { text: 'No published builds are currently available.' });
				return;
			}

			for (const build of this.builds) {
				const timestamp = build.committedAt
					? new Date(build.committedAt).toLocaleString()
					: new Date(build.release.published_at).toLocaleString();
				new Setting(contentEl)
					.setName(releaseLabel(build.release))
					.setDesc(`${build.commitMessage || build.release.name || 'Commit message unavailable'} · ${build.commitHash?.slice(0, 7) ?? 'commit unavailable'} · ${timestamp}`)
					.addButton((button) => button.setButtonText('Install').onClick(async () => {
						button.setDisabled(true);
						button.setButtonText('Installing…');
						try {
							await this.onInstall(build);
							this.close();
							new Notice('✅ Build installed. Reloading Obsidian…');
							(this.app as any).commands.executeCommandById('app:reload');
						} catch (error: any) {
							button.setDisabled(false);
							button.setButtonText('Install');
							new Notice(`❌ Install failed: ${error?.message || String(error)}`);
						}
					}));
			}
		} catch (error) {
			status.setText(`Could not load builds: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
