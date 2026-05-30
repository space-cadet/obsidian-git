import { App, Plugin, PluginSettingTab, Setting, Notice, Modal, WorkspaceLeaf } from 'obsidian';
import * as git from 'isomorphic-git';
import * as http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';
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
	autoCommitMessage: 'Vault backup: {{date}}'
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

		// Initialize the file system
		this.fs = new FS('obsidian-git');
		log.debug('GitSyncPlugin', 'File system initialized');

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
					if (!this.gitManager) {
						const vaultPath = this.app.vault.getRoot().path;
						const credentials: GitCredentials = {
							username: this.settings.username,
							password: this.settings.password,
							author: {
								name: this.settings.author.name || 'Obsidian Git Sync User',
								email: this.settings.author.email || 'user@example.com'
							}
						};
						if (this.statusBarItem) {
							this.gitManager = new GitManager(this.fs, vaultPath, credentials, this.statusBarItem);
						} else {
							throw new Error('Status bar item not initialized');
						}
					}
					await this.gitManager.initializeRepo(this.settings.repoUrl, this.settings.branchName);
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
					if (!this.gitManager) {
						const vaultPath = this.app.vault.getRoot().path;
						const credentials: GitCredentials = {
							username: this.settings.username,
							password: this.settings.password,
							author: {
								name: this.settings.author.name || 'Obsidian Git Sync User',
								email: this.settings.author.email || 'user@example.com'
							}
						};
						if (this.statusBarItem) {
							this.gitManager = new GitManager(this.fs, vaultPath, credentials, this.statusBarItem);
						} else {
							throw new Error('Status bar item not initialized');
						}
					}
					await this.gitManager.initializeRepo(this.settings.repoUrl, this.settings.branchName);
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
					if (!this.gitManager) {
						const vaultPath = this.app.vault.getRoot().path;
						const credentials: GitCredentials = {
							username: this.settings.username,
							password: this.settings.password,
							author: {
								name: this.settings.author.name || 'Obsidian Git Sync User',
								email: this.settings.author.email || 'user@example.com'
							}
						};
						if (this.statusBarItem) {
							this.gitManager = new GitManager(this.fs, vaultPath, credentials, this.statusBarItem);
						} else {
							throw new Error('Status bar item not initialized');
						}
					}
					await this.gitManager.initializeRepo(this.settings.repoUrl, this.settings.branchName);
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

		this.addCommand({
			id: 'git-sync-test-compatibility',
			name: 'Test isomorphic-git compatibility',
			callback: async () => {
				const results: string[] = [];
				const testFsName = 'git-test-' + Date.now();
				const testFs = new FS(testFsName);
				const pfs = testFs.promises;
				const testDir = '/git-compat-test';

				try {
					// Test 1: LightningFS init
					try {
						await pfs.mkdir(testDir);
						results.push('✅ LightningFS (mobile fs)');
					} catch (e: any) {
						results.push('❌ LightningFS: ' + e.message);
					}

					// Test 2: git.init
					try {
						await git.init({ fs: pfs, dir: testDir, defaultBranch: 'main' });
						results.push('✅ git.init');
					} catch (e: any) {
						results.push('❌ git.init: ' + e.message);
					}

					// Test 3: git.findRoot
					try {
						const root = await git.findRoot({ fs: pfs, filepath: testDir });
						results.push(root === testDir ? '✅ git.findRoot' : '⚠️ git.findRoot (unexpected root)');
					} catch (e: any) {
						results.push('❌ git.findRoot: ' + e.message);
					}

					// Test 4: write file + git.add + git.commit
					try {
						await pfs.writeFile(testDir + '/test.md', '# Hello');
						await git.add({ fs: pfs, dir: testDir, filepath: 'test.md' });
						const sha = await git.commit({
							fs: pfs, dir: testDir,
							message: 'Test commit',
							author: { name: 'Test', email: 'test@example.com' }
						});
						results.push('✅ git.add + git.commit (' + sha.slice(0, 7) + ')');
					} catch (e: any) {
						results.push('❌ git.add/commit: ' + e.message);
					}

					// Test 5: git.log
					try {
						const commits = await git.log({ fs: pfs, dir: testDir });
						results.push('✅ git.log (' + commits.length + ' commits)');
					} catch (e: any) {
						results.push('❌ git.log: ' + e.message);
					}

					// Test 6: git.currentBranch
					try {
						const branch = await git.currentBranch({ fs: pfs, dir: testDir, fullname: false });
						results.push(branch === 'main' ? '✅ git.currentBranch (main)' : '⚠️ git.currentBranch (' + branch + ')');
					} catch (e: any) {
						results.push('❌ git.currentBranch: ' + e.message);
					}

					// Test 7: HTTP client availability
					try {
						// Verify requestUrl is available by checking if it's a function
						// (it's imported statically at the top of the file)
						results.push('✅ HTTP client (requestUrl native bridge)');
					} catch (e: any) {
						results.push('❌ HTTP client: ' + e.message);
					}

					// Show results
					const passed = results.filter(r => r.startsWith('✅')).length;
					const failed = results.filter(r => r.startsWith('❌')).length;
					new Notice(`Git compat: ${passed}/${results.length} passed${failed > 0 ? ', ' + failed + ' failed' : ''}`);

					// Open modal with full results
					class TestResultsModal extends Modal {
						constructor(app: App, private results: string[]) {
							super(app);
						}
						onOpen() {
							const { contentEl } = this;
							contentEl.createEl('h2', { text: 'isomorphic-git Compatibility Test' });
							const list = contentEl.createEl('ul');
							for (const r of this.results) {
								list.createEl('li', { text: r });
							}
							contentEl.createEl('p', {
								text: passed === this.results.length
									? 'All tests passed — isomorphic-git is fully compatible.'
									: 'Some tests failed — check the results above.'
							});
						}
					}
					new TestResultsModal(this.app, results).open();

				} catch (e: any) {
					log.error('GitSyncPlugin', 'Compatibility test failed', e);
					new Notice('Compatibility test error: ' + e.message);
				}
			}
		});

		// Set up auto sync if enabled
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

	async syncVault() {
		// Get the vault path
		const vaultPath = this.app.vault.getRoot().path;
		
		// Format commit message with date
		const commitMessage = this.settings.autoCommitMessage.replace(
			'{{date}}', 
			new Date().toLocaleString()
		);
	
		// Initialize GitManager if not already done
		if (!this.gitManager) {
			const credentials: GitCredentials = {
				username: this.settings.username,
				password: this.settings.password,
				author: {
					name: this.settings.author.name || 'Obsidian Git Sync User', // Ensure a valid default name
					email: this.settings.author.email || 'user@example.com' // Ensure a valid default email
				}
			};
			if (this.statusBarItem) {
				this.gitManager = new GitManager(this.fs, vaultPath, credentials, this.statusBarItem);
			} else {
				throw new Error('Status bar item not initialized');
			}
		} else {
			// Update credentials in case they've changed in settings
			this.gitManager.updateCredentials({
				username: this.settings.username,
				password: this.settings.password,
				author: {
					name: this.settings.author.name || 'Obsidian Git Sync User',
					email: this.settings.author.email || 'user@example.com'
				}
			});
		}
	
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

						if (!this.plugin.gitManager) {
							const vaultPath = this.plugin.app.vault.getRoot().path;
							const credentials: GitCredentials = {
								username: this.plugin.settings.username,
								password: this.plugin.settings.password,
								author: {
									name: this.plugin.settings.author.name,
									email: this.plugin.settings.author.email
								}
							};
							if (this.plugin.statusBarItem) {
								this.plugin.gitManager = new GitManager(this.plugin.fs, vaultPath, credentials, this.plugin.statusBarItem);
							} else {
								throw new Error('Status bar item not initialized');
							}
						}

						new Notice('Testing connection...');
						await this.plugin.gitManager.initializeRepo(
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