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

        // 1. TABS at the very top + settings icon
        const tabsWrapper = container.createDiv('git-sidebar-tabs-wrapper');
        this.tabsContainer = tabsWrapper.createDiv('git-sidebar-tabs');
        this.renderTabs();
        
        // Settings button in tabs area
        const settingsBtn = tabsWrapper.createEl('button', {
            cls: 'git-settings-btn',
            attr: { 'aria-label': 'Open Git Sync Settings', title: 'Open Settings' }
        });
        settingsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
        settingsBtn.addEventListener('click', () => {
            (this.app as any).setting.open();
            (this.app as any).setting.openTabById(this.plugin.manifest.id);
        });

        // 2. Compact header (branch, status)
        this.headerContainer = container.createDiv('git-sidebar-header');

        // 3. Content area
        this.contentContainer = container.createDiv('git-sidebar-content');

        // 4. Footer actions
        const footer = container.createDiv('git-sidebar-footer');
        this.renderFooter(footer);

        // Initial load
        await this.refresh();

        // Auto-refresh with configured interval
        this.startAutoRefresh();
    }

    async onClose(): Promise<void> {
        this.stopAutoRefresh();
    }

    // ─── Auto Refresh ───

    private startAutoRefresh(): void {
        this.stopAutoRefresh();
        const ms = this.plugin.settings.refreshInterval * 1000;
        if (ms > 0) {
            this.refreshInterval = window.setInterval(() => {
                if (this.containerEl.isShown()) {
                    this.refresh();
                }
            }, ms);
        }
    }

    private stopAutoRefresh(): void {
        if (this.refreshInterval !== null) {
            window.clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    updateRefreshInterval(seconds: number): void {
        this.plugin.settings.refreshInterval = seconds;
        this.startAutoRefresh();
    }

    // ─── Tabs ───

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
            btn.addEventListener('click', async () => {
                this.activeTab = tab.id;
                this.renderTabs();
                await this.refresh();
            });
        }
    }

    // ─── Header ───

    private renderHeader(branch: string, ahead: number, behind: number, initialized: boolean, hasRealRepo: boolean): void {
        this.headerContainer.empty();
        
        const branchRow = this.headerContainer.createDiv('git-header-branch');
        branchRow.createSpan({ text: '●', cls: 'git-branch-dot' });
        branchRow.createSpan({ 
            text: initialized ? branch : (hasRealRepo ? 'local' : 'No repo'), 
            cls: 'git-branch-name' + (initialized ? '' : ' git-branch-uninit') 
        });
        
        const statusRow = this.headerContainer.createDiv('git-header-status');
        if (!initialized) {
            if (!hasRealRepo) {
                statusRow.createSpan({ text: 'No git repository — initialize to create', cls: 'git-header-hint' });
            } else {
                statusRow.createSpan({ text: 'Git repo detected — initialize to sync', cls: 'git-header-hint' });
            }
        } else if (this.isLocalOnly) {
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

    // ─── Footer ───

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

        new ButtonComponent(container)
            .setButtonText(this.isLocalOnly ? 'Commit' : 'Sync')
            .setTooltip(this.isLocalOnly ? 'Commit changes' : 'Pull, commit, push')
            .setClass('git-btn-primary')
            .onClick(async () => {
                try {
                    if (this.isLocalOnly || !this.plugin.settings.repoUrl) {
                        // Local-only: just commit
                        if (!this.plugin.gitManager) {
                            new Notice('Git not initialized');
                            return;
                        }
                        await this.plugin.gitManager.commit('Update from Obsidian');
                        new Notice('Changes committed');
                    } else {
                        await this.plugin.syncVault();
                        new Notice('Sync complete');
                    }
                    await this.refresh();
                } catch (e: any) {
                    new Notice((this.isLocalOnly ? 'Commit' : 'Sync') + ' failed: ' + e.message);
                }
            });

        new ButtonComponent(container)
            .setButtonText('Refresh')
            .setTooltip('Refresh git status')
            .setClass('git-btn-ghost')
            .onClick(async () => {
                await this.refresh();
            });
    }

    // ─── Main refresh ───

    async refresh(): Promise<void> {
        // Try to auto-init gitManager if not already done
        if (!this.plugin.gitManager) {
            await this.plugin.ensureGitManager();
        }
        
        // Update initialization state
        const initialized = !!this.plugin.gitManager;
        if (initialized) {
            this.hasRemote = !!this.plugin.settings.repoUrl;
            this.isLocalOnly = !this.hasRemote;
        }

        // Check if real repo exists (for header and UI state)
        let hasReal = false;
        try {
            hasReal = await this.plugin.detectRealGitRepo();
        } catch (e) {
            log.warn('GitSidebar', 'detectRealGitRepo failed', e);
        }

        // Try to get git info for header
        let branch = 'unknown';
        let ahead = 0;
        let behind = 0;
        
        if (initialized) {
            try {
                branch = await this.plugin.gitManager!.getCurrentBranch();
                const status = await this.plugin.gitManager!.getStatus();
                ahead = status.ahead;
                behind = status.behind;
            } catch (e) {
                log.warn('GitSidebar', 'Failed to get branch/status', e);
            }
        } else if (hasReal) {
            branch = 'local';
        } else {
            branch = 'No repo';
        }

        // Update header with hasReal status
        this.renderHeader(branch, ahead, behind, initialized, hasReal);

        // Render tab content
        this.contentContainer.empty();

        if (!initialized) {
            await this.renderUninitializedContent(hasReal);
            return;
        }

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

    private async renderUninitializedContent(hasReal: boolean): Promise<void> {
        const wrapper = this.contentContainer.createDiv('git-uninit-container');
        
        if (!hasReal) {
            wrapper.createEl('p', { 
                text: 'No git repository found in this vault.', 
                cls: 'git-uninit-title' 
            });
            wrapper.createEl('p', { 
                text: 'Create a git repository to start tracking changes.',
                cls: 'git-uninit-desc' 
            });
            
            const btnRow = wrapper.createDiv('git-uninit-actions');
            
            new ButtonComponent(btnRow)
                .setButtonText('Initialize New Repo')
                .setTooltip('Create a new git repository in this vault')
                .setClass('git-btn-primary')
                .onClick(async () => {
                    try {
                        await this.plugin.initializeNewRepo();
                        new Notice('Git repository initialized');
                        await this.refresh();
                    } catch (e: any) {
                        new Notice('Initialize failed: ' + e.message);
                    }
                });
            
            if (this.plugin.settings.repoUrl) {
                new ButtonComponent(btnRow)
                    .setButtonText('Clone Remote')
                    .setTooltip('Clone from configured remote URL')
                    .setClass('git-btn-secondary')
                    .onClick(async () => {
                        try {
                            await this.plugin.syncVault();
                            new Notice('Remote cloned');
                            await this.refresh();
                        } catch (e: any) {
                            new Notice('Clone failed: ' + e.message);
                        }
                    });
            }
            return;
        }
        
        wrapper.createEl('p', { 
            text: 'A git repository exists in this vault.', 
            cls: 'git-uninit-title' 
        });
        
        wrapper.createEl('p', { 
            text: this.plugin.settings.repoUrl 
                    ? 'Initialize to sync with the configured remote, or clone to start from the remote.'
                    : 'Initialize to track changes locally. Add a remote URL in settings to push/pull.',
            cls: 'git-uninit-desc' 
        });
        
        const btnRow = wrapper.createDiv('git-uninit-actions');
        
        new ButtonComponent(btnRow)
            .setButtonText('Initialize Local')
            .setTooltip('Create local git tracking')
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
                .setTooltip('Clone from configured remote URL')
                .setClass('git-btn-secondary')
                .onClick(async () => {
                    try {
                        await this.plugin.syncVault();
                        new Notice('Remote cloned');
                        await this.refresh();
                    } catch (e: any) {
                        new Notice('Clone failed: ' + e.message);
                    }
                });
        }
    }

    // ─── Tab renders ───

    private async renderStatusTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-status-list');

        try {
            if (!this.plugin.gitManager) {
                listContainer.createEl('p', { text: 'Git manager not initialized', cls: 'git-empty-state' });
                return;
            }

            const files = await this.plugin.gitManager.getDetailedStatus();
            
            if (files.length === 0) {
                listContainer.createEl('p', { text: 'No changes — working tree clean', cls: 'git-empty-state' });
                return;
            }

            const statusIcons: Record<string, string> = {
                modified: 'M', added: 'A', deleted: 'D',
                untracked: '?', staged: 'S', conflict: 'C'
            };
            const statusClasses: Record<string, string> = {
                modified: 'git-status-modified', added: 'git-status-added',
                deleted: 'git-status-deleted', untracked: 'git-status-untracked',
                staged: 'git-status-staged', conflict: 'git-status-conflict'
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
                            await this.plugin.gitManager?.stageFile(file.filepath);
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
                            await this.plugin.gitManager?.unstageFile(file.filepath);
                            new Notice(`Unstaged ${file.filepath}`);
                            await this.refresh();
                        } catch (err: any) {
                            new Notice('Unstage failed: ' + err.message);
                        }
                    });
                }
            }
        } catch (e: any) {
            log.warn('GitSidebar', 'Failed to get file status', e);
            listContainer.empty();
            
            if (e.isPackIndexError || e.message?.includes('Pack index')) {
                const errContainer = listContainer.createDiv('git-uninit-container');
                errContainer.createEl('p', { text: '⚠️ Changes view temporarily unavailable', cls: 'git-uninit-title' });
                errContainer.createEl('p', { 
                    text: 'isomorphic-git cannot read a pack index file in your repo. This happens with certain pack file formats. Try running "git repack -ad" in your repo to rebuild pack files, or use the command line for now.',
                    cls: 'git-uninit-desc' 
                });
                
                const btnRow = errContainer.createDiv('git-uninit-actions');
                new ButtonComponent(btnRow)
                    .setButtonText('Retry')
                    .setClass('git-btn-primary')
                    .onClick(async () => {
                        await this.refresh();
                    });
            } else {
                const errContainer = listContainer.createDiv('git-uninit-container');
                errContainer.createEl('p', { text: 'Error reading git status', cls: 'git-uninit-title' });
                errContainer.createEl('p', { text: e.message || String(e), cls: 'git-uninit-desc' });
            }
        }
    }

    private async renderHistoryTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-log-list');

        try {
            const commits = await this.plugin.gitManager!.getLog(25);
            
            if (commits.length === 0) {
                listContainer.createEl('p', { text: 'No commits yet — stage files and sync to create your first commit', cls: 'git-empty-state' });
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
        } catch (e: any) {
            log.warn('GitSidebar', 'Failed to get commit log', e);
            
            // Check if this is a "no commits yet" error (fresh repo)
            const msg = e.message || String(e);
            if (msg.includes('Could not find') || msg.includes('refs/heads') || msg.includes('unknown revision') || msg.includes('Not a valid')) {
                listContainer.empty();
                const empty = listContainer.createDiv('git-uninit-container');
                empty.createEl('p', { text: 'No commits yet', cls: 'git-uninit-title' });
                empty.createEl('p', { text: 'Stage files and tap Sync to create your first commit.', cls: 'git-uninit-desc' });
            } else {
                listContainer.createEl('p', { text: 'Unable to read commit history', cls: 'git-empty-state' });
            }
        }
    }

    private async renderLogTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-log-list');
        
        const entries = log.getEntries();
        
        if (entries.length === 0) {
            listContainer.createEl('p', { text: 'No activity yet', cls: 'git-empty-state' });
            return;
        }

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

    // ─── Helpers ───

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
