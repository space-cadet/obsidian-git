import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	Modal,
	WorkspaceLeaf,
	ButtonComponent,
	TextAreaComponent,
} from 'obsidian';
import { ObsidianFsAdapter } from './adapters/ObsidianFsAdapter';
import { GitManager, GitCredentials } from './gitManager';
import { log, LogLevel } from './logger';
import { FileLogger } from './fileLogger';
import { VIEW_TYPE_GIT_SIDEBAR, GitSidebarView } from './views/GitSidebarView';
import { AvailableBuildsModal, PluginUpdater, UpdateAvailableModal } from './updater/PluginUpdater';
import { GIT_BRANCH, GIT_COMMIT_HASH } from './buildInfo';
import {
	credentialStoreFromApp,
	createSecretId,
	CredentialStore,
	migrateLegacySecret,
} from './credentialStore';
import { OperationCoordinator } from './operationCoordinator';
import { DiagnosticLogLevel, renderDiagnosticsSection } from './settings-sections/diagnostics';

interface GitSyncSettings {
	repoUrl: string;
	branchName: string;
	username: string;
	passwordSecretId: string;
	author: {
		name: string;
		email: string;
	};
	autoSyncInterval: number; // in minutes, 0 means disabled
	autoCommitMessage: string;
	refreshInterval: number; // in seconds, 0 means disabled
	checkForUpdates: boolean;
	updateChannel: 'stable' | 'dev';
	lastUpdateCheck: number;
	autoUpdate: boolean;
	debugLogLevel: DiagnosticLogLevel;
	debugLogRetention: number;
	debugLogMaxSizeMB: number;
}

