import { ItemView, WorkspaceLeaf, Notice, ButtonComponent } from 'obsidian';
import GitSyncPlugin from '../main';
import { GitFileStatus, GitCommit } from '../gitManager';
import { log, LogEntry } from '../logger';

export const VIEW_TYPE_GIT_SIDEBAR = 'git-sidebar-view';

type SidebarTab = 'status' | 'history' | 'log';

export class GitSidebarView extends ItemView {
    plugin: GitSyncPlugin;
    private contentContainer: HTMLElement;
    private headerContainer: HTMLElement;
    private tabsContainer: HTMLElement;
    private refreshInterval: number | null = null;
    private activeTab: SidebarTab = 'status';
    private hasRemote: boolean = false;
    private isLocalOnly: boolean = false;

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

        // Tabs
        this.tabsContainer = container.createDiv('git-sidebar-tabs');
        this.renderTabs();

        // Content area (switches based on tab)
        this.contentContainer = container.createDiv('git-sidebar-content');

        // Footer actions
        const footer = container.createDiv('git-sidebar-footer');
        this.renderFooter(footer);

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
            if (this.isLocalOnly) {
                statusRow.createSpan({ text: 'Local only — no remote', cls: 'git-local-only' });
            } else if (ahead > 0 || behind > 0) {
                statusRow.createSpan({ 
                    text: `⬆ ${ahead} ⬇ ${behind}`, 
                    cls: 'git-ahead-behind' + (ahead > 0 ? ' git-ahead' : '') + (behind > 0 ? ' git-behind' : '') 
                });
            } else {
                statusRow.createSpan({ text: 'Up to date', cls: 'git-up-to-date' });
            }
        }
    }

    private renderTabs(): void {
        this.tabsContainer.empty();
        
        const tabs: { id: SidebarTab; label: string }[] = [
            { id: 'status', label: 'Changes' },
            { id: 'history', label: 'History' },
            { id: 'log', label: 'Log' }
        ];

        for (const tab of tabs) {
            const btn = this.tabsContainer.createEl('button', {
                text: tab.label,
                cls: 'git-tab-btn' + (tab.id === this.activeTab ? ' git-tab-active' : '')
            });
            btn.addEventListener('click', () => {
                this.activeTab = tab.id;
                this.renderTabs(); // re-render to update active state
                this.refresh();
            });
        }
    }

    private renderFooter(container: HTMLElement): void {
        container.empty();

        new ButtonComponent(container)
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

        if (!this.isLocalOnly) {
            new ButtonComponent(container)
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
        }

        new ButtonComponent(container)
            .setButtonText('Refresh')
            .setTooltip('Refresh git status')
            .setClass('git-btn-ghost')
            .onClick(async () => {
                await this.refresh();
            });
    }

    async refresh(): Promise<void> {
        // Try to init if not already
        if (!this.plugin.gitManager) {
            const hasRealRepo = await this.plugin.detectRealGitRepo();
            
            if (hasRealRepo) {
                // Real repo exists but plugin storage not initialized
                this.contentContainer.empty();
                const wrapper = this.contentContainer.createDiv('git-empty-state-container');
                wrapper.createEl('p', { 
                    text: 'Git repo detected in vault.', 
                    cls: 'git-empty-state git-empty-state-title' 
                });
                wrapper.createEl('p', { 
                    text: this.plugin.settings.repoUrl 
                        ? 'Click Sync to initialize plugin storage from remote.'
                        : 'Configure a remote URL in settings to sync, or use Stage All to track changes locally.',
                    cls: 'git-empty-state' 
                });
                
                const btnRow = wrapper.createDiv('git-empty-state-actions');
                new ButtonComponent(btnRow)
                    .setButtonText('Initialize')
                    .setClass('git-btn-primary')
                    .onClick(async () => {
                        try {
                            await this.plugin.ensureGitManager(false);
                            new Notice('Git storage initialized');
                            await this.refresh();
                        } catch (e: any) {
                            new Notice('Initialize failed: ' + e.message);
                        }
                    });
                
                if (this.plugin.settings.repoUrl) {
                    new ButtonComponent(btnRow)
                        .setButtonText('Clone Remote')
                        .setClass('git-btn-secondary')
                        .onClick(async () => {
                            try {
                                await this.plugin.syncVault();
                                new Notice('Remote repo cloned');
                                await this.refresh();
                            } catch (e: any) {
                                new Notice('Clone failed: ' + e.message);
                            }
                        });
                }
                
                this.updateHeader('local', 0, 0);
            } else {
                this.contentContainer.empty();
                this.contentContainer.createEl('div', { 
                    cls: 'git-empty-state-container',
                    text: '' 
                }).createEl('p', { 
                    text: 'No git repository found in vault.', 
                    cls: 'git-empty-state' 
                });
                this.updateHeader('No repo', 0, 0);
            }
            return;
        }

        try {
            const branch = await this.plugin.gitManager.getCurrentBranch();
            const { ahead, behind } = await this.plugin.gitManager.getStatus();
            this.updateHeader(branch, ahead, behind);
        } catch (e) {
            log.warn('GitSidebar', 'Failed to get branch/status', e);
            this.updateHeader('unknown', 0, 0);
        }

        // Render active tab content
        this.contentContainer.empty();
        
        switch (this.activeTab) {
            case 'status':
                await this.renderStatusTab();
                break;
            case 'history':
                await this.renderHistoryTab();
                break;
            case 'log':
                await this.renderLogTab();
                break;
        }
    }

    private async renderStatusTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-status-list');

        try {
            const files = await this.plugin.gitManager!.getDetailedStatus();
            
            if (files.length === 0) {
                listContainer.createEl('p', { text: 'No changes', cls: 'git-empty-state' });
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
                const row = listContainer.createDiv('git-file-row');
                row.createSpan({ 
                    text: statusIcons[file.status] || file.status[0].toUpperCase(), 
                    cls: 'git-status-icon ' + (statusClasses[file.status] || '') 
                });
                
                const pathEl = row.createSpan({ text: file.filepath, cls: 'git-file-path' });
                pathEl.setAttr('title', file.filepath);

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
        } catch (e) {
            log.warn('GitSidebar', 'Failed to get file status', e);
            listContainer.createEl('p', { text: 'Unable to read file status', cls: 'git-empty-state' });
        }
    }

    private async renderHistoryTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-log-list');

        try {
            const commits = await this.plugin.gitManager!.getLog(25);
            
            if (commits.length === 0) {
                listContainer.createEl('p', { text: 'No commits yet', cls: 'git-empty-state' });
                return;
            }

            for (const commit of commits) {
                const row = listContainer.createDiv('git-commit-row');
                
                const hash = row.createSpan({ text: commit.oid.slice(0, 7), cls: 'git-commit-hash' });
                hash.setAttr('title', commit.oid);
                
                const msg = row.createSpan({ text: this.truncateMessage(commit.message), cls: 'git-commit-message' });
                msg.setAttr('title', commit.message);
                
                const meta = row.createDiv('git-commit-meta');
                meta.createSpan({ text: commit.author, cls: 'git-commit-author' });
                meta.createSpan({ text: this.formatDate(commit.date), cls: 'git-commit-date' });
            }
        } catch (e) {
            log.warn('GitSidebar', 'Failed to get commit log', e);
            listContainer.createEl('p', { text: 'Unable to read commit history', cls: 'git-empty-state' });
        }
    }

    private async renderLogTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-log-list');
        
        const entries = log.getEntries();
        
        if (entries.length === 0) {
            listContainer.createEl('p', { text: 'No activity yet', cls: 'git-empty-state' });
            return;
        }

        // Show last 50 entries, newest first
        const recent = [...entries].reverse().slice(0, 50);
        
        for (const entry of recent) {
            const row = listContainer.createDiv('git-log-entry');
            
            const time = row.createSpan({ 
                text: this.formatDate(new Date(entry.timestamp)), 
                cls: 'git-log-time' 
            });
            
            const level = row.createSpan({ 
                text: entry.level.toUpperCase(), 
                cls: 'git-log-level git-log-' + entry.level 
            });
            
            row.createSpan({ 
                text: `[${entry.namespace}] ${entry.message}`, 
                cls: 'git-log-message' 
            });
            
            if (entry.data) {
                const detail = row.createDiv('git-log-detail');
                detail.setText(typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data).slice(0, 200));
            }
        }
    }

    private truncateMessage(msg: string, maxLen: number = 40): string {
        const clean = msg.split('\n')[0];
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
