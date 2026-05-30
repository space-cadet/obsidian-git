import { ItemView, WorkspaceLeaf, Notice, ButtonComponent } from 'obsidian';
import GitSyncPlugin from '../main';
import { GitFileStatus, GitCommit } from '../gitManager';
import { log } from '../logger';

export const VIEW_TYPE_GIT_SIDEBAR = 'git-sidebar-view';

export class GitSidebarView extends ItemView {
    plugin: GitSyncPlugin;
    private statusContainer: HTMLElement;
    private logContainer: HTMLElement;
    private headerContainer: HTMLElement;
    private refreshInterval: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: GitSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_GIT_SIDEBAR;
    }

    getDisplayText(): string {
        return 'Git Sync';
    }

    getIcon(): string {
        return 'git-branch';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('git-sidebar-container');

        // Header: branch + ahead/behind + action buttons
        this.headerContainer = container.createDiv('git-sidebar-header');
        this.renderHeader();

        // Status panel: changed files
        const statusSection = container.createDiv('git-sidebar-section');
        statusSection.createEl('h3', { text: 'Changes', cls: 'git-sidebar-section-title' });
        this.statusContainer = statusSection.createDiv('git-status-list');

        // Log panel: commit history
        const logSection = container.createDiv('git-sidebar-section');
        logSection.createEl('h3', { text: 'History', cls: 'git-sidebar-section-title' });
        this.logContainer = logSection.createDiv('git-log-list');

        // Footer actions
        const footer = container.createDiv('git-sidebar-footer');
        
        new ButtonComponent(footer)
            .setButtonText('Stage All')
            .setTooltip('Stage all changes')
            .setClass('git-btn-secondary')
            .onClick(async () => {
                try {
                    if (!this.plugin.gitManager) {
                        new Notice('Git not initialized');
                        return;
                    }
                    await this.plugin.gitManager.addAll();
                    new Notice('All changes staged');
                    await this.refresh();
                } catch (e: any) {
                    new Notice('Stage failed: ' + e.message);
                }
            });

        new ButtonComponent(footer)
            .setButtonText('Sync')
            .setTooltip('Pull, commit, push')
            .setClass('git-btn-primary')
            .onClick(async () => {
                try {
                    await this.plugin.syncVault();
                    await this.refresh();
                } catch (e: any) {
                    new Notice('Sync failed: ' + e.message);
                }
            });

        new ButtonComponent(footer)
            .setButtonText('Refresh')
            .setTooltip('Refresh git status')
            .setClass('git-btn-ghost')
            .onClick(async () => {
                await this.refresh();
            });

        // Initial load
        await this.refresh();

        // Auto-refresh every 30s when visible
        this.refreshInterval = window.setInterval(() => {
            if (this.containerEl.isShown()) {
                this.refresh();
            }
        }, 30000);
    }

    async onClose(): Promise<void> {
        if (this.refreshInterval !== null) {
            window.clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    private renderHeader(): void {
        this.headerContainer.empty();
        
        const branchRow = this.headerContainer.createDiv('git-header-branch');
        branchRow.createSpan({ text: '●', cls: 'git-branch-dot' });
        const branchName = this.headerContainer.createDiv('git-branch-name');
        branchName.setText('Loading...');
        
        const statusRow = this.headerContainer.createDiv('git-header-status');
        statusRow.createSpan({ text: '⬆ 0 ⬇ 0', cls: 'git-ahead-behind' });
    }

    private updateHeader(branch: string, ahead: number, behind: number): void {
        const branchName = this.headerContainer.querySelector('.git-branch-name');
        if (branchName) branchName.setText(branch);
        
        const statusRow = this.headerContainer.querySelector('.git-header-status');
        if (statusRow) {
            statusRow.empty();
            if (ahead > 0 || behind > 0) {
                statusRow.createSpan({ 
                    text: `⬆ ${ahead} ⬇ ${behind}`, 
                    cls: 'git-ahead-behind' + (ahead > 0 ? ' git-ahead' : '') + (behind > 0 ? ' git-behind' : '') 
                });
            } else {
                statusRow.createSpan({ text: 'Up to date', cls: 'git-up-to-date' });
            }
        }
    }

    async refresh(): Promise<void> {
        if (!this.plugin.gitManager) {
            this.statusContainer.empty();
            this.statusContainer.createEl('p', { text: 'Git not initialized. Configure settings first.', cls: 'git-empty-state' });
            return;
        }

        try {
            // Update branch + ahead/behind
            const branch = await this.plugin.gitManager.getCurrentBranch();
            const { ahead, behind } = await this.plugin.gitManager.getStatus();
            this.updateHeader(branch, ahead, behind);
        } catch (e) {
            log.warn('GitSidebar', 'Failed to get branch/status', e);
            this.updateHeader('unknown', 0, 0);
        }

        try {
            // Update file status list
            const files = await this.plugin.gitManager.getDetailedStatus();
            this.renderFileList(files);
        } catch (e) {
            log.warn('GitSidebar', 'Failed to get file status', e);
            this.statusContainer.empty();
            this.statusContainer.createEl('p', { text: 'Unable to read file status', cls: 'git-empty-state' });
        }

        try {
            // Update commit log
            const commits = await this.plugin.gitManager.getLog(15);
            this.renderLogList(commits);
        } catch (e) {
            log.warn('GitSidebar', 'Failed to get commit log', e);
            this.logContainer.empty();
            this.logContainer.createEl('p', { text: 'No commits yet', cls: 'git-empty-state' });
        }
    }

    private renderFileList(files: GitFileStatus[]): void {
        this.statusContainer.empty();

        if (files.length === 0) {
            this.statusContainer.createEl('p', { text: 'No changes', cls: 'git-empty-state' });
            return;
        }

        const statusIcons: Record<string, string> = {
            modified: 'M',
            added: 'A',
            deleted: 'D',
            untracked: '?',
            staged: 'S',
            conflict: 'C'
        };

        const statusClasses: Record<string, string> = {
            modified: 'git-status-modified',
            added: 'git-status-added',
            deleted: 'git-status-deleted',
            untracked: 'git-status-untracked',
            staged: 'git-status-staged',
            conflict: 'git-status-conflict'
        };

        for (const file of files) {
            const row = this.statusContainer.createDiv('git-file-row');
            row.createSpan({ text: statusIcons[file.status] || file.status[0].toUpperCase(), cls: 'git-status-icon ' + (statusClasses[file.status] || '') });
            
            const pathEl = row.createSpan({ text: file.filepath, cls: 'git-file-path' });
            pathEl.setAttr('title', file.filepath);

            // Stage/unstage toggle
            const actions = row.createDiv('git-file-actions');
            if (file.status === 'untracked' || file.status === 'modified') {
                const btn = actions.createEl('button', { text: '+', cls: 'git-file-btn' });
                btn.setAttr('title', 'Stage file');
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await this.plugin.gitManager!.stageFile(file.filepath);
                        new Notice(`Staged ${file.filepath}`);
                        await this.refresh();
                    } catch (err: any) {
                        new Notice('Stage failed: ' + err.message);
                    }
                });
            } else if (file.status === 'staged') {
                const btn = actions.createEl('button', { text: '−', cls: 'git-file-btn' });
                btn.setAttr('title', 'Unstage file');
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await this.plugin.gitManager!.unstageFile(file.filepath);
                        new Notice(`Unstaged ${file.filepath}`);
                        await this.refresh();
                    } catch (err: any) {
                        new Notice('Unstage failed: ' + err.message);
                    }
                });
            }
        }
    }

    private renderLogList(commits: GitCommit[]): void {
        this.logContainer.empty();

        if (commits.length === 0) {
            this.logContainer.createEl('p', { text: 'No commits yet', cls: 'git-empty-state' });
            return;
        }

        for (const commit of commits) {
            const row = this.logContainer.createDiv('git-commit-row');
            
            const hash = row.createSpan({ text: commit.oid.slice(0, 7), cls: 'git-commit-hash' });
            hash.setAttr('title', commit.oid);
            
            const msg = row.createSpan({ text: this.truncateMessage(commit.message), cls: 'git-commit-message' });
            msg.setAttr('title', commit.message);
            
            row.createSpan({ 
                text: this.formatDate(commit.date), 
                cls: 'git-commit-date' 
            });
        }
    }

    private truncateMessage(msg: string, maxLen: number = 40): string {
        const clean = msg.split('\n')[0]; // first line only
        return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
    }

    private formatDate(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
}