const DEFAULT_SETTINGS: GitSyncSettings = {
	repoUrl: '',
	branchName: 'main',
	username: '',
	passwordSecretId: '',
	author: {
		name: '',
		email: ''
	},
	autoSyncInterval: 0,
	autoCommitMessage: 'Vault backup: {{date}}',
	refreshInterval: 60, // default 60 seconds
	checkForUpdates: true,
	updateChannel: 'stable',
	lastUpdateCheck: 0,
	autoUpdate: false,
	debugLogLevel: 'error',
	debugLogRetention: 200,
	debugLogMaxSizeMB: 5,
};

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncSettings;
	fs: any;
	intervalId: number | null = null;
	gitManager: GitManager | null = null;
	statusBarItem: HTMLElement | null = null;
	isDesktop: boolean = false;
	private updater: PluginUpdater | null = null;
	fileLogger: FileLogger | null = null;
	private credentialStore: CredentialStore | null = null;
	private credentialStorageError: Error | null = null;
	private readonly operationCoordinator = new OperationCoordinator();

	async onload() {
		// Start persistent diagnostics before settings, updater, or remote work so
		// startup failures and update timing are available from debug.log.
		this.fileLogger = new FileLogger(this.app, this.manifest.id);
		await this.fileLogger.init();
		await this.loadSettings();
		this.setDiagnosticLogLevel(this.settings.debugLogLevel);
		this.setDiagnosticLogMaxSize(this.settings.debugLogMaxSizeMB);
		if (this.credentialStorageError) {
			new Notice(this.credentialStorageError.message);
		}

		// Detect platform
		this.isDesktop = typeof window !== 'undefined' && 
			!!(window as any).require && 
			!!(window as any).process;
		log.info('GitSyncPlugin', `Platform: ${this.isDesktop ? 'desktop (Electron)' : 'mobile (WebView)'}`);

		// Mobile: polyfill Buffer (required by isomorphic-git, not available in WebView)
		if (!this.isDesktop && typeof Buffer === 'undefined') {
			const { Buffer } = await import('buffer');
			(window as any).Buffer = Buffer;
			log.info('GitSyncPlugin', 'Buffer polyfill loaded for mobile');
		}

		// Configure logger
		log.setLogLevel(LogLevel.DEBUG); // Set to DEBUG during development, INFO for production
		log.info('GitSyncPlugin', 'Initializing Git Sync plugin');

		// Use Obsidian's native filesystem adapter (works on desktop + mobile)
		this.fs = new ObsidianFsAdapter(this.app.vault.adapter, '.').promises;
		log.debug('GitSyncPlugin', 'File system adapter initialized');

		// Add ribbon icon for manual sync
		const ribbonIconEl = this.addRibbonIcon('refresh-cw', 'Git Sync', async () => {
			log.info('GitSyncPlugin', 'Manual sync triggered from ribbon');
			try {
				await this.syncVault();
				new Notice('Git sync completed successfully');
			} catch (error) {
				log.error('GitSyncPlugin', 'Manual sync failed', error);
				new Notice(`Git sync failed: ${error.message}`);
			}
		});

		// Add ribbon icon to open Git sidebar
		const sidebarRibbonEl = this.addRibbonIcon('git-branch', 'Open Git Sidebar', async () => {
			this.activateGitSidebarView();
		});

		// Register the Git sidebar view
		this.registerView(VIEW_TYPE_GIT_SIDEBAR, (leaf) => new GitSidebarView(leaf, this));

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('Git: Ready');

		// Add settings tab
		this.addSettingTab(new GitSyncSettingTab(this.app, this));

		// Initialize the cross-platform GitHub updater.
		this.updater = new PluginUpdater(this.app, this.manifest.id, log);
		this.addCommand({
			id: 'git-sync-check-for-updates',
			name: 'Check for plugin updates',
			callback: () => this.checkForUpdates(true),
		});
		if (this.settings.checkForUpdates) {
			const oneDay = 24 * 60 * 60 * 1000;
			if (Date.now() - (this.settings.lastUpdateCheck || 0) > oneDay) {
				void this.checkForUpdates(false);
			}
		}

		// Register commands
		this.addCommand({
			id: 'git-sync-now',
			name: 'Sync now',
			callback: async () => {
				log.info('GitSyncPlugin', 'Manual sync triggered from command palette');
				try {
					await this.syncVault();
					new Notice('Git sync completed successfully');
				} catch (error: any) {
					log.error('GitSyncPlugin', 'Manual sync failed', error);
					new Notice(`Git sync failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'git-sync-pull',
			name: 'Pull from remote',
			callback: async () => {
				log.info('GitSyncPlugin', 'Pull triggered from command palette');
				try {
					await this.runGitMutation('Pull from remote', async (manager) => {
						await this.refreshGitCredentials();
						await manager.pull(this.settings.branchName);
					});
					new Notice('Git pull completed successfully');
				} catch (error: any) {
					log.error('GitSyncPlugin', 'Pull failed', error);
					new Notice(`Git pull failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'git-sync-push',
			name: 'Push to remote',
			callback: async () => {
				log.info('GitSyncPlugin', 'Push triggered from command palette');
				try {
					await this.runGitMutation('Push to remote', async (manager) => {
						await this.refreshGitCredentials();
						await manager.push(this.settings.branchName);
					});
					new Notice('Git push completed successfully');
				} catch (error: any) {
					log.error('GitSyncPlugin', 'Push failed', error);
					new Notice(`Git push failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'git-sync-status',
			name: 'Show repository status',
			callback: async () => {
				log.info('GitSyncPlugin', 'Status check triggered from command palette');
				try {
					const health = await this.checkRepositoryHealth();
					if (health.state === 'missing') {
						new Notice('No git repository found');
						return;
					}
					if (health.state === 'damaged') {
						new Notice('Git repository metadata is damaged. Use the rebuild comparison before repairing it.');
						return;
					}
					if (!this.gitManager) return;
					const status = await this.gitManager.getStatus();
					new Notice(`Git status: ${status.branch} — ${status.ahead} ahead, ${status.behind} behind`);
				} catch (error: any) {
					log.error('GitSyncPlugin', 'Status check failed', error);
					new Notice(`Git status failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'git-sync-preview-repository-rebuild',
			name: 'Preview repository rebuild',
			callback: async () => {
				try {
					const preview = await this.previewRepositoryRebuild();
					new Notice(
						`Rebuild preview: ${preview.conflicts.length} conflicts, ` +
						`${preview.remoteOnly.length} remote-only, ${preview.localOnly.length} local-only, ` +
						`${preview.unchanged.length} unchanged.`,
					);
				} catch (error: any) {
					log.error('GitSyncPlugin', 'Repository rebuild preview failed', error);
					new Notice(`Rebuild preview failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'git-sync-test-compatibility',
			name: 'Run compatibility diagnostics',
			callback: async () => {
				await this.runCompatibilityDiagnostics();
			}
		});

		this.addCommand({
			id: 'git-sync-open-sidebar',
			name: 'Open Git sidebar',
			callback: async () => {
				await this.activateGitSidebarView();
			}
		});

		this.addCommand({
			id: 'git-sync-open-gitignore',
			name: 'Open .gitignore',
			callback: async () => {
				await this.openGitIgnore();
			}
		});

		this.addCommand({
			id: 'git-sync-export-logs',
			name: 'Export debug logs',
			callback: async () => {
				try {
					const path = await log.exportToFile(this.app.vault);
					new Notice(`Debug log exported to ${path}`);
				} catch (error: any) {
					new Notice(`Export failed: ${error.message}`);
				}
			}
		});

		this.addCommand({
			id: 'git-sync-clear-debug-log',
			name: 'Clear debug log file',
			callback: async () => {
				await this.fileLogger?.clear();
				new Notice('Debug log cleared.');
			},
		});

		this.setupAutoSync();
	}

	onunload() {
		this.clearAutoSync();
		this.operationCoordinator.dispose();
		this.fileLogger?.stop();
		this.fileLogger = null;
	}

	async loadSettings() {
		const stored = (await this.loadData()) || {};
		const legacyPassword = typeof stored.password === 'string' ? stored.password : '';
		const { password: _password, ...withoutPassword } = stored;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, withoutPassword);
		if (!['off', 'error', 'info', 'debug'].includes(this.settings.debugLogLevel)) {
			this.settings.debugLogLevel = DEFAULT_SETTINGS.debugLogLevel;
		}
		if (!Number.isFinite(this.settings.debugLogRetention) || this.settings.debugLogRetention <= 0) {
			this.settings.debugLogRetention = DEFAULT_SETTINGS.debugLogRetention;
		}
		if (!Number.isFinite(this.settings.debugLogMaxSizeMB) || this.settings.debugLogMaxSizeMB <= 0) {
			this.settings.debugLogMaxSizeMB = DEFAULT_SETTINGS.debugLogMaxSizeMB;
		}
		// The sidebar has one compact layout. Migrate settings written by the
		// short-lived comfortable/compact toggle so old data cannot restore the
		// oversized header.
		delete (this.settings as any).sidebarDensity;
		if (!this.settings.passwordSecretId) {
			this.settings.passwordSecretId = createSecretId(this.app.vault.getName?.() || 'default');
		}

		try {
			this.credentialStore = credentialStoreFromApp(this.app, this.settings.passwordSecretId);
			if (await migrateLegacySecret(this.credentialStore, legacyPassword, async () => {
				await this.saveData(this.settings);
			})) {
				log.info('GitSyncPlugin', 'Migrated the legacy Git credential to secure storage');
			}
		} catch (error: any) {
			this.credentialStorageError = error instanceof Error ? error : new Error(String(error));
			log.warn('GitSyncPlugin', 'Secure credential storage is unavailable; remote operations are disabled');
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.setupAutoSync(); // Reconfigure auto sync with new settings
	}

	setDiagnosticLogLevel(level: DiagnosticLogLevel): void {
		const levels: Record<DiagnosticLogLevel, LogLevel> = {
			off: LogLevel.ERROR,
			error: LogLevel.ERROR,
			info: LogLevel.INFO,
			debug: LogLevel.DEBUG,
		};
		log.setLogLevel(levels[level]);
	}

	setDiagnosticLogMaxSize(maxSizeMB: number): void {
		this.fileLogger?.setMaxSize(maxSizeMB * 1024 * 1024);
	}

	private requireCredentialStore(): CredentialStore {
		if (!this.credentialStore) {
			this.credentialStore = credentialStoreFromApp(this.app, this.settings.passwordSecretId);
			this.credentialStorageError = null;
		}
		return this.credentialStore;
	}

	async resolveGitPassword(): Promise<string> {
		if (!this.settings.repoUrl) return '';
		return this.requireCredentialStore().get();
	}

	async getGitCredentials(resolveSecret = true): Promise<GitCredentials> {
		const credentials = {
			username: this.settings.username,
			password: resolveSecret ? await this.resolveGitPassword() : '',
			repoUrl: this.settings.repoUrl,
			author: {
				name: this.settings.author.name || 'Obsidian Git User',
				email: this.settings.author.email || 'user@example.com',
			},
		};
		log.setSensitiveValues([credentials.password]);
		this.fileLogger?.setSensitiveValues([credentials.password]);
		return credentials;
	}

	async refreshGitCredentials(): Promise<void> {
		if (this.gitManager) this.gitManager.updateCredentials(await this.getGitCredentials());
	}

	async setGitCredential(value: string): Promise<void> {
		this.requireCredentialStore().set(value);
		await this.saveSettings();
	}

	async checkForUpdates(manual: boolean): Promise<void> {
		if (!this.updater) return;
		const startedAt = performance.now();
		log.info('Updater', 'Update check started', {
			manual,
			channel: this.settings.updateChannel,
			currentVersion: this.manifest.version,
		});

		try {
			const result = await this.updater.checkForUpdate(
				this.manifest.version,
				this.settings.updateChannel === 'dev',
				GIT_COMMIT_HASH,
				GIT_BRANCH,
			);
			this.settings.lastUpdateCheck = Date.now();
			const saveStartedAt = performance.now();
			log.debug('Updater', 'Saving update-check timestamp');
			await this.saveSettings();
			log.info('Updater', 'Update-check timestamp saved', {
				elapsedMs: Math.round(performance.now() - saveStartedAt),
			});
			log.info('Updater', 'Update check completed', {
				manual,
				hasUpdate: result.hasUpdate,
				latestVersion: result.latestVersion,
				elapsedMs: Math.round(performance.now() - startedAt),
			});

			if (result.error) {
				if (manual) {
					new Notice(`❌ Update check failed: ${result.error}`);
				}
				return;
			}

			if (!result.hasUpdate || !result.release) {
				if (manual) {
					new Notice(`✅ Git Sync is up to date (${result.currentVersion})`);
				}
				return;
			}

			if (this.settings.autoUpdate && !result.isPrerelease) {
				new Notice(`📦 Downloading update ${result.latestVersion}…`);
				const tempDir = await this.updater.downloadUpdate(result.release);
				await this.updater.installUpdate(tempDir);
				new Notice(`✅ Update ${result.latestVersion} installed. Reload Obsidian to apply.`);
				return;
			}

			const modal = new UpdateAvailableModal(this.app, result, async () => {
				const tempDir = await this.updater!.downloadUpdate(result.release!);
				await this.updater!.installUpdate(tempDir);
			});
			modal.open();
		} catch (error: any) {
			log.error('Updater', 'Update check failed', error);
			log.error('GitSyncPlugin', 'Update check failed', error);
			if (manual) {
				new Notice(`❌ Update check failed: ${error?.message || String(error)}`);
			}
		}
	}

	async showAvailableBuilds(): Promise<void> {
		if (!this.updater) return;
		new AvailableBuildsModal(
			this.app,
			this.updater,
			async (build) => {
				const tempDir = await this.updater!.downloadUpdate(build.release);
				await this.updater!.installUpdate(tempDir);
			},
		).open();
	}

	setupAutoSync() {
		// Clear any existing interval
		this.clearAutoSync();

		// Set up new interval if enabled
		if (this.settings.autoSyncInterval > 0) {
			const intervalMs = this.settings.autoSyncInterval * 60 * 1000;
			this.intervalId = window.setInterval(async () => {
				try {
					if (!(await this.detectRealGitRepo())) return;
					await this.syncVault();
					log.info('GitSyncPlugin', 'Auto sync completed');
				} catch (error) {
					log.error('GitSyncPlugin', 'Auto sync failed', error as Error);
				}
			}, intervalMs);
		}
	}

	clearAutoSync() {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	async activateGitSidebarView(): Promise<void> {
		const { workspace } = this.app;
		
		// Check if view is already open
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_GIT_SIDEBAR);
		if (leaves.length > 0) {
			// Reveal existing view
			workspace.revealLeaf(leaves[0]);
			return;
		}
		
		// Open new leaf in right sidebar
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_GIT_SIDEBAR });
			workspace.revealLeaf(leaf);
		} else {
			new Notice('Failed to open Git sidebar');
		}
	}

	/**
	 * Open the repository's .gitignore even though Obsidian does not expose
	 * dotfiles in the file explorer. Create it on demand for new repositories.
	 */
	async openGitIgnore(): Promise<void> {
		// Always use the adapter-backed editor. Obsidian may expose a hidden
		// .gitignore in its file index on one platform but not another, and
		// opening that indexed TFile is unreliable on mobile. Open the modal
		// immediately while the provider-backed read happens in the editor.
		new GitIgnoreEditorModal(this.app, () => this.readGitIgnore(), async (updatedContent) => {
			await this.app.vault.adapter.write('.gitignore', updatedContent);
			new Notice('Saved .gitignore');
		}).open();
	}

	/**
	 * Add a Git ignore pattern without requiring the user to navigate to the
	 * hidden .gitignore file manually.
	 */
	async addGitIgnorePattern(pattern: string): Promise<boolean> {
		const normalizedPattern = pattern.trim();
		if (!normalizedPattern || normalizedPattern.startsWith('#')) {
			throw new Error('Enter a non-empty ignore pattern');
		}

		const current = await this.readGitIgnore();
		const lines = current.split(/\r?\n/);
		if (lines.includes(normalizedPattern)) return false;

		const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
		await this.app.vault.adapter.write('.gitignore', `${current}${separator}${normalizedPattern}\n`);
		return true;
	}

	private async readGitIgnore(): Promise<string> {
		const adapter = this.app.vault.adapter;
		// Read the adapter directly first. Some mobile vault indexes report a
		// hidden file as absent even though the underlying adapter can read it.
		try {
			return await adapter.read('.gitignore');
		} catch (error: any) {
			if (await adapter.exists('.gitignore')) throw error;
			await adapter.write('.gitignore', '');
			new Notice('Created .gitignore');
			return '';
		}
	}

	async ensureGitManager(requireRemote: boolean = false): Promise<GitManager | null> {
		if (this.gitManager) return this.gitManager;

		const vaultPath = '.';
		
		const hasRepo = await this.detectRealGitRepo();
		if (!hasRepo && requireRemote && !this.settings.repoUrl) {
			log.warn('GitSyncPlugin', 'No .git repo found in vault');
			return null;
		}

		if (!this.settings.repoUrl && requireRemote) {
			return null;
		}

		const credentials = await this.getGitCredentials(false);

		// Status bar is optional (may be null on mobile)
		const statusEl = this.statusBarItem || undefined;

		this.gitManager = new GitManager(this.fs, vaultPath, credentials, this.app, statusEl);
		
		return this.gitManager;
	}

	/** Run one repository mutation through the shared lifecycle boundary. */
	async runGitMutation<T>(
		name: string,
		operation: (manager: GitManager, signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		return this.operationCoordinator.run(name, async ({ signal }) => {
			const manager = await this.ensureGitManager();
			if (!manager) throw new Error('No git repository found in vault');
			if (signal.aborted) {
				const error = new Error('Git operation cancelled');
				error.name = 'AbortError';
				throw error;
			}
			manager.setOperationSignal(signal);
			try {
				return await operation(manager, signal);
			} finally {
				if (this.gitManager === manager) manager.setOperationSignal(null);
			}
		});
	}

	async checkRepositoryHealth(): Promise<import('./gitManager').RepositoryHealth> {
		const manager = await this.ensureGitManager();
		if (!manager) {
			return {
				state: 'missing',
				exists: false,
				healthy: false,
				branch: null,
				hasCommits: false,
				reason: 'missing .git directory',
			};
		}
		return manager.checkRepositoryHealth();
	}

	async previewRepositoryRebuild(): Promise<import('./gitManager').RepositoryRebuildPreview> {
		return this.runGitMutation('Preview repository rebuild', async (manager) => {
			await this.refreshGitCredentials();
			if (!this.settings.repoUrl) throw new Error('Set a remote repository URL before comparing a rebuild.');
			return manager.previewRepositoryRebuild(this.settings.repoUrl, this.settings.branchName);
		});
	}

	/**
	 * Initialize a new git repository in the vault (git init)
	 */
	async initializeNewRepo(): Promise<void> {
		await this.runGitMutation('Initialize repository', async (manager) => {
			try {
				const git = await import('isomorphic-git');
				await git.init({ fs: this.fs, dir: '.', defaultBranch: this.settings.branchName || 'main' });
				log.info('GitSyncPlugin', 'New git repository initialized in vault');
				new Notice('New git repository initialized');
			} catch (e: any) {
				log.error('GitSyncPlugin', 'Failed to initialize repo', e);
				throw new Error('Failed to initialize repo: ' + e.message);
			}
		});
	}

	/**
	 * Detect if vault has a real .git repo — platform aware
	 * Desktop: tries Node.js fs first (most reliable), then adapter, then findRoot
	 * Mobile: skips Node fs, uses adapter methods + findRoot
	 */
	async detectRealGitRepo(): Promise<boolean> {
		const adapter = this.app.vault.adapter;

		// DESKTOP: Node.js fs is the most reliable method
		if (this.isDesktop) {
			try {
				const nodeRequire = (window as any).require;
				const nodeFs = nodeRequire('fs');
				const nodePath = nodeRequire('path');
				const basePath = (adapter as any).getBasePath?.();
				if (basePath) {
					const gitPath = nodePath.join(basePath, '.git');
					await nodeFs.promises.access(gitPath);
					log.debug('GitSyncPlugin', 'detectRealGitRepo: desktop Node fs found .git');
					return true;
				}
			} catch (e) {
				log.debug('GitSyncPlugin', 'detectRealGitRepo: desktop Node fs failed, trying adapter');
			}
		}

		// ALL PLATFORMS: Obsidian adapter methods
		try {
			await adapter.read('.git/HEAD');
			log.debug('GitSyncPlugin', 'detectRealGitRepo: adapter.read .git/HEAD succeeded');
			return true;
		} catch (e) {
			// .git/HEAD not readable
		}

		try {
			const stat = await adapter.stat('.git');
			if (stat && stat.type === 'folder') {
				log.debug('GitSyncPlugin', 'detectRealGitRepo: adapter.stat .git succeeded');
				return true;
			}
		} catch (e) {
			// .git not found via stat
		}

		// LAST RESORT: isomorphic-git findRoot (works on both platforms)
		try {
			const git = await import('isomorphic-git');
			// findRoot expects a FILE path — it walks up the tree looking for .git
			const root = await git.findRoot({ fs: this.fs, filepath: 'dummy.txt' });
			if (root !== undefined) {
				log.debug('GitSyncPlugin', 'detectRealGitRepo: findRoot found repo at', root);
				return true;
			}
		} catch (e) {
			log.debug('GitSyncPlugin', 'detectRealGitRepo: findRoot failed');
		}

		return false;
	}

	async syncVault(initializeRepository = false) {
		return this.runGitMutation(initializeRepository ? 'Clone or initialize repository' : 'Sync vault', async (manager) => {
			const commitMessage = this.settings.autoCommitMessage.replace(
				'{{date}}',
				new Date().toLocaleString(),
			);

			// Resolve the current secret immediately before initialization or sync.
			await this.refreshGitCredentials();

			if (initializeRepository) {
				await manager.initializeRepo(this.settings.repoUrl, this.settings.branchName);
			} else if (!(await this.checkRepositoryHealth()).healthy) {
				throw new Error('Local git repository is missing or damaged. Use Clone Remote or repair it first.');
			}

			await manager.sync(this.settings.repoUrl, this.settings.branchName, commitMessage);
			return true;
		});
	}

	/**
	 * Run platform and git compatibility diagnostics
	 * Reports: platform, fs capabilities, repo detection, git init test
	 */
	async runCompatibilityDiagnostics(): Promise<void> {
		const results: string[] = [];
		
		// 1. Platform detection
		results.push(`Platform: ${this.isDesktop ? 'desktop (Electron)' : 'mobile (WebView)'}`);
		results.push(`window.require: ${typeof window !== 'undefined' && !!(window as any).require ? 'yes' : 'no'}`);
		results.push(`window.process: ${typeof window !== 'undefined' && !!(window as any).process ? 'yes' : 'no'}`);
		
		// 2. Node.js fs availability (desktop only)
		if (this.isDesktop) {
			try {
				const nodeRequire = (window as any).require;
				const nodeFs = nodeRequire('fs');
				const basePath = (this.app.vault.adapter as any).getBasePath?.();
				results.push(`Node fs: available`);
				results.push(`Vault basePath: ${basePath || 'unknown'}`);
				if (basePath) {
					const gitPath = nodeRequire('path').join(basePath, '.git');
					try {
						await nodeFs.promises.access(gitPath);
						results.push(`Node fs .git check: found`);
					} catch (e) {
						results.push(`Node fs .git check: not found`);
					}
				}
			} catch (e) {
				results.push(`Node fs: error — ${(e as Error).message}`);
			}
		} else {
			results.push(`Node fs: not available (mobile)`);
		}
		
		// 3. Obsidian adapter checks
		const adapter = this.app.vault.adapter;
		try {
			await adapter.read('.git/HEAD');
			results.push(`Adapter .git/HEAD: readable`);
		} catch (e) {
			results.push(`Adapter .git/HEAD: not readable`);
		}
		
		try {
			const stat = await adapter.stat('.git');
			results.push(`Adapter .git stat: ${stat ? 'found (' + stat.type + ')' : 'null'}`);
		} catch (e) {
			results.push(`Adapter .git stat: not found`);
		}
		
		// 4. isomorphic-git findRoot test
		try {
			const git = await import('isomorphic-git');
			const root = await git.findRoot({ fs: this.fs, filepath: 'dummy.txt' });
			results.push(`findRoot: found at '${root}'`);
		} catch (e) {
			results.push(`findRoot: not found`);
		}
		
		// 5. Repo detection result
		const hasRepo = await this.detectRealGitRepo();
		results.push(`Repo detected: ${hasRepo ? 'YES' : 'NO'}`);
		
		// 6. Git init test (creates and destroys a test repo)
		try {
			const git = await import('isomorphic-git');
			const testDir = '.obsidian-git-test-' + Date.now();
			await this.fs.mkdir(testDir, { recursive: true });
			await git.init({ fs: this.fs, dir: testDir, defaultBranch: 'main' });
			const testRoot = await git.findRoot({ fs: this.fs, filepath: testDir + '/dummy.txt' });
			results.push(`Git init test: ${testRoot ? 'PASS' : 'FAIL'}`);
			// Cleanup: remove .obsidian-git-test-* directories
			const entries = await this.fs.readdir('.', { encoding: 'utf8' });
			for (const entry of entries) {
				if (entry.startsWith('.obsidian-git-test-')) {
					try {
						await this.fs.rmdir(entry, { recursive: true });
					} catch (e) { /* ignore cleanup errors */ }
				}
			}
		} catch (e) {
			results.push(`Git init test: FAIL — ${(e as Error).message}`);
		}
		
		// Show results
		const message = results.join('\n');
		log.info('GitSyncPlugin', 'Diagnostics:\n' + message);
		
		// Display in a modal
		const modal = new Modal(this.app);
		modal.titleEl.setText('Git Sync Diagnostics');
		modal.contentEl.createEl('pre', { text: message, cls: 'git-diagnostics' });
		modal.open();
	}
}

class GitIgnoreEditorModal extends Modal {
	private viewportCleanup: (() => void) | null = null;

	constructor(
		app: App,
		private readonly loadContent: () => Promise<string>,
		private readonly onSave: (content: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('git-ignore-editor-modal');
		this.contentEl.addClass('git-ignore-editor-content');
		this.titleEl.setText('Edit .gitignore');

		this.contentEl.createEl('p', {
			text: 'Obsidian hides dotfiles from its file index, so this editor writes directly to the vault.',
			cls: 'git-ignore-editor-description',
		});

		const editor = new TextAreaComponent(this.contentEl)
			.setPlaceholder('Loading .gitignore…');
		editor.inputEl.addClass('git-ignore-editor-textarea');
		editor.inputEl.rows = 16;
		editor.inputEl.disabled = true;
		editor.inputEl.setAttribute('aria-busy', 'true');

		const actions = this.contentEl.createDiv('git-ignore-modal-actions');
		new ButtonComponent(actions)
			.setButtonText('Cancel')
			.setClass('git-btn-ghost')
			.onClick(() => this.close());

		const saveButton = new ButtonComponent(actions)
			.setButtonText('Save')
			.setClass('git-btn-primary');
		saveButton.setDisabled(true);
		saveButton.onClick(async () => {
			if (editor.inputEl.disabled) return;
			saveButton.setDisabled(true);
			saveButton.setButtonText('Saving…');
			try {
				await this.onSave(editor.getValue());
				this.close();
			} catch (error: any) {
				new Notice(`Could not save .gitignore: ${error?.message || String(error)}`);
				saveButton.setDisabled(false);
				saveButton.setButtonText('Save');
			}
		});

		this.setupKeyboardViewport(editor);
		void this.loadEditorContent(editor, saveButton);
	}

	private async loadEditorContent(editor: TextAreaComponent, saveButton: ButtonComponent): Promise<void> {
		try {
			const content = await this.loadContent();
			if (!editor.inputEl.isConnected) return;
			editor.setValue(content);
			editor.inputEl.disabled = false;
			editor.inputEl.removeAttribute('aria-busy');
			saveButton.setDisabled(false);
			this.openEditorWhenReady(editor);
		} catch (error: any) {
			if (!editor.inputEl.isConnected) return;
			editor.inputEl.placeholder = 'Could not load .gitignore';
			editor.inputEl.removeAttribute('aria-busy');
			new Notice(`Could not load .gitignore: ${error?.message || String(error)}`);
		}
	}

	private setupKeyboardViewport(editor: TextAreaComponent): void {
		const visualViewport = (window as Window & { visualViewport?: VisualViewport }).visualViewport;
		const adjust = () => {
			const height = visualViewport?.height ?? window.innerHeight;
			this.modalEl.style.setProperty('--git-ignore-viewport-height', `${Math.max(220, height)}px`);
			if (document.activeElement === editor.inputEl) {
				this.scrollEditorIntoView(editor.inputEl);
			}
		};

		visualViewport?.addEventListener('resize', adjust);
		visualViewport?.addEventListener('scroll', adjust);
		window.addEventListener('resize', adjust);
		this.viewportCleanup = () => {
			visualViewport?.removeEventListener('resize', adjust);
			visualViewport?.removeEventListener('scroll', adjust);
			window.removeEventListener('resize', adjust);
		};
		adjust();
	}

	private scrollEditorIntoView(editor: HTMLTextAreaElement): void {
		window.requestAnimationFrame(() => {
			if (document.activeElement === editor) {
				editor.scrollIntoView({block: 'nearest', inline: 'nearest'});
			}
		});
	}

	private openEditorWhenReady(editor: TextAreaComponent): void {
		window.setTimeout(() => {
			editor.inputEl.focus();
			editor.inputEl.setSelectionRange(0, 0);
			this.scrollEditorIntoView(editor.inputEl);
		}, 0);
	}

	onClose(): void {
		this.viewportCleanup?.();
		this.viewportCleanup = null;
		this.contentEl.empty();
	}
}

class GitSyncSettingTab extends PluginSettingTab {
	plugin: GitSyncPlugin;

	constructor(app: App, plugin: GitSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Git Sync Settings'});

		new Setting(containerEl)
			.setName('Repository URL')
			.setDesc('The URL of your Git repository')
			.addText(text => text
				.setPlaceholder('https://github.com/username/repo.git')
				.setValue(this.plugin.settings.repoUrl)
				.onChange(async (value) => {
					this.plugin.settings.repoUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Branch')
			.setDesc('The branch to sync with')
			.addText(text => text
				.setPlaceholder('main')
				.setValue(this.plugin.settings.branchName)
				.onChange(async (value) => {
					this.plugin.settings.branchName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Git username (optional when using a Personal Access Token)')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password / Personal Access Token')
			.setDesc('Stored in Obsidian secure storage. Leave blank to keep the current credential.')
			.addText(text => {
				const input = text
					.setPlaceholder('Enter to add or replace credential')
					.onChange(async (value: string) => {
						try {
							await this.plugin.setGitCredential(value);
							new Notice(value ? 'Credential stored securely' : 'Stored credential cleared');
						} catch (error: any) {
							log.error('GitSyncPlugin', 'Failed to store Git credential', error);
							new Notice(error?.message || 'Secure credential storage is unavailable');
						}
					});
				
				// Force password type immediately
				input.inputEl.type = 'password';
				
				return input;
			})
			.addExtraButton(button => {
				button
					.setIcon('eye')
					.setTooltip('Show/hide token')
					.onClick(() => {
						const setting = button.extraSettingsEl.closest('.setting-item') as HTMLElement;
						const input = setting?.querySelector('input') as HTMLInputElement;
						if (input) {
							input.type = input.type === 'password' ? 'text' : 'password';
							button.setIcon(input.type === 'password' ? 'eye' : 'eye-off');
						}
					});
			});

		new Setting(containerEl)
			.setName('Author Name')
			.setDesc('Your name for Git commits')
			.addText(text => text
				.setPlaceholder('Your Name')
				.setValue(this.plugin.settings.author.name)
				.onChange(async (value) => {
					this.plugin.settings.author.name = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Author Email')
			.setDesc('Your email for Git commits')
			.addText(text => text
				.setPlaceholder('your.email@example.com')
				.setValue(this.plugin.settings.author.email)
				.onChange(async (value) => {
					this.plugin.settings.author.email = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto Sync Interval')
			.setDesc('How often to automatically sync (in minutes, 0 to disable)')
			.addText(text => text
				.setPlaceholder('0')
				.setValue(String(this.plugin.settings.autoSyncInterval))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue) && numValue >= 0) {
						this.plugin.settings.autoSyncInterval = numValue;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Auto Commit Message')
			.setDesc('Message for automatic commits. Use {{date}} for current date/time')
			.addText(text => text
				.setPlaceholder('Vault backup: {{date}}')
				.setValue(this.plugin.settings.autoCommitMessage)
				.onChange(async (value) => {
					this.plugin.settings.autoCommitMessage = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sidebar Refresh Interval')
			.setDesc('How often to auto-refresh the sidebar (in seconds, 0 to disable)')
			.addText(text => text
				.setPlaceholder('60')
				.setValue(String(this.plugin.settings.refreshInterval))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue) && numValue >= 0) {
						this.plugin.settings.refreshInterval = numValue;
						await this.plugin.saveSettings();
						// Restart sidebar refresh with new interval
						const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_SIDEBAR);
						for (const leaf of leaves) {
							if (leaf.view instanceof GitSidebarView) {
								(leaf.view as GitSidebarView).updateRefreshInterval(numValue);
							}
						}
						}
					}));

		containerEl.createEl('h3', { text: 'Plugin Updates' });
		let updateVersionLabel: () => void = () => undefined;

		new Setting(containerEl)
			.setName('Check for updates on startup')
			.setDesc('Check GitHub once per day for a newer Git Sync release.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.checkForUpdates)
				.onChange(async value => {
					this.plugin.settings.checkForUpdates = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Release channel')
			.setDesc('Stable releases are tested builds. Dev builds contain the latest main-branch changes.')
			.addDropdown(dropdown => dropdown
				.addOption('stable', 'Stable')
				.addOption('dev', 'Dev (pre-release)')
				.setValue(this.plugin.settings.updateChannel)
				.onChange(async value => {
					this.plugin.settings.updateChannel = value as 'stable' | 'dev';
					await this.plugin.saveSettings();
					updateVersionLabel();
				}));

		new Setting(containerEl)
			.setName('Auto-install stable updates')
			.setDesc('Install stable updates without prompting. Dev updates always require confirmation.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoUpdate)
				.onChange(async value => {
					this.plugin.settings.autoUpdate = value;
					await this.plugin.saveSettings();
					if (value) new Notice('Auto-update enabled for stable releases.');
					}));

		new Setting(containerEl)
			.setName('Available builds')
			.setDesc('Browse and install any published stable or development build.')
			.addButton(button => button
				.setButtonText('Browse builds')
				.onClick(() => this.plugin.showAvailableBuilds()));

		const versionSetting = new Setting(containerEl)
			.setName('Current plugin version')
			.addButton(button => button
				.setButtonText('Check Now')
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Checking…');
					await this.plugin.checkForUpdates(true);
					button.setButtonText('Check Now');
					button.setDisabled(false);
				}));
		const displayedCommit = GIT_COMMIT_HASH !== 'unknown'
			? GIT_COMMIT_HASH.slice(0, 7)
			: 'unknown';
		updateVersionLabel = () => {
			versionSetting.setDesc(
				`${this.plugin.manifest.version} (${this.plugin.settings.updateChannel} channel) — commit ${displayedCommit}`,
			);
			versionSetting.descEl.setAttr('title', `Full commit: ${GIT_COMMIT_HASH}`);
		};
		updateVersionLabel();

		if (this.plugin.settings.lastUpdateCheck > 0) {
			containerEl.createEl('p', {
				text: `Last checked: ${new Date(this.plugin.settings.lastUpdateCheck).toLocaleString()}`,
				cls: 'setting-item-description',
			});
		}

		// Add a button to test the connection
		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Checks the remote URL and credentials without cloning, initializing, or changing this vault.')
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Testing…');
					try {
						if (!this.plugin.settings.repoUrl) {
							new Notice('Please enter a repository URL first');
							return;
						}

						new Notice('Testing remote connection…');
							const { testRemoteConnection } = await import('./gitManager');
							const credentials = await this.plugin.getGitCredentials();
							await testRemoteConnection({
								...credentials,
							});
						new Notice('Remote connection successful. You can now clone it or initialize a local repository.');
					} catch (error: any) {
						new Notice(`Remote connection test failed: ${error?.message || String(error)}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Test');
					}
				}));

		// Add a button to manually sync
		new Setting(containerEl)
			.setName('Manual Sync')
			.setDesc('Manually sync your vault with the Git repository')
			.addButton(button => button
				.setButtonText('Sync Now')
				.onClick(async () => {
					try {
						await this.plugin.syncVault();
						new Notice('Git sync completed successfully');
					} catch (error) {
						new Notice(`Git sync failed: ${error.message}`);
					}
				}));

		// Add a button to export debug logs
		new Setting(containerEl)
			.setName('Export Debug Logs')
			.setDesc('Export captured debug logs to a markdown file in your vault')
			.addButton(button => button
				.setButtonText('Export Logs')
				.onClick(async () => {
					try {
						const path = await log.exportToFile(this.app.vault);
						new Notice(`Debug log exported to ${path}`);
					} catch (error: any) {
						new Notice(`Export failed: ${error.message}`);
					}
				}));

		renderDiagnosticsSection(containerEl, this.plugin);
	}
}
