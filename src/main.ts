import { App, Plugin, PluginSettingTab, Setting, Notice, Modal, WorkspaceLeaf } from 'obsidian';
import { ObsidianFsAdapter } from './adapters/ObsidianFsAdapter';
import { GitManager, GitCredentials } from './gitManager';
import { log, LogLevel } from './logger';
import { VIEW_TYPE_GIT_SIDEBAR, GitSidebarView } from './views/GitSidebarView';

interface GitSyncSettings {
	repoUrl: string;
	branchName: string;
	username: string;
	password: string;
	author: {
		name: string;
		email: string;
	};
	autoSyncInterval: number; // in minutes, 0 means disabled
	autoCommitMessage: string;
	refreshInterval: number; // in seconds, 0 means disabled
}

const DEFAULT_SETTINGS: GitSyncSettings = {
	repoUrl: '',
	branchName: 'main',
	username: '',
	password: '',
	author: {
		name: '',
		email: ''
	},
	autoSyncInterval: 0,
	autoCommitMessage: 'Vault backup: {{date}}',
	refreshInterval: 60, // default 60 seconds
};

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncSettings;
	fs: any;
	intervalId: number | null = null;
	gitManager: GitManager | null = null;
	statusBarItem: HTMLElement | null = null;
	isDesktop: boolean = false;

	async onload() {
		await this.loadSettings();

		// Detect platform
		this.isDesktop = typeof window !== 'undefined' && 
			!!(window as any).require && 
			!!(window as any).process;
		log.info('GitSyncPlugin', `Platform: ${this.isDesktop ? 'desktop (Electron)' : 'mobile (WebView)'}`);

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
					await this.ensureGitManager();
					if (!this.gitManager) {
						new Notice('No git repository found');
						return;
					}
					await this.gitManager.pull(this.settings.branchName);
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
					await this.ensureGitManager();
					if (!this.gitManager) {
						new Notice('No git repository found');
						return;
					}
					await this.gitManager.push(this.settings.branchName);
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
					await this.ensureGitManager();
					if (!this.gitManager) {
						new Notice('No git repository found');
						return;
					}
					const status = await this.gitManager.getStatus();
					new Notice(`Git status: ${status.branch} — ${status.ahead} ahead, ${status.behind} behind`);
				} catch (error: any) {
					log.error('GitSyncPlugin', 'Status check failed', error);
					new Notice(`Git status failed: ${error.message}`);
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


		this.setupAutoSync();
	}

	onunload() {
		this.clearAutoSync();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.setupAutoSync(); // Reconfigure auto sync with new settings
	}

	setupAutoSync() {
		// Clear any existing interval
		this.clearAutoSync();

		// Set up new interval if enabled
		if (this.settings.autoSyncInterval > 0) {
			const intervalMs = this.settings.autoSyncInterval * 60 * 1000;
			this.intervalId = window.setInterval(async () => {
				try {
					await this.syncVault();
					console.log('Auto sync completed');
				} catch (error) {
					console.error('Auto sync failed:', error);
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

	async ensureGitManager(requireRemote: boolean = false): Promise<GitManager | null> {
		if (this.gitManager) return this.gitManager;

		const vaultPath = '.';
		
		const hasRepo = await this.detectRealGitRepo();
		if (!hasRepo) {
			log.warn('GitSyncPlugin', 'No .git repo found in vault');
			return null;
		}

		if (!this.settings.repoUrl && requireRemote) {
			return null;
		}

		const credentials: GitCredentials = {
			username: this.settings.username,
			password: this.settings.password,
			author: {
				name: this.settings.author.name || 'Obsidian Git User',
				email: this.settings.author.email || 'user@example.com'
			}
		};

		if (!this.statusBarItem) {
			return null;
		}

		this.gitManager = new GitManager(this.fs, vaultPath, credentials, this.statusBarItem);
		
		if (this.settings.repoUrl) {
			await this.gitManager.initializeRepo(this.settings.repoUrl, this.settings.branchName);
		}
		
		return this.gitManager;
	}

	/**
	 * Initialize a new git repository in the vault (git init)
	 */
	async initializeNewRepo(): Promise<void> {
		try {
			const git = await import('isomorphic-git');
			await git.init({ fs: this.fs, dir: '.', defaultBranch: 'main' });
			log.info('GitSyncPlugin', 'New git repository initialized in vault');
			new Notice('New git repository initialized');
		} catch (e: any) {
			log.error('GitSyncPlugin', 'Failed to initialize repo', e);
			throw new Error('Failed to initialize repo: ' + e.message);
		}
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

	async syncVault() {
		// Format commit message with date
		const commitMessage = this.settings.autoCommitMessage.replace(
			'{{date}}', 
			new Date().toLocaleString()
		);
	
		// Initialize GitManager if not already done
		await this.ensureGitManager();
		if (!this.gitManager) {
			throw new Error('No git repository found in vault');
		}
		
		// Update credentials in case they've changed in settings
		this.gitManager.updateCredentials({
			username: this.settings.username,
			password: this.settings.password,
			author: {
				name: this.settings.author.name || 'Obsidian Git Sync User',
				email: this.settings.author.email || 'user@example.com'
			}
		});
	
		// Perform the sync operation
		try {
			await this.gitManager.sync(
				this.settings.repoUrl,
				this.settings.branchName,
				commitMessage
			);
			return true;
		} catch (error) {
			console.error('Sync failed:', error);
			throw error;
		}
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
			.setDesc('Git password, or GitHub/GitLab Personal Access Token (PAT). For PATs, any username works.')
			.addText(text => text
				.setPlaceholder('ghp_... or password')
				.setValue(this.plugin.settings.password)
				.onChange(async (value: string) => {
					text.inputEl.type = 'password';
					this.plugin.settings.password = value;
					await this.plugin.saveSettings();
				}));

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

		// Add a button to test the connection
		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Test the connection to your Git repository')
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					try {
						if (!this.plugin.settings.repoUrl) {
							new Notice('Please enter a repository URL first');
							return;
						}

						await this.plugin.ensureGitManager();
						if (!this.plugin.gitManager) {
							new Notice('No git repository configured');
							return;
						}

							new Notice('Testing connection...');
							await this.plugin.gitManager!.initializeRepo(
								this.plugin.settings.repoUrl,
								this.plugin.settings.branchName
							);
							new Notice('Connection successful!');
					} catch (error) {
						new Notice(`Connection test failed: ${error.message}`);
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
	}
}