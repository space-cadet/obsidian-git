import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, Modal, TextComponent, Menu, setIcon } from 'obsidian';
import GitSyncPlugin from '../main';
import { GitManager, GitFileStatus, GitCommit, GitSidebarStatusSnapshot, GitComparisonState } from '../gitManager';
import { log, LogEntry } from '../logger';

export const VIEW_TYPE_GIT_SIDEBAR = 'git-sidebar-view';

type SidebarTab = 'status' | 'commits' | 'log';

interface SidebarHistoryCache {
    remoteCommits: { repoUrl: string; branch: string; commits: GitCommit[] } | null;
    localCommits: { branch: string; commits: GitCommit[] } | null;
    commitDetails: Map<string, GitCommit['files']>;
}

// Keep immutable history data for the lifetime of the plugin, not only for
// the lifetime of one ItemView instance. Obsidian can recreate a sidebar view
// when the workspace is backgrounded or its leaf is restored.
const sidebarHistoryCaches = new WeakMap<GitSyncPlugin, SidebarHistoryCache>();

function getSidebarHistoryCache(plugin: GitSyncPlugin): SidebarHistoryCache {
    let cache = sidebarHistoryCaches.get(plugin);
    if (!cache) {
        cache = { remoteCommits: null, localCommits: null, commitDetails: new Map() };
        sidebarHistoryCaches.set(plugin, cache);
    }
    return cache;
}

export class GitSidebarView extends ItemView {
    plugin: GitSyncPlugin;
    private contentContainer: HTMLElement;
    private headerContainer: HTMLElement;
    private tabsContainer: HTMLElement;
    private refreshInterval: number | null = null;
    private stagedCount: number = 0;
    private activeTab: SidebarTab = 'status';
    private commitsViewMode: 'local' | 'remote' = 'local';
    private expandedCommitOids: Set<string> = new Set();
    private hasRemote: boolean = false;
    private isLocalOnly: boolean = false;
    private hasRealRepo: boolean = false;
    private sidebarSnapshot: GitSidebarStatusSnapshot | null = null;
    private remoteCommitsCache: { repoUrl: string; branch: string; commits: GitCommit[] } | null = null;
    private localCommitsCache: { branch: string; commits: GitCommit[] } | null = null;
    private commitDetailsCache = new Map<string, GitCommit['files']>();
    private logEntriesCache: LogEntry[] | null = null;
    private renderGeneration = 0;
    private logUnsubscribe: (() => void) | null = null;
    private logRenderScheduled = false;
    private mutationInFlight = false;

