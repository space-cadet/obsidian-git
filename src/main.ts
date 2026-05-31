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

	async onload() {
		await this.loadSettings();

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

		// Use '.' as the vault path (current directory) for isomorphic-git
		// Empty string causes path resolution issues in isomorphic-git's findRoot
		const vaultPath = '.';
		
		// Check if git repo exists via isomorphic-git itself
		const hasRepo = await this.detectRealGitRepo();
		if (!hasRepo) {
			log.warn('GitSyncPlugin', 'No .git repo found in vault');
			return null;
		}

		// No remote required? We can still work with local repo
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
		} else {
			// Just verify the repo is valid
			const isRepo = await this.gitManager.isRepository();
			if (!isRepo) {
				log.warn('GitSyncPlugin', 'GitManager could not verify repo');
			}
		}
		
		return this.gitManager;
	}

	/**
	 * Detect if vault has a real .git repo on the actual filesystem
	 */
	async detectRealGitRepo(): Promise<boolean> {
		try {
			// Method 1: Try to read .git/HEAD via the adapter (desktop + mobile)
			const adapter = this.app.vault.adapter;
			try {
				await adapter.read('.git/HEAD');
				log.debug('GitSyncPlugin', 'detectRealGitRepo: .git/HEAD readable');
				return true;
			} catch (e) {
				log.debug('GitSyncPlugin', 'detectRealGitRepo: .git/HEAD not readable', e);
			}
			
			// Method 2: Try adapter.stat for .git directory
			try {
				const stat = await adapter.stat('.git');
				if (stat && stat.type === 'folder') {
					log.debug('GitSyncPlugin', 'detectRealGitRepo: .git dir found via stat');
					return true;
				}
			} catch (e) {
				log.debug('GitSyncPlugin', 'detectRealGitRepo: .git stat failed', e);
			}
			
			// Method 3: Try isomorphic-git findRoot with our fs adapter
			try {
				const git = await import('isomorphic-git');
				const root = await git.findRoot({ fs: this.fs, filepath: '.' });
				if (root) {
					log.debug('GitSyncPlugin', 'detectRealGitRepo: findRoot found repo at', root);
					return true;
				}
			} catch (e) {
				log.debug('GitSyncPlugin', 'detectRealGitRepo: findRoot failed', e);
			}
			
			return false;
		} catch (e) {
			log.warn('GitSyncPlugin', 'detectRealGitRepo error', e);
			return false;
		}
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
			.setDesc('Your Git username')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password/Token')
			.setDesc('Your Git password or personal access token')
			.addText(text => text
				.setPlaceholder('password or token')
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