    constructor(leaf: WorkspaceLeaf, plugin: GitSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
        const cache = getSidebarHistoryCache(plugin);
        this.remoteCommitsCache = cache.remoteCommits;
        this.localCommitsCache = cache.localCommits;
        this.commitDetailsCache = cache.commitDetails;
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
        // The sidebar uses the compact layout by default; there is no larger
        // alternative because the repository header must leave room for files.
        container.addClass('git-sidebar-density-compact');
        container.setAttr('role', 'region');
        container.setAttr('aria-label', 'Git Sync');

        // 1. TABS at the very top + settings icon
        const tabsWrapper = container.createDiv('git-sidebar-tabs-wrapper');
        tabsWrapper.setAttr('role', 'tablist');
        tabsWrapper.setAttr('aria-label', 'Git Sync views');
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
        this.contentContainer.setAttr('id', 'git-sidebar-content');
        this.contentContainer.setAttr('role', 'tabpanel');
        this.contentContainer.setAttr('tabindex', '0');
        this.contentContainer.setAttr('aria-label', 'Git Sync content');

        // Do not leave the first frame blank while adapter/index reads run.
        // The loading state also establishes the branch/header region before
        // the first asynchronous snapshot is available.
        this.renderLoadingState();

        this.logUnsubscribe = log.subscribe(() => {
            this.logEntriesCache = null;
            if (this.activeTab !== 'log' || this.logRenderScheduled) return;
            this.logRenderScheduled = true;
            window.setTimeout(() => {
                this.logRenderScheduled = false;
                if (this.activeTab === 'log' && this.containerEl.isConnected) {
                    void this.refresh({ readRepository: false });
                }
            }, 0);
        });
        // Obsidian emits vault events for deletes made through the file
        // manager (and for external changes once its watcher notices them).
        // Refresh the status snapshot immediately instead of waiting for the
        // periodic timer or requiring a second navigation.
        this.registerEvent(this.app.vault.on('delete', () => {
            if (this.containerEl.isConnected) void this.refresh({ force: true });
        }));

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
        this.logUnsubscribe?.();
        this.logUnsubscribe = null;
        // Invalidate any in-flight repository/history read before Obsidian
        // detaches the view so late responses cannot render into stale DOM.
        this.renderGeneration += 1;
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

    private invalidateRemoteCommitsCache(): void {
        this.remoteCommitsCache = null;
        this.localCommitsCache = null;
        this.commitDetailsCache.clear();
        const cache = getSidebarHistoryCache(this.plugin);
        cache.remoteCommits = null;
        cache.localCommits = null;
    }

    private isCurrentRender(generation: number): boolean {
        return generation === this.renderGeneration && this.containerEl.isConnected;
    }

    private async refreshFromButton(button: HTMLButtonElement): Promise<void> {
        if (button.disabled) return;
        button.disabled = true;
        button.addClass('git-header-refreshing');
        button.setAttr('aria-busy', 'true');
        try {
            await this.refresh({ force: true });
        } finally {
            if (button.isConnected) {
                button.disabled = false;
                button.removeClass('git-header-refreshing');
                button.removeAttribute('aria-busy');
            }
        }
    }

    private renderLoadingState(): void {
        this.headerContainer.empty();
        this.headerContainer.addClass('git-repository-header');
        const row = this.headerContainer.createDiv('git-header-branch');
        const icon = row.createSpan({ cls: 'git-branch-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(icon, 'git-branch');
        row.createSpan({ text: 'Loading repository…', cls: 'git-branch-name git-branch-uninit' });
        this.contentContainer.empty();
        this.contentContainer.createEl('p', { text: 'Loading Git status…', cls: 'git-empty-state' });
    }

    // ─── Tabs ───

    private renderTabs(): void {
        this.tabsContainer.empty();
        
        const tabs: { id: SidebarTab; label: string }[] = [
            { id: 'status', label: 'Changes' },
            { id: 'commits', label: 'Commits' },
            { id: 'log', label: 'Log' }
        ];

        for (const tab of tabs) {
            const btn = this.tabsContainer.createEl('button', {
                text: tab.label,
                cls: 'git-tab-btn' + (tab.id === this.activeTab ? ' git-tab-active' : ''),
                attr: {
                    role: 'tab',
                    'aria-selected': String(tab.id === this.activeTab),
                    'aria-controls': 'git-sidebar-content',
                    'data-tab': tab.id
                }
            });
            btn.addEventListener('click', async () => {
                this.activeTab = tab.id;
                this.renderTabs();
                await this.refresh({ readRepository: false });
            });
        }
    }

    // ─── Header ───

    private renderHeader(
        branch: string,
        ahead: number,
        behind: number,
        initialized: boolean,
        hasRealRepo: boolean,
        repositoryStatusAvailable = true,
        comparison: GitComparisonState = 'up-to-date',
    ): void {
        this.headerContainer.empty();
        this.headerContainer.addClass('git-repository-header');
        this.headerContainer.addClass(`git-header-${this.activeTab}`);

        const branchRow = this.headerContainer.createDiv('git-header-branch');
        const branchIcon = branchRow.createSpan({ cls: 'git-branch-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(branchIcon, 'git-branch');
        branchRow.createSpan({
            text: initialized ? branch : (hasRealRepo ? 'local' : 'No repo'),
            cls: 'git-branch-name' + (initialized ? '' : ' git-branch-uninit')
        });

        const headerAction = branchRow.createEl('button', {
            cls: 'git-header-refresh',
            attr: { title: 'Refresh git status', 'aria-label': 'Refresh git status' }
        });
        if (this.activeTab === 'log') {
            setIcon(headerAction, 'more-horizontal');
            headerAction.setAttr('title', 'Log actions');
            headerAction.setAttr('aria-label', 'Log actions');
            headerAction.addEventListener('click', (event) => this.openLogMenu(event));
        } else if (this.activeTab === 'commits') {
            setIcon(headerAction, 'chevron-down');
            headerAction.setAttr('title', 'Refresh commit history');
            headerAction.setAttr('aria-label', 'Refresh commit history');
            headerAction.addEventListener('click', () => void this.refreshFromButton(headerAction));
        } else {
            setIcon(headerAction, 'refresh-cw');
            headerAction.addEventListener('click', async (event) => {
                event.stopPropagation();
                await this.refreshFromButton(headerAction);
            });
        }

        const statusRow = this.headerContainer.createDiv('git-header-status');
        const statusIcon = statusRow.createSpan({ cls: 'git-header-status-icon', attr: { 'aria-hidden': 'true' } });
        if (!initialized) {
            setIcon(statusIcon, 'circle-alert');
            statusRow.createSpan({
                text: !hasRealRepo
                    ? 'No git repository — initialize to create'
                    : 'Git repo detected — initialize to sync',
                cls: 'git-header-hint'
            });
        } else if (this.isLocalOnly) {
            setIcon(statusIcon, 'circle-alert');
            statusRow.createSpan({ text: 'Local only — no remote', cls: 'git-local-only' });
        } else if (!repositoryStatusAvailable || comparison === 'unavailable') {
            setIcon(statusIcon, 'circle-alert');
            statusRow.createSpan({ text: 'Repository comparison unavailable', cls: 'git-header-hint' });
        } else if (comparison === 'local-only') {
            setIcon(statusIcon, 'cloud-off');
            statusRow.createSpan({ text: ahead > 0 ? `${ahead} local commit${ahead === 1 ? '' : 's'} not pushed` : 'No upstream branch', cls: 'git-header-hint' });
        } else if (ahead > 0 || behind > 0) {
            setIcon(statusIcon, 'arrow-up-down');
            statusRow.createSpan({
                text: `${ahead > 0 ? `⬆ ${ahead} to push` : ''}${ahead > 0 && behind > 0 ? ' · ' : ''}${behind > 0 ? `⬇ ${behind} to pull` : ''}`,
                cls: 'git-ahead-behind' + (ahead > 0 ? ' git-ahead' : '') + (behind > 0 ? ' git-behind' : '')
            });
        } else {
            setIcon(statusIcon, 'circle-check');
            statusRow.createSpan({ text: 'Up to date', cls: 'git-up-to-date' });
        }
    }

    // ─── Footer ───

    private renderFooter(container: HTMLElement): void {
        container.empty();
        container.addClass('git-sidebar-footer');
        if (this.activeTab !== 'status') {
            container.addClass('git-sidebar-footer-hidden');
            return;
        }
        container.removeClass('git-sidebar-footer-hidden');

        const btnRow = container.createDiv('git-footer-buttons-row');

        const commitBtn = new ButtonComponent(btnRow)
            .setButtonText(`Commit (${this.stagedCount})`)
            .setIcon('git-commit')
            .setTooltip(this.stagedCount > 0 ? 'Commit staged changes' : 'No staged files to commit')
            .setClass('git-btn-primary')
            .setDisabled(this.stagedCount === 0);
        commitBtn.onClick(() => this.openCommitModal());

        // Pull is displayed before Push to match the approved action hierarchy.
        new ButtonComponent(btnRow)
            .setButtonText('Pull')
            .setIcon('download')
            .setTooltip(this.hasRemote ? 'Pull from remote' : 'No remote configured — set repo URL in settings')
            .setClass('git-btn-secondary')
            .setDisabled(!this.hasRemote)
            .onClick(async () => {
                try {
                    if (!this.plugin.gitManager) {
                        new Notice('Git not initialized');
                        return;
                    }
                    if (!this.hasRemote) {
                        new Notice('No remote configured');
                        return;
                    }
                    await this.plugin.runGitMutation('Pull from remote', async (manager) => {
                        await this.plugin.refreshGitCredentials();
                        await manager.pull(this.plugin.settings.branchName);
                    });
                    new Notice('Pulled from remote');
                    this.invalidateRemoteCommitsCache();
                    await this.refresh();
                } catch (e: any) {
                    new Notice('Pull failed: ' + e.message);
                }
            });

        new ButtonComponent(btnRow)
            .setButtonText('Push')
            .setIcon('upload')
            .setTooltip(this.hasRemote ? 'Push to remote' : 'No remote configured — set repo URL in settings')
            .setClass('git-btn-secondary')
            .setDisabled(!this.hasRemote)
            .onClick(async () => {
                try {
                    if (!this.plugin.gitManager) {
                        new Notice('Git not initialized');
                        return;
                    }
                    if (!this.hasRemote) {
                        new Notice('No remote configured');
                        return;
                    }
                    await this.plugin.runGitMutation('Push to remote', async (manager) => {
                        await this.plugin.refreshGitCredentials();
                        await manager.push(this.plugin.settings.branchName);
                    });
                    new Notice('Pushed to remote');
                    this.invalidateRemoteCommitsCache();
                    await this.refresh();
                } catch (e: any) {
                    new Notice('Push failed: ' + e.message);
                }
            });

        new ButtonComponent(btnRow)
            .setButtonText('More')
            .setIcon('more-horizontal')
            .setTooltip('More Git actions')
            .setClass('git-btn-ghost')
            .onClick((event) => this.openMoreMenu(event));
    }

    private openCommitModal(): void {
        if (!this.plugin.gitManager || this.stagedCount === 0) {
            new Notice('Stage at least one file before committing');
            return;
        }

        const modal = new Modal(this.app);
        const defaultMessage = this.plugin.settings.autoCommitMessage
            .replace('{{date}}', new Date().toLocaleString()) || 'Update from Obsidian';
        modal.titleEl.setText(`Commit ${this.stagedCount} staged file${this.stagedCount === 1 ? '' : 's'}`);
        modal.contentEl.createEl('p', {
            text: 'Add a message so you can recognize this change later.',
            cls: 'git-commit-modal-description'
        });
        const input = new TextComponent(modal.contentEl)
            .setPlaceholder(defaultMessage);
        input.inputEl.addClass('git-commit-modal-input');

        const actions = modal.contentEl.createDiv('git-ignore-modal-actions');
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .setClass('git-btn-ghost')
            .onClick(() => modal.close());
        const commitButton = new ButtonComponent(actions)
            .setButtonText('Commit')
            .setClass('git-btn-primary');

        const commit = async () => {
            if (!this.plugin.gitManager) return;
            commitButton.setDisabled(true).setButtonText('Committing…');
            try {
                await this.plugin.runGitMutation('Commit changes', async (manager) => {
                    await manager.commit(input.getValue().trim() || defaultMessage);
                });
                modal.close();
                new Notice('Changes committed');
                this.invalidateRemoteCommitsCache();
                await this.refresh();
            } catch (e: any) {
                commitButton.setDisabled(false).setButtonText('Commit');
                new Notice('Commit failed: ' + e.message);
            }
        };
        commitButton.onClick(commit);
        input.inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') void commit();
        });
        modal.open();
        window.setTimeout(() => input.inputEl.focus(), 0);
    }

    private openMoreMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle('Edit .gitignore')
            .setIcon('file-edit')
            .onClick(async () => {
                try {
                    await this.plugin.openGitIgnore();
                } catch (e: any) {
                    new Notice('Could not open .gitignore: ' + e.message);
                }
            }));
        menu.addItem((item) => item
            .setTitle('Manage ignored patterns')
            .setIcon('list-filter')
            .onClick(() => this.openIgnorePatternModal()));
        menu.addSeparator();
        menu.addItem((item) => item
            .setTitle('Force push')
            .setIcon('upload')
            .onClick(() => void this.forcePush()));
        menu.showAtMouseEvent(event);
    }

    private async forcePush(): Promise<void> {
        if (!this.plugin.gitManager) {
            new Notice('Git not initialized');
            return;
        }
        if (!this.hasRemote) {
            new Notice('No remote configured');
            return;
        }
        if (!window.confirm(
            'Force push will overwrite remote history.\n\n' +
            'Only use this for first-time pushes or when you know the remote is safe to overwrite.\n\n' +
            'Continue?'
        )) return;

        try {
            await this.plugin.runGitMutation('Force push to remote', async (manager) => {
                await this.plugin.refreshGitCredentials();
                await manager.push(this.plugin.settings.branchName, true);
            });
            new Notice('Force pushed to remote');
            this.invalidateRemoteCommitsCache();
            await this.refresh();
        } catch (e: any) {
            new Notice('Force push failed: ' + e.message);
        }
    }

    // ─── Main refresh ───

    async refresh(options: { readRepository?: boolean; force?: boolean } = {}): Promise<void> {
        const generation = ++this.renderGeneration;
        const readRepository = options.readRepository !== false;

        // A user-requested refresh must not leave the previous file list on
        // screen if the adapter reports a transient stale-index/path error.
        // The next successful status scan replaces this snapshot atomically.
        if (readRepository && options.force) this.sidebarSnapshot = null;

        // Manager construction is intentionally read-only. It is also needed
        // for the remote/API history fallback when the vault has no .git.
        if (!this.plugin.gitManager) {
            await this.plugin.ensureGitManager();
        }
        if (!this.isCurrentRender(generation)) return;

        let hasReal = this.hasRealRepo;
        if (readRepository) {
            try {
                hasReal = await this.plugin.detectRealGitRepo();
            } catch (e) {
                log.warn('GitSidebar', 'detectRealGitRepo failed', e);
            }
            this.hasRealRepo = hasReal;
            if (!hasReal) this.sidebarSnapshot = null;

            if (hasReal && this.plugin.gitManager) {
                try {
                    // One statusMatrix read supplies the header's staged count
                    // and all Changes-tab rows. Branch/ahead/behind are read as
                    // part of the same immutable view model.
                    this.sidebarSnapshot = await this.plugin.gitManager.getSidebarStatusSnapshot();
                } catch (e) {
                    // Keep the last successful view during a transient mobile
                    // filesystem/index failure during background refreshes. A
                    // user-requested refresh must not continue showing a stale
                    // deleted path, so clear it and render an honest error.
                    log.warn('GitSidebar', 'Failed to read repository snapshot', e);
                    if (options.force) this.sidebarSnapshot = null;
                }
            }
        }
        if (!this.isCurrentRender(generation)) return;

        const initialized = hasReal;
        this.hasRemote = !!this.plugin.settings.repoUrl;
        this.isLocalOnly = !this.hasRemote;
        if (this.remoteCommitsCache && this.remoteCommitsCache.repoUrl !== this.plugin.settings.repoUrl) {
            this.invalidateRemoteCommitsCache();
        }

        const snapshot = this.sidebarSnapshot;
        const branch = snapshot?.branch || (initialized ? 'local' : 'No repo');
        const ahead = snapshot?.ahead || 0;
        const behind = snapshot?.behind || 0;
        const repositoryStatusAvailable = snapshot?.repositoryStatusAvailable !== false;
        const comparison = snapshot?.comparison || (repositoryStatusAvailable ? 'up-to-date' : 'unavailable');

        this.renderHeader(branch, ahead, behind, initialized, hasReal, repositoryStatusAvailable, comparison);
        this.stagedCount = snapshot?.staged.length || 0;
        this.contentContainer.empty();

        // Remote history is an independent read capability. Keep it available
        // when the local repository is absent, while local Changes/Log content
        // still explains how to initialize the vault.
        const remoteHistoryOnly = this.activeTab === 'commits'
            && this.commitsViewMode === 'remote'
            && this.hasRemote;
        if (!initialized && !remoteHistoryOnly) {
            await this.renderUninitializedContent(hasReal);
        } else {
            switch (this.activeTab) {
                case 'status':
                    this.renderStatusTab(snapshot);
                    break;
                case 'commits':
                    await this.renderCommitsTab(generation);
                    break;
                case 'log':
                    await this.renderLogTab();
                    break;
            }
        }

        if (!this.isCurrentRender(generation)) return;
        const footerEl = this.containerEl.querySelector('.git-sidebar-footer') as HTMLElement;
        if (footerEl) this.renderFooter(footerEl);
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
                            await this.plugin.syncVault(true);
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
                    await this.plugin.initializeNewRepo();
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
                        await this.plugin.syncVault(true);
                        new Notice('Remote cloned');
                        await this.refresh();
                    } catch (e: any) {
                        new Notice('Clone failed: ' + e.message);
                    }
                });
        }
    }

    // ─── Tab renders ───

    private renderStatusTab(snapshot: GitSidebarStatusSnapshot | null): void {
        const container = this.contentContainer.createDiv('git-status-container');

        try {
            if (!snapshot) {
                container.createEl('p', { text: 'Unable to read repository status', cls: 'git-empty-state' });
                return;
            }

            const { staged, unstaged, detailedStatus } = snapshot;
            const statusByPath = new Map(
                detailedStatus.map((file) => [file.filepath, file.status] as const)
            );
            this.stagedCount = staged.length;

            // ── Staged section ── (always show, default collapsed if empty)
            this.renderCollapsibleSection(container, 'Staged', staged, 'staged', 'Unstage all', statusByPath,
                async (fp) => {
                    await this.plugin.runGitMutation('Unstage file', async (manager) => {
                        await manager.unstageFile(fp);
                    });
                    new Notice(`Unstaged ${fp}`);
                },
                async () => {
                    await this.plugin.runGitMutation('Unstage all files', async (manager) => {
                        await manager.unstageAll();
                    });
                    new Notice('All files unstaged');
                }
            );

            // ── Uncommitted section ── (always show, default collapsed if empty)
            this.renderCollapsibleSection(container, 'Uncommitted Changes', unstaged, 'unstaged', 'Stage all', statusByPath,
                async (fp) => {
                    await this.plugin.runGitMutation('Stage file', async (manager) => {
                        await manager.stageFile(fp);
                    });
                    new Notice(`Staged ${fp}`);
                },
                async () => {
                    const result = await this.plugin.runGitMutation('Stage all files', async (manager) => {
                        return manager.addAll(unstaged);
                    });
                    if (result.failed.length > 0) {
                        const firstFailure = result.failed[0];
                        new Notice(
                            `Staged ${result.staged.length} of ${result.requested} files. ` +
                            `${result.failed.length} failed (first: ${firstFailure.filepath}).`
                        );
                    } else {
                        new Notice(`Staged ${result.staged.length} file${result.staged.length === 1 ? '' : 's'}.`);
                    }
                }
            );

        } catch (e: any) {
            log.warn('GitSidebar', 'Failed to get file status', e);
            container.empty();

            if (e.isPackIndexError || e.message?.includes('Pack index')) {
                const errContainer = container.createDiv('git-uninit-container');
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
                const errContainer = container.createDiv('git-uninit-container');
                errContainer.createEl('p', { text: 'Error reading git status', cls: 'git-uninit-title' });
                errContainer.createEl('p', { text: e.message || String(e), cls: 'git-uninit-desc' });
            }
        }
    }

    private renderCollapsibleSection(
        container: HTMLElement,
        title: string,
        files: string[],
        sectionClass: string,
        bulkLabel: string,
        statusByPath: Map<string, GitFileStatus['status']>,
        onAction: (filepath: string) => Promise<void>,
        onBulk: () => Promise<void>
    ): void {
        const section = container.createDiv(`git-status-section git-status-section-${sectionClass}`);
        
        // Default: expanded if files exist, collapsed if empty
        const isCollapsed = files.length === 0;
        section.setAttr('data-collapsed', String(isCollapsed));

        // Header with toggle arrow + title + count + bulk button
        const header = section.createDiv('git-status-section-header');
        
        const toggle = header.createEl('button', {
            cls: 'git-section-toggle',
            attr: { type: 'button', 'aria-label': `${title} section` }
        });
        toggle.setText(isCollapsed ? '▸' : '▾');
        toggle.setAttr('aria-expanded', String(!isCollapsed));
        
        header.createSpan({ text: title, cls: 'git-status-section-label' });
        
        // File count badge
        const countBadge = header.createSpan({ 
            text: String(files.length), 
            cls: 'git-status-section-count' 
        });
        
        // Bulk action button (always visible)
        const bulkBtn = header.createEl('button', { cls: 'git-status-section-action' }) as HTMLButtonElement;
        setIcon(bulkBtn, sectionClass === 'staged' ? 'minus' : 'plus');
        bulkBtn.disabled = files.length === 0;
        bulkBtn.setAttr('title', bulkLabel);
        bulkBtn.setAttr('aria-label', bulkLabel);
        bulkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (bulkBtn.disabled || this.mutationInFlight) return;
            this.setMutationBusy(true);
            bulkBtn.disabled = true;
            bulkBtn.textContent = 'Working…';
            bulkBtn.setAttr('aria-busy', 'true');
            try {
                await onBulk();
                await this.refresh();
            } catch (err: any) {
                new Notice(`${bulkLabel} failed: ${err.message}`);
            } finally {
                this.setMutationBusy(false);
                if (bulkBtn.isConnected) {
                    bulkBtn.disabled = false;
                    bulkBtn.empty();
                    setIcon(bulkBtn, sectionClass === 'staged' ? 'minus' : 'plus');
                    bulkBtn.removeAttribute('aria-busy');
                }
            }
        });

        // Toggle fold/unfold on header click (but not on bulk button)
        header.addEventListener('click', (e) => {
            if (e.target === bulkBtn || bulkBtn.contains(e.target as Node)) return;
            const currentlyCollapsed = section.getAttr('data-collapsed') === 'true';
            section.setAttr('data-collapsed', String(!currentlyCollapsed));
            toggle.setText(!currentlyCollapsed ? '▸' : '▾');
            toggle.setAttr('aria-expanded', String(currentlyCollapsed));
        });

        const list = section.createDiv('git-status-section-list');
        
        if (files.length === 0) {
            const emptyMsg = sectionClass === 'staged' 
                ? 'No staged files' 
                : 'No uncommitted changes';
            list.createEl('p', { text: emptyMsg, cls: 'git-empty-state' });
        } else {
            for (const filepath of files) {
                const row = list.createDiv('git-file-row');

                const stageBtn = row.createEl('button', {
                    cls: 'git-file-stage-toggle',
                    attr: {
                        type: 'button',
                        title: sectionClass === 'staged' ? 'Unstage file' : 'Stage file',
                        'aria-label': `${sectionClass === 'staged' ? 'Unstage' : 'Stage'} ${filepath}`
                    }
                });
                setIcon(stageBtn, sectionClass === 'staged' ? 'square-check' : 'square');
                stageBtn.addClass(sectionClass === 'staged' ? 'git-file-stage-checked' : 'git-file-stage-empty');

                const status = statusByPath.get(filepath);
                const statusLabel = status === 'deleted'
                    ? 'D'
                    : status === 'added' || status === 'untracked'
                        ? 'A'
                        : 'M';
                const statusClass = status === 'deleted'
                    ? 'git-status-deleted'
                    : status === 'modified' || status === 'staged'
                        ? 'git-status-modified'
                        : 'git-status-added';
                row.createSpan({ text: statusLabel, cls: `git-status-icon ${statusClass}` });

                const pathEl = row.createSpan({ text: filepath, cls: 'git-file-path' });
                pathEl.setAttr('title', filepath);

                const actions = row.createDiv('git-file-actions');

                const moreBtn = actions.createEl('button', { cls: 'git-file-btn' });
                setIcon(moreBtn, 'more-horizontal');
                moreBtn.setAttr('title', 'More file actions');
                moreBtn.setAttr('aria-label', `More actions for ${filepath}`);
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menu = new Menu();
                    if (filepath !== '.gitignore') {
                        menu.addItem((item) => item
                            .setTitle('Ignore this file')
                            .setIcon('file-minus')
                            .onClick(async () => {
                                try {
                                    const pattern = `/${filepath.replace(/^\/+/, '')}`;
                                    const currentStatus = statusByPath.get(filepath);
                                    const added = await this.plugin.addGitIgnorePattern(pattern);
                                    await this.refresh();

                                    if (!added) {
                                        new Notice(`${pattern} is already in .gitignore`);
                                    } else if (currentStatus !== 'untracked') {
                                        new Notice(
                                            `Added ${pattern} to .gitignore. ${filepath} remains in Changes because it is tracked or staged.`,
                                        );
                                    } else {
                                        const stillListed = this.sidebarSnapshot?.detailedStatus.some(
                                            (file) => file.filepath === filepath,
                                        );
                                        new Notice(stillListed
                                            ? `Added ${pattern} to .gitignore, but ${filepath} is still listed after refresh.`
                                            : `Ignored ${filepath}; removed from local changes.`);
                                    }
                                } catch (err: any) {
                                    new Notice(`Could not update .gitignore: ${err.message}`);
                                }
                            }));
                    }
                    menu.addItem((item) => item
                        .setTitle('Edit .gitignore')
                        .setIcon('file-edit')
                        .onClick(async () => {
                            try {
                                await this.plugin.openGitIgnore();
                            } catch (err: any) {
                                new Notice('Could not open .gitignore: ' + err.message);
                            }
                        }));
                    menu.showAtMouseEvent(e);
                });

                stageBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (this.mutationInFlight) return;
                    this.setMutationBusy(true);
                    stageBtn.disabled = true;
                    stageBtn.addClass('git-file-stage-busy');
                    stageBtn.setAttr('aria-busy', 'true');
                    try {
                        await onAction(filepath);
                        await this.refresh();
                    } catch (err: any) {
                        new Notice(`${sectionClass === 'staged' ? 'Unstage' : 'Stage'} failed: ${err.message}`);
                    } finally {
                        this.setMutationBusy(false);
                        if (stageBtn.isConnected) {
                            stageBtn.disabled = false;
                            stageBtn.removeClass('git-file-stage-busy');
                            stageBtn.removeAttribute('aria-busy');
                            setIcon(stageBtn, sectionClass === 'staged' ? 'square-check' : 'square');
                        }
                    }
                });
            }
        }
    }

    private setMutationBusy(busy: boolean): void {
        this.mutationInFlight = busy;
        const controls = this.contentContainer?.querySelectorAll<HTMLButtonElement>(
            '.git-file-stage-toggle, .git-status-section-action',
        ) || [];
        controls.forEach((control) => {
            control.disabled = busy;
            control.setAttr('aria-busy', String(busy));
            if (busy) control.addClass('git-file-stage-busy');
            else control.removeClass('git-file-stage-busy');
        });
    }

    private openIgnorePatternModal(): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Add .gitignore pattern');

        const description = modal.contentEl.createEl('p', {
            text: 'Enter a Git ignore pattern. Examples: attachments/ or temp/**',
            cls: 'git-ignore-modal-description'
        });
        description.setAttr('aria-live', 'polite');

        const input = new TextComponent(modal.contentEl)
            .setPlaceholder('attachments/');
        input.inputEl.addClass('git-ignore-modal-input');

        const actions = modal.contentEl.createDiv('git-ignore-modal-actions');
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .setClass('git-btn-ghost')
            .onClick(() => modal.close());
        const addButton = new ButtonComponent(actions)
            .setButtonText('Add pattern')
            .setClass('git-btn-primary');

        const submit = async () => {
            try {
                const pattern = input.getValue().trim();
                const added = await this.plugin.addGitIgnorePattern(pattern);
                modal.close();
                new Notice(added
                    ? `Added ${pattern} to .gitignore`
                    : `${pattern} is already in .gitignore`);
                await this.refresh();
            } catch (e: any) {
                new Notice(`Could not update .gitignore: ${e.message}`);
            }
        };

        addButton.onClick(submit);
        input.inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') void submit();
        });
        modal.open();
        window.setTimeout(() => input.inputEl.focus(), 0);
    }

    private async renderCommitsTab(generation: number): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-log-list');

        // Toggle bar: Local / Remote
        const toggleBar = listContainer.createDiv('git-commits-toggle-bar');
        const localBtn = toggleBar.createEl('button', {
            text: 'Local',
            cls: 'git-commits-toggle-btn' + (this.commitsViewMode === 'local' ? ' git-commits-toggle-active' : ''),
            attr: { role: 'tab', 'aria-selected': String(this.commitsViewMode === 'local') }
        });
        localBtn.addEventListener('click', async () => {
            this.commitsViewMode = 'local';
            await this.refresh({ readRepository: false });
        });
        const remoteBtn = toggleBar.createEl('button', {
            text: 'Remote',
            cls: 'git-commits-toggle-btn' + (this.commitsViewMode === 'remote' ? ' git-commits-toggle-active' : ''),
            attr: { role: 'tab', 'aria-selected': String(this.commitsViewMode === 'remote') }
        });
        remoteBtn.addEventListener('click', async () => {
            this.commitsViewMode = 'remote';
            await this.refresh({ readRepository: false });
        });

        const loading = this.commitsViewMode === 'remote'
            ? listContainer.createEl('p', { text: 'Loading remote commits…', cls: 'git-empty-state' })
            : null;

        try {
            let branch = this.plugin.settings.branchName || 'main';
            let commits: GitCommit[] = [];

            if (this.commitsViewMode === 'local') {
                // Local commits: need gitManager
                if (!this.plugin.gitManager) {
                    listContainer.createEl('p', {
                        text: 'No local repository — initialize or clone to see local commits',
                        cls: 'git-empty-state'
                    });
                    return;
                }
                branch = await this.plugin.gitManager.getCurrentBranch();
                if (this.localCommitsCache?.branch === branch) {
                    commits = this.localCommitsCache.commits;
                } else {
                    commits = await this.plugin.gitManager.getLog(25);
                    this.localCommitsCache = { branch, commits };
                    getSidebarHistoryCache(this.plugin).localCommits = this.localCommitsCache;
                }
            } else {
                // Remote history is independent of local repository health.
                // Use the configured branch and query GitHub first so stale or
                // damaged origin refs cannot hide the actual remote history.
                const remoteUrl = this.plugin.settings.repoUrl;
                const cached = this.remoteCommitsCache?.repoUrl === this.plugin.settings.repoUrl
                    && this.remoteCommitsCache.branch === branch
                    ? this.remoteCommitsCache.commits
                    : null;
                if (cached !== null) {
                    commits = cached;
                } else {
                    const password = await this.plugin.resolveGitPassword();
                    commits = await GitManager.fetchRemoteCommitsFromGitHub(remoteUrl, password, branch, 25);
                    if (commits.length === 0 && this.plugin.gitManager) {
                        // Non-GitHub remotes still use their fetched origin ref.
                        commits = await this.plugin.gitManager.getRemoteLog(branch, 25);
                    }
                }
                this.remoteCommitsCache = { repoUrl: remoteUrl, branch, commits };
                getSidebarHistoryCache(this.plugin).remoteCommits = this.remoteCommitsCache;
            }

            loading?.remove();

            if (!this.isCurrentRender(generation)) return;

            if (commits.length === 0) {
                const emptyMsg = this.commitsViewMode === 'local'
                    ? 'No commits yet — stage files and commit to create your first commit'
                    : this.plugin.settings.repoUrl
                        ? `No remote commits found on ${branch} — check your repo URL and token`
                        : 'No remote URL configured — add one in settings to see remote commits';
                listContainer.createEl('p', { text: emptyMsg, cls: 'git-empty-state' });
                return;
            }

            for (const commit of commits) {
                const isExpanded = this.expandedCommitOids.has(commit.oid);
                const row = listContainer.createDiv('git-commit-row' + (this.commitsViewMode === 'remote' ? ' git-commit-remote' : ' git-commit-local'));
                row.setAttr('data-oid', commit.oid);
                row.setAttr('data-expanded', String(isExpanded));
                row.setAttr('role', 'article');
                row.setAttr('aria-expanded', String(isExpanded));

                const mainRow = row.createDiv('git-commit-main');
                const timeline = mainRow.createSpan({
                    cls: 'git-commit-timeline',
                    attr: { 'aria-hidden': 'true' }
                });
                const timelineDot = timeline.createSpan({ cls: 'git-commit-timeline-dot' });
                if (isExpanded) timelineDot.addClass('git-commit-timeline-dot-active');

                const body = mainRow.createDiv('git-commit-body');
                const summary = body.createDiv('git-commit-summary');
                const msg = summary.createSpan({
                    text: this.truncateMessage(commit.message),
                    cls: 'git-commit-message'
                });
                msg.setAttr('title', commit.message);
                summary.createSpan({ text: this.formatDate(commit.date), cls: 'git-commit-date' });

                const meta = body.createDiv('git-commit-meta');
                const hash = meta.createSpan({ text: commit.oid.slice(0, 7), cls: 'git-commit-hash' });
                hash.setAttr('title', commit.oid);
                meta.createSpan({ text: commit.author, cls: 'git-commit-author' });
                meta.createSpan({
                    text: this.commitsViewMode === 'remote' ? 'origin' : 'local',
                    cls: this.commitsViewMode === 'remote' ? 'git-commit-remote-badge' : 'git-commit-local-badge',
                });
                const toggle = meta.createSpan({ cls: 'git-commit-toggle', attr: { 'aria-hidden': 'true' } });
                toggle.setText(isExpanded ? '⌄' : '›');

                // Click ANYWHERE on the row to expand/collapse — not just the padded mainRow area
                row.addEventListener('click', async (e) => {
                    // Don't toggle if clicking a link or button inside the detail view
                    const target = e.target as HTMLElement;
                    if (target.closest('a') || target.closest('button')) return;
                    
                    const currentlyExpanded = this.expandedCommitOids.has(commit.oid);
                    if (currentlyExpanded) {
                        this.expandedCommitOids.delete(commit.oid);
                        row.setAttr('data-expanded', 'false');
                        row.setAttr('aria-expanded', 'false');
                        toggle.setText('›');
                        timelineDot.removeClass('git-commit-timeline-dot-active');
                        const detailEl = row.querySelector('.git-commit-detail');
                        if (detailEl) detailEl.remove();
                    } else {
                        this.expandedCommitOids.add(commit.oid);
                        row.setAttr('data-expanded', 'true');
                        row.setAttr('aria-expanded', 'true');
                        toggle.setText('⌄');
                        timelineDot.addClass('git-commit-timeline-dot-active');
                        await this.renderCommitDetail(row, commit.oid);
                    }
                });

                // If already expanded, render detail
                if (isExpanded) {
                    await this.renderCommitDetail(row, commit.oid);
                }
            }
        } catch (e: any) {
            loading?.remove();
            log.debug('GitSidebar', 'Failed to get commit log', e);
            const msg = e.message || String(e);
            if (msg.includes('Could not find') || msg.includes('refs/head') || msg.includes('unknown revision') || msg.includes('Not a valid')) {
                listContainer.empty();
                const empty = listContainer.createDiv('git-uninit-container');
                empty.createEl('p', { text: 'No commits yet', cls: 'git-uninit-title' });
                empty.createEl('p', { text: 'Stage files and commit to create your first commit.', cls: 'git-uninit-desc' });
            } else {
                listContainer.createEl('p', { text: 'Unable to read commit history', cls: 'git-empty-state' });
            }
        }
    }

    private async renderCommitDetail(row: HTMLElement, oid: string): Promise<void> {
        // Remove existing detail if any
        const existing = row.querySelector('.git-commit-detail');
        if (existing) existing.remove();

        const detail = row.createDiv('git-commit-detail');
        detail.createDiv('git-commit-detail-loading').setText('Loading...');

        try {
            let files: { filepath: string; status: 'added' | 'modified' | 'deleted' }[] = [];
            const cachedFiles = this.commitDetailsCache.get(oid);
            if (cachedFiles) files = cachedFiles;
            
            // Use the API directly when remote history is being viewed without
            // a healthy local repository. Otherwise prefer the local object
            // database and retain the shallow-history fallback.
            if (cachedFiles) {
                // Details are immutable for a commit; avoid repeating local or
                // GitHub reads when a row is collapsed and expanded again.
            } else if (this.commitsViewMode === 'remote' && this.plugin.settings.repoUrl && !this.hasRealRepo) {
                detail.querySelector('.git-commit-detail-loading')?.setText('Fetching from GitHub...');
                const remoteFiles = await GitManager.fetchCommitFilesFromGitHub(
                    this.plugin.settings.repoUrl,
                    await this.plugin.resolveGitPassword(),
                    oid
                );
                if (remoteFiles) {
                    files = remoteFiles;
                }
            } else if (this.plugin.gitManager) {
                try {
                    files = await this.plugin.gitManager.getCommitFiles(oid);
                } catch (error) {
                    // A damaged local repository should not prevent the
                    // remote commit-details fallback from being attempted.
                    log.debug('GitSidebar', 'Local commit details unavailable; trying remote fallback', error);
                }
            }

            // If no files were found locally and we're viewing remote commits,
            // try GitHub API for shallow clones as well.
            if (files.length === 0 && this.commitsViewMode === 'remote' && this.plugin.settings.repoUrl) {
                detail.querySelector('.git-commit-detail-loading')?.setText('Fetching from GitHub...');
                const remoteFiles = await GitManager.fetchCommitFilesFromGitHub(
                    this.plugin.settings.repoUrl,
                    await this.plugin.resolveGitPassword(),
                    oid
                );
                if (remoteFiles) {
                    files = remoteFiles;
                }
            }

            this.commitDetailsCache.set(oid, files);
            
            detail.empty();

            if (files.length === 0) {
                // Check if this is a shallow clone situation
                const isRemoteMode = this.commitsViewMode === 'remote';
                const msg = isRemoteMode
                    ? 'Commit details not available locally. Try initializing with full history, or this commit may be empty.'
                    : 'No file changes detected';
                detail.createEl('p', { text: msg, cls: 'git-commit-detail-empty' });
                return;
            }

            for (const f of files) {
                const fileRow = detail.createDiv('git-commit-file-row');
                const iconSpan = fileRow.createSpan({ cls: 'git-commit-file-icon' });
                if (f.status === 'added') {
                    iconSpan.setText('+');
                    iconSpan.addClass('git-commit-file-added');
                } else if (f.status === 'deleted') {
                    iconSpan.setText('−');
                    iconSpan.addClass('git-commit-file-deleted');
                } else {
                    iconSpan.setText('●');
                    iconSpan.addClass('git-commit-file-modified');
                }
                fileRow.createSpan({ text: f.filepath, cls: 'git-commit-file-path' });
                fileRow.createSpan({ text: f.status, cls: 'git-commit-file-status' });
            }
        } catch (e) {
            detail.empty();
            detail.createEl('p', { text: 'Failed to load file changes', cls: 'git-commit-detail-empty' });
        }
    }

    private async renderHistoryTab(): Promise<void> {
        // Deprecated: renamed to renderCommitsTab
        await this.renderCommitsTab(this.renderGeneration);
    }

    private async renderLogTab(): Promise<void> {
        const listContainer = this.contentContainer.createDiv('git-log-list');

        const toolbar = listContainer.createDiv('git-log-toolbar');
        toolbar.createEl('h2', { text: 'Activity', cls: 'git-log-toolbar-title' });
        
        const currentLogEntries = log.getEntries();
        const cacheStale = this.logEntriesCache
            && currentLogEntries.length !== this.logEntriesCache.length;
        if (!this.logEntriesCache || cacheStale) {
            const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
            log.mergePersistedEntries(persisted);
            this.logEntriesCache = log.getEntries();
        }
        const entries = this.logEntriesCache;
        
        if (entries.length === 0) {
            listContainer.createEl('p', { text: 'No activity yet', cls: 'git-empty-state' });
            return;
        }

        const recent = [...entries].reverse().slice(0, 50);
        
        for (const entry of recent) {
            const row = listContainer.createDiv('git-log-entry');
            
            const time = row.createSpan({
                text: this.formatLogTime(new Date(entry.timestamp)),
                cls: 'git-log-time' 
            });
            
            const level = row.createSpan({ 
                text: entry.level.toUpperCase(), 
                cls: 'git-log-level git-log-' + entry.level 
            });
            
            const message = row.createSpan({
                text: entry.message,
                cls: 'git-log-message' 
            });
            message.setAttr('title', `[${entry.namespace}] ${entry.message}`);
            
            if (entry.data) {
                const detail = row.createDiv('git-log-detail');
                detail.setText(typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data).slice(0, 200));
            }
        }
    }

    private openLogMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle('Export log')
            .setIcon('download')
            .onClick(async () => {
                try {
                    if (!this.logEntriesCache) {
                        const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
                        log.mergePersistedEntries(persisted);
                        this.logEntriesCache = log.getEntries();
                    }
                    const path = await log.exportToFile(this.app.vault);
                    new Notice(`Log exported to ${path}`);
                } catch (e: any) {
                    new Notice('Could not export log: ' + e.message);
                }
            }));
        menu.addItem((item) => item
            .setTitle('Clear log')
            .setIcon('trash-2')
            .onClick(async () => {
                log.clear();
                await this.plugin.fileLogger?.clear();
                this.logEntriesCache = [];
                new Notice('Activity log cleared');
                this.contentContainer.empty();
                await this.renderLogTab();
            }));
        menu.addItem((item) => item
            .setTitle('Copy details')
            .setIcon('copy')
            .onClick(async () => {
                if (!this.logEntriesCache) {
                    const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
                    log.mergePersistedEntries(persisted);
                    this.logEntriesCache = log.getEntries();
                }
                const entries = [...this.logEntriesCache].reverse().slice(0, 50);
                const details = entries.length === 0
                    ? 'No activity yet'
                    : entries.map((entry) => {
                        const time = new Date(entry.timestamp).toISOString();
                        const data = entry.data ? `\n${typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data)}` : '';
                        return `${time} ${entry.level.toUpperCase()} [${entry.namespace}] ${entry.message}${data}`;
                    }).join('\n');
                try {
                    await navigator.clipboard.writeText(details);
                    new Notice('Log details copied');
                } catch (e: any) {
                    new Notice('Could not copy log details: ' + e.message);
                }
            }));
        menu.showAtMouseEvent(event);
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

    private formatLogTime(date: Date): string {
        return date.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }
}
