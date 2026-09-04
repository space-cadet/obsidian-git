import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, Modal, TextComponent, Menu, setIcon } from 'obsidian';
import GitSyncPlugin from '../main';
import { GitFileStatus, GitCommit, GitSidebarStatusSnapshot, GitComparisonState } from '../backend/obsidianAdapter';
import { parseGitHubRepositoryUrl } from '../backend/githubApi';
import { log } from '../logger';
import { SidebarReadModel } from '../sidebarReadModel';
import { createProgressModal } from '../ui/GitProgressModal';

export const VIEW_TYPE_GIT_SIDEBAR = 'git-sidebar-view';

type SidebarTab = 'status' | 'commits' | 'log';

// Keep immutable history data for the lifetime of the plugin, not only for
// the lifetime of one ItemView instance. Obsidian can recreate a sidebar view
// when the workspace is backgrounded or its leaf is restored.
const sidebarReadModels = new WeakMap<GitSyncPlugin, SidebarReadModel>();

function getSidebarReadModel(plugin: GitSyncPlugin): SidebarReadModel {
    let model = sidebarReadModels.get(plugin);
    if (!model) {
        model = new SidebarReadModel();
        sidebarReadModels.set(plugin, model);
    }
    return model;
}

export class GitSidebarView extends ItemView {
    plugin: GitSyncPlugin;
    private contentContainer: HTMLElement;
    private headerContainer: HTMLElement;
    private tabsContainer: HTMLElement;
    private refreshInterval: number | null = null;
    private remoteFetchInterval: number | null = null;
    private stagedCount: number = 0;
    private activeTab: SidebarTab = 'status';
    private commitsViewMode: 'local' | 'remote' = 'local';
    private expandedCommitOids: Set<string> = new Set();
    private hasRemote: boolean = false;
    private isLocalOnly: boolean = false;
    private hasRealRepo: boolean = false;
    private sidebarSnapshot: GitSidebarStatusSnapshot | null = null;
    private readonly readModel: SidebarReadModel;
    private readonly tabContainers = new Map<SidebarTab, HTMLElement>();
    private readonly renderedTabs = new Set<SidebarTab>();
    private renderGeneration = 0;
    private logUnsubscribe: (() => void) | null = null;
    private logRenderScheduled = false;
    private mutationInFlight = false;
    private repositoryStateKnown = false;
    private repositoryReadInFlight: Promise<void> | null = null;
    private statusRevision = 0;
    private renderedStatusRevision = -1;
    private renderedHeaderKey: string | null = null;
    private renderedFooterKey: string | null = null;
    private commitInFlight = false;
    private ignorePatternInFlight = false;

    constructor(leaf: WorkspaceLeaf, plugin: GitSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.readModel = getSidebarReadModel(plugin);
        this.sidebarSnapshot = this.readModel.getStatusSnapshot();
        this.repositoryStateKnown = this.sidebarSnapshot !== null;
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
        this.tabContainers.clear();
        this.renderedTabs.clear();
        this.renderedStatusRevision = -1;
        this.renderedHeaderKey = null;
        this.renderedFooterKey = null;
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
            this.readModel.invalidateLogs();
            if (this.activeTab !== 'log' || this.logRenderScheduled) return;
            this.logRenderScheduled = true;
            window.setTimeout(() => {
                this.logRenderScheduled = false;
                if (this.activeTab === 'log' && this.containerEl.isConnected) {
                    void this.refresh({ readRepository: false }).catch((error) => {
                        log.debug('GitSidebar', 'Log refresh failed', error);
                    });
                }
            }, 0);
        });
        // Obsidian emits vault events for deletes made through the file
        // manager (and for external changes once its watcher notices them).
        // Refresh the status snapshot immediately instead of waiting for the
        // periodic timer or requiring a second navigation.
        this.registerEvent(this.app.vault.on('delete', () => {
            if (this.containerEl.isConnected) {
                void this.refresh({ force: true }).catch((error) => {
                    log.debug('GitSidebar', 'Delete-triggered refresh failed', error);
                });
            }
        }));

        // 4. Footer actions
        const footer = container.createDiv('git-sidebar-footer');
        this.renderFooter(footer);

        // Initial repository reads must not hold the view open. The shell and
        // the last known snapshot are usable immediately; refresh reconciles
        // them in the background.
        void this.refresh().catch((error) => {
            log.warn('GitSidebar', 'Initial sidebar refresh failed', error);
        });

        // Auto-refresh with configured interval. The refresh path is
        // single-flight, so a slow mobile read cannot spawn another scan.
        this.startAutoRefresh();
        this.startRemoteFetchSchedule();
    }

    async onClose(): Promise<void> {
        this.stopAutoRefresh();
        this.stopRemoteFetchSchedule();
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
                if (this.containerEl.isShown() && !this.repositoryReadInFlight) {
                    void this.refresh({ skipIfRepositoryReadInFlight: true }).catch((error) => {
                        log.debug('GitSidebar', 'Automatic sidebar refresh failed', error);
                    });
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

    private startRemoteFetchSchedule(): void {
        this.stopRemoteFetchSchedule();
        const ms = this.plugin.settings.remoteFetchInterval * 60 * 1000;
        if (ms > 0) {
            this.remoteFetchInterval = window.setInterval(() => {
                if (!this.containerEl.isShown() || !this.hasRemote
                    || this.activeTab !== 'commits' || this.commitsViewMode !== 'remote') return;
                this.invalidateRemoteCommitsCache();
                void this.refresh({ readRepository: false, force: true }).catch((error) => {
                    log.debug('GitSidebar', 'Scheduled remote commit fetch failed', error);
                });
            }, ms);
        }
    }

    private stopRemoteFetchSchedule(): void {
        if (this.remoteFetchInterval !== null) {
            window.clearInterval(this.remoteFetchInterval);
            this.remoteFetchInterval = null;
        }
    }

    updateRemoteFetchInterval(minutes: number): void {
        this.plugin.settings.remoteFetchInterval = minutes;
        this.startRemoteFetchSchedule();
    }

    private invalidateRemoteCommitsCache(): void {
        this.readModel.invalidateHistory();
        this.invalidateTab('commits');
    }

    private tabContainer(tab: SidebarTab): HTMLElement {
        let pane = this.tabContainers.get(tab);
        if (!pane) {
            pane = this.contentContainer.createDiv('git-sidebar-tab-pane');
            pane.setAttr('data-tab', tab);
            this.tabContainers.set(tab, pane);
        }
        for (const [otherTab, otherPane] of this.tabContainers) {
            otherPane.toggleAttribute('hidden', otherTab !== tab);
        }
        return pane;
    }

    private invalidateTab(tab: SidebarTab): void {
        this.renderedTabs.delete(tab);
        this.tabContainers.get(tab)?.empty();
    }

    private isCurrentRender(generation: number): boolean {
        return generation === this.renderGeneration && this.containerEl.isConnected;
    }

    /**
     * Apply the known result of a completed single-file mutation to the
     * current snapshot before repainting. The next full refresh will still
     * reconcile against Git, but the completed user action must not wait for a
     * second whole-vault status scan before becoming visible.
     */
    private applyFileMutationToSnapshot(filepath: string, destination: 'staged' | 'unstaged'): void {
        if (!this.sidebarSnapshot) return;

        const staged = this.sidebarSnapshot.staged.filter((path) => path !== filepath);
        const unstaged = this.sidebarSnapshot.unstaged.filter((path) => path !== filepath);
        if (destination === 'staged') staged.push(filepath);
        else unstaged.push(filepath);

        this.sidebarSnapshot = {
            ...this.sidebarSnapshot,
            staged,
            unstaged,
        };
    }

    private repaintStatusSnapshot(): void {
        if (this.activeTab !== 'status') return;
        const pane = this.tabContainer('status');
        pane.empty();
        this.renderStatusTab(this.sidebarSnapshot, pane);
        this.renderedTabs.add('status');
        this.renderedStatusRevision = this.statusRevision;
        this.renderedFooterKey = null;
        const footerEl = this.containerEl.querySelector('.git-sidebar-footer') as HTMLElement;
        if (footerEl) this.renderFooter(footerEl);
    }

    private async refreshFromButton(button: HTMLButtonElement): Promise<void> {
        if (button.disabled) return;
        button.disabled = true;
        button.addClass('git-header-refreshing');
        button.setAttr('aria-busy', 'true');
        try {
            await this.refresh({ force: true });
        } catch (error: any) {
            new Notice('Refresh failed: ' + (error?.message || String(error)));
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
            btn.addEventListener('click', () => {
                this.activeTab = tab.id;
                this.renderTabs();
                void this.refresh({ readRepository: false }).catch((error) => {
                    log.debug('GitSidebar', 'Tab refresh failed', error);
                });
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

        const statusRow = branchRow.createDiv('git-header-status');
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
                let progress: ReturnType<typeof createProgressModal> | null = null;
                try {
                    if (!this.plugin.gitManager) {
                        new Notice('Git not initialized');
                        return;
                    }
                    if (!this.hasRemote) {
                        new Notice('No remote configured');
                        return;
                    }
                    progress = createProgressModal(this.app, 'Pulling from remote');
                    await this.plugin.runGitMutation('Pull from remote', async (manager) => {
                        await this.plugin.refreshGitCredentials();
                        manager.setProgressHandle(progress!);
                        try {
                            await manager.pull(this.plugin.settings.branchName);
                            progress!.complete('Pull complete');
                        } finally {
                            manager.setProgressHandle(undefined);
                        }
                    });
                    new Notice('Pulled from remote');
                    this.invalidateRemoteCommitsCache();
                    await this.refresh();
                } catch (e: any) {
                    progress?.fail(e);
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
                let progress: ReturnType<typeof createProgressModal> | null = null;
                try {
                    if (!this.plugin.gitManager) {
                        new Notice('Git not initialized');
                        return;
                    }
                    if (!this.hasRemote) {
                        new Notice('No remote configured');
                        return;
                    }
                    progress = createProgressModal(this.app, 'Pushing to remote');
                    await this.plugin.runGitMutation('Push to remote', async (manager) => {
                        await this.plugin.refreshGitCredentials();
                        manager.setProgressHandle(progress!);
                        try {
                            await manager.push(this.plugin.settings.branchName);
                            progress!.complete('Push complete');
                        } finally {
                            manager.setProgressHandle(undefined);
                        }
                    });
                    new Notice('Pushed to remote');
                    this.invalidateRemoteCommitsCache();
                    await this.refresh();
                } catch (e: any) {
                    progress?.fail(e);
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
            if (!this.plugin.gitManager || this.commitInFlight) return;
            this.commitInFlight = true;
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
            } finally {
                this.commitInFlight = false;
            }
        };
        commitButton.onClick(commit);
        input.inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void commit();
            }
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

    async refresh(options: { readRepository?: boolean; force?: boolean; skipIfRepositoryReadInFlight?: boolean } = {}): Promise<void> {
        const generation = ++this.renderGeneration;
        const readRepository = options.readRepository !== false;

        if (options.force && this.activeTab === 'commits' && this.commitsViewMode === 'remote') {
            this.invalidateRemoteCommitsCache();
        }

        if (readRepository) {
            // Paint the cached state before awaiting the adapter. On the first
            // ever read this is the loading state; on later view instances it
            // is the last known Changes list.
            await this.renderCurrentState(generation, false);
            await this.refreshRepositoryStatus(options.skipIfRepositoryReadInFlight === true);
            if (!this.isCurrentRender(generation)) return;
        } else {
            // Manager construction is needed by local/remote history, but it
            // must not be part of the initial Changes-pane critical path.
            if (!this.plugin.gitManager) await this.plugin.ensureGitManager();
            if (!this.isCurrentRender(generation)) return;
        }

        await this.renderCurrentState(generation, readRepository);
    }

    private async refreshRepositoryStatus(skipIfInFlight: boolean): Promise<void> {
        if (this.repositoryReadInFlight) {
            if (skipIfInFlight) return;
            // A manual refresh requested during a read waits for that read; it
            // does not start a competing statusMatrix traversal. Automatic
            // refreshes also return immediately because the result will be
            // painted by the read that is already running.
            await this.repositoryReadInFlight;
            return;
        }

        const read = this.readRepositoryStatus();
        this.repositoryReadInFlight = read;
        try {
            await read;
        } finally {
            if (this.repositoryReadInFlight === read) this.repositoryReadInFlight = null;
        }
    }

    private async readRepositoryStatus(): Promise<void> {
        const manager = await this.plugin.ensureGitManager();
        if (!manager) {
            const changed = !this.repositoryStateKnown || this.hasRealRepo || this.sidebarSnapshot !== null;
            this.repositoryStateKnown = true;
            this.hasRealRepo = false;
            this.sidebarSnapshot = null;
            this.readModel.invalidateStatus();
            if (changed) this.statusRevision += 1;
            return;
        }

        let hasReal = this.hasRealRepo;
        try {
            hasReal = await manager.hasRepository();
            this.repositoryStateKnown = true;
        } catch (error) {
            log.warn('GitSidebar', 'repository check failed', error);
            return;
        }
        this.hasRealRepo = hasReal;
        if (!hasReal) {
            const changed = this.sidebarSnapshot !== null;
            this.sidebarSnapshot = null;
            this.readModel.invalidateStatus();
            if (changed) this.statusRevision += 1;
            return;
        }

        try {
            // Keep the existing snapshot visible while the slow read runs.
            // The completed snapshot is swapped in atomically below.
            const snapshot = await manager.getSidebarStatusSnapshot();
            const changed = !this.statusSnapshotsEqual(this.sidebarSnapshot, snapshot);
            this.sidebarSnapshot = snapshot;
            this.readModel.setStatusSnapshot(snapshot);
            if (changed) this.statusRevision += 1;
        } catch (error) {
            log.warn('GitSidebar', 'Failed to read repository snapshot', error);
        }
    }

    private async renderCurrentState(generation: number, readRepository: boolean): Promise<void> {
        if (!this.isCurrentRender(generation)) return;
        if (!this.repositoryStateKnown && !this.sidebarSnapshot) {
            this.renderLoadingState();
            return;
        }

        const activeTab = this.activeTab;
        const hasReal = this.hasRealRepo || this.sidebarSnapshot !== null;
        const initialized = hasReal;

        this.hasRemote = !!this.plugin.settings.repoUrl;
        this.isLocalOnly = !this.hasRemote;
        if (this.readModel.getRemoteRepositoryUrl() && this.readModel.getRemoteRepositoryUrl() !== this.plugin.settings.repoUrl) {
            this.invalidateRemoteCommitsCache();
        }

        const snapshot = this.sidebarSnapshot;
        const branch = snapshot?.branch || (initialized ? 'local' : 'No repo');
        const ahead = snapshot?.ahead || 0;
        const behind = snapshot?.behind || 0;
        const repositoryStatusAvailable = snapshot?.repositoryStatusAvailable !== false;
        const comparison = snapshot?.comparison || (repositoryStatusAvailable ? 'up-to-date' : 'unavailable');

        const headerKey = JSON.stringify({
            tab: activeTab,
            branch,
            ahead,
            behind,
            initialized,
            hasReal,
            repositoryStatusAvailable,
            comparison,
            localOnly: this.isLocalOnly,
        });
        if (this.renderedHeaderKey !== headerKey) {
            this.renderHeader(branch, ahead, behind, initialized, hasReal, repositoryStatusAvailable, comparison);
            this.renderedHeaderKey = headerKey;
        }
        if (readRepository && initialized && this.hasRemote && this.plugin.gitManager && snapshot) {
            void this.updateRemoteComparison(generation);
        }
        this.stagedCount = snapshot?.staged.length || 0;
        // Remote history is an independent read capability. Keep it available
        // when the local repository is absent, while local Changes/Log content
        // still explains how to initialize the vault.
        const remoteHistoryOnly = activeTab === 'commits'
            && this.commitsViewMode === 'remote'
            && this.hasRemote;
        if (!initialized && !remoteHistoryOnly) {
            const pane = this.tabContainer(activeTab);
            pane.empty();
            await this.renderUninitializedContent(hasReal, pane);
            if (!this.isCurrentRender(generation)) return;
            this.renderedTabs.add(activeTab);
        } else {
            const shouldRender = !this.renderedTabs.has(activeTab)
                || (activeTab === 'status' && this.renderedStatusRevision !== this.statusRevision)
                || (activeTab === 'log' && !this.readModel.getLogEntries());
            const pane = this.tabContainer(activeTab);
            if (shouldRender) {
                pane.empty();
                switch (activeTab) {
                    case 'status':
                        this.renderStatusTab(snapshot, pane);
                        this.renderedStatusRevision = this.statusRevision;
                        break;
                    case 'commits':
                        await this.renderCommitsTab(generation, pane);
                        break;
                    case 'log':
                        await this.renderLogTabInto(generation, pane);
                        break;
                }
                if (!this.isCurrentRender(generation)) return;
                this.renderedTabs.add(activeTab);
            }
        }

        if (!this.isCurrentRender(generation)) return;
        const footerEl = this.containerEl.querySelector('.git-sidebar-footer') as HTMLElement;
        const footerKey = `${activeTab}|${this.stagedCount}|${this.hasRemote}|${!!this.plugin.gitManager}`;
        if (footerEl && this.renderedFooterKey !== footerKey) {
            this.renderFooter(footerEl);
            this.renderedFooterKey = footerKey;
        }
    }

    private statusSnapshotsEqual(
        left: GitSidebarStatusSnapshot | null,
        right: GitSidebarStatusSnapshot,
    ): boolean {
        if (!left) return false;
        if (
            left.branch !== right.branch
            || left.ahead !== right.ahead
            || left.behind !== right.behind
            || left.comparison !== right.comparison
            || left.repositoryStatusAvailable !== right.repositoryStatusAvailable
            || left.staged.length !== right.staged.length
            || left.unstaged.length !== right.unstaged.length
            || left.detailedStatus.length !== right.detailedStatus.length
        ) return false;
        return left.staged.every((path, index) => path === right.staged[index])
            && left.unstaged.every((path, index) => path === right.unstaged[index])
            && left.detailedStatus.every((file, index) => {
                const next = right.detailedStatus[index];
                return file.filepath === next.filepath && file.status === next.status;
            });
    }

    private async updateRemoteComparison(generation: number): Promise<void> {
        const manager = this.plugin.gitManager;
        if (!manager) return;
        try {
            const comparison = await manager.getStatus();
            if (!this.isCurrentRender(generation) || !this.sidebarSnapshot) return;
            this.sidebarSnapshot = {
                ...this.sidebarSnapshot,
                ...comparison,
                repositoryStatusAvailable: true,
            };
            this.renderHeader(
                this.sidebarSnapshot.branch,
                this.sidebarSnapshot.ahead,
                this.sidebarSnapshot.behind,
                true,
                true,
                true,
                this.sidebarSnapshot.comparison,
            );
        } catch (error) {
            log.debug('GitSidebar', 'Remote comparison unavailable after local refresh', error);
        }
    }

    private async renderUninitializedContent(hasReal: boolean, target = this.contentContainer): Promise<void> {
        const wrapper = target.createDiv('git-uninit-container');
        
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

    private renderStatusTab(snapshot: GitSidebarStatusSnapshot | null, target = this.contentContainer): void {
        const container = target.createDiv('git-status-container');

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
                    const result = await this.plugin.runGitMutation('Unstage all files', async (manager) => {
                        return manager.unstageAll();
                    });
                    for (const filepath of result.unstaged) {
                        this.applyFileMutationToSnapshot(filepath, 'unstaged');
                    }
                    new Notice(result.failed.length > 0
                        ? `Unstaged ${result.unstaged.length} of ${result.requested} files.`
                        : 'All files unstaged');
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
                    for (const filepath of result.staged) {
                        this.applyFileMutationToSnapshot(filepath, 'staged');
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
            bulkBtn.textContent = 'Working…';
            try {
                await onBulk();
                this.repaintStatusSnapshot();
            } catch (err: any) {
                new Notice(`${bulkLabel} failed: ${err.message}`);
            } finally {
                this.setMutationBusy(false);
                if (bulkBtn.isConnected) {
                    bulkBtn.empty();
                    setIcon(bulkBtn, sectionClass === 'staged' ? 'minus' : 'plus');
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
                    try {
                        await onAction(filepath);
                        this.applyFileMutationToSnapshot(
                            filepath,
                            sectionClass === 'staged' ? 'unstaged' : 'staged',
                        );
                        // The Git operation has completed. Repaint the current
                        // Changes view directly instead of starting a second
                        // repository-wide read just to reflect this result.
                        this.repaintStatusSnapshot();
                    } catch (err: any) {
                        new Notice(`${sectionClass === 'staged' ? 'Unstage' : 'Stage'} failed: ${err.message}`);
                    } finally {
                        this.setMutationBusy(false);
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
            if (busy) control.addClass('git-operation-busy');
            else control.removeClass('git-operation-busy');
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
            if (this.ignorePatternInFlight) return;
            try {
                const pattern = input.getValue().trim();
                if (!pattern) {
                    new Notice('Enter a Git ignore pattern');
                    return;
                }
                this.ignorePatternInFlight = true;
                addButton.setDisabled(true).setButtonText('Adding…');
                const added = await this.plugin.addGitIgnorePattern(pattern);
                modal.close();
                new Notice(added
                    ? `Added ${pattern} to .gitignore`
                    : `${pattern} is already in .gitignore`);
                await this.refresh();
            } catch (e: any) {
                new Notice(`Could not update .gitignore: ${e.message}`);
            } finally {
                this.ignorePatternInFlight = false;
                if (addButton.buttonEl.isConnected) {
                    addButton.setDisabled(false).setButtonText('Add pattern');
                }
            }
        };

        addButton.onClick(submit);
        input.inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
            }
        });
        modal.open();
        window.setTimeout(() => input.inputEl.focus(), 0);
    }

    private async renderCommitsTab(generation: number, target = this.contentContainer): Promise<void> {
        const listContainer = target.createDiv('git-log-list');

        // Toggle bar: Local / Remote
        const toggleBar = listContainer.createDiv('git-commits-toggle-bar');
        const localBtn = toggleBar.createEl('button', {
            text: 'Local',
            cls: 'git-commits-toggle-btn' + (this.commitsViewMode === 'local' ? ' git-commits-toggle-active' : ''),
            attr: { role: 'tab', 'aria-selected': String(this.commitsViewMode === 'local') }
        });
        localBtn.addEventListener('click', () => {
            this.commitsViewMode = 'local';
            this.invalidateTab('commits');
            void this.refresh({ readRepository: false }).catch((error) => {
                log.debug('GitSidebar', 'Local commit view refresh failed', error);
            });
        });
        const remoteBtn = toggleBar.createEl('button', {
            text: 'Remote',
            cls: 'git-commits-toggle-btn' + (this.commitsViewMode === 'remote' ? ' git-commits-toggle-active' : ''),
            attr: { role: 'tab', 'aria-selected': String(this.commitsViewMode === 'remote') }
        });
        remoteBtn.addEventListener('click', () => {
            this.commitsViewMode = 'remote';
            this.invalidateTab('commits');
            void this.refresh({ readRepository: false }).catch((error) => {
                log.debug('GitSidebar', 'Remote commit view refresh failed', error);
            });
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
                const cached = this.readModel.getLocalCommits(branch);
                if (cached) {
                    commits = cached;
                } else {
                    commits = await this.plugin.gitManager.getLog(25);
                    this.readModel.setLocalCommits(branch, commits);
                }
            } else {
                // Remote history is independent of local repository health.
                // Use the configured branch and query GitHub first so stale or
                // damaged origin refs cannot hide the actual remote history.
                const remoteUrl = this.plugin.settings.repoUrl;
                const cached = this.readModel.getRemoteCommits(remoteUrl, branch);
                if (cached !== null) {
                    commits = cached;
                } else {
                    const isGitHub = parseGitHubRepositoryUrl(remoteUrl) !== null;
                    if (!this.plugin.gitManager) {
                        log.error(
                            'GitSidebar',
                            `Remote commit fetch skipped (source=${isGitHub ? 'github-api' : 'local-remote-ref'}, branch=${branch}): Git backend unavailable`,
                            new Error('Git backend unavailable'),
                        );
                    } else {
                        // The manager is created without secrets so normal local
                        // reads stay cheap. Resolve the credential immediately
                        // before this authenticated remote read.
                        await this.plugin.refreshGitCredentials();
                        log.info('GitSidebar', 'Fetching remote commit history', {
                            branch,
                            source: isGitHub ? 'github-api' : 'local-remote-ref',
                        });
                        commits = await this.plugin.gitManager.fetchRemoteCommits(remoteUrl, branch, 25);
                        log.info('GitSidebar', 'Remote commit history fetched', {
                            branch,
                            source: isGitHub ? 'github-api' : 'local-remote-ref',
                            count: commits.length,
                        });
                        if (commits.length === 0 && !isGitHub) {
                            // Non-GitHub remotes still use their fetched origin ref.
                            log.warn('GitSidebar', 'Remote API returned no commits; using local remote-tracking ref', { branch });
                            commits = await this.plugin.gitManager.getRemoteLog(branch, 25);
                        } else if (commits.length === 0) {
                            log.warn('GitSidebar', 'GitHub returned no remote commits', { branch });
                        }
                    }
                }
                this.readModel.setRemoteCommits(remoteUrl, branch, commits);
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
                        await this.renderCommitDetail(row, commit.oid, generation);
                    }
                });

                // If already expanded, render detail
                if (isExpanded) {
                    await this.renderCommitDetail(row, commit.oid, generation);
                }
            }
        } catch (e: any) {
            loading?.remove();
            const error = e instanceof Error ? e : new Error(String(e));
            log.error(
                'GitSidebar',
                `Failed to get commit log (mode=${this.commitsViewMode}, branch=${this.plugin.settings.branchName || 'main'})`,
                error,
            );
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

    private async renderCommitDetail(row: HTMLElement, oid: string, generation: number): Promise<void> {
        // Remove existing detail if any
        const existing = row.querySelector('.git-commit-detail');
        if (existing) existing.remove();

        const detail = row.createDiv('git-commit-detail');
        detail.createDiv('git-commit-detail-loading').setText('Loading...');

        try {
            let files: { filepath: string; status: 'added' | 'modified' | 'deleted' }[] = [];
            const cachedFiles = this.readModel.getCommitDetails(oid);
            if (cachedFiles) files = cachedFiles;
            
            // Use the API directly when remote history is being viewed without
            // a healthy local repository. Otherwise prefer the local object
            // database and retain the shallow-history fallback.
            if (cachedFiles) {
                // Details are immutable for a commit; avoid repeating local or
                // GitHub reads when a row is collapsed and expanded again.
            } else if (this.commitsViewMode === 'remote' && this.plugin.settings.repoUrl && !this.hasRealRepo) {
                detail.querySelector('.git-commit-detail-loading')?.setText('Fetching from GitHub...');
                const remoteFiles = this.plugin.gitManager
                    ? await this.plugin.gitManager.fetchRemoteCommitFiles(this.plugin.settings.repoUrl, oid)
                    : [];
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
                const remoteFiles = this.plugin.gitManager
                    ? await this.plugin.gitManager.fetchRemoteCommitFiles(this.plugin.settings.repoUrl, oid)
                    : [];
                if (remoteFiles) {
                    files = remoteFiles;
                }
            }

            if (!this.isCurrentRender(generation) || !row.isConnected) return;

            this.readModel.setCommitDetails(oid, files);
            
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

    private async renderLogTab(generation: number): Promise<void> {
        await this.renderLogTabInto(generation, this.contentContainer);
    }

    private async renderLogTabInto(generation: number, target: HTMLElement): Promise<void> {
        const listContainer = target.createDiv('git-log-list');

        const toolbar = listContainer.createDiv('git-log-toolbar');
        toolbar.createEl('h2', { text: 'Activity', cls: 'git-log-toolbar-title' });
        
        const currentLogEntries = log.getEntries();
        const cachedEntries = this.readModel.getLogEntries();
        const cacheStale = cachedEntries
            && currentLogEntries.length !== cachedEntries.length;
        if (!cachedEntries || cacheStale) {
            const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
            if (!this.isCurrentRender(generation)) return;
            log.mergePersistedEntries(persisted);
            this.readModel.setLogEntries(log.getEntries());
        }
        const entries = this.readModel.getLogEntries() || [];
        
        if (entries.length === 0) {
            listContainer.createEl('p', { text: 'No activity yet', cls: 'git-empty-state' });
            return;
        }

        // FileLogger and Logger both apply the configured retention limit.
        // Do not impose a smaller view-only limit here: that made a busy
        // session hide every persisted entry from earlier sessions.
        const recent = [...entries].reverse();
        
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
                    if (!this.readModel.getLogEntries()) {
                        const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
                        log.mergePersistedEntries(persisted);
                        this.readModel.setLogEntries(log.getEntries());
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
                try {
                    log.clear();
                    await this.plugin.fileLogger?.clear();
                    this.readModel.setLogEntries([]);
                    new Notice('Activity log cleared');
                    this.invalidateTab('log');
                    await this.refresh({ readRepository: false });
                } catch (e: any) {
                    new Notice('Could not clear log: ' + e.message);
                }
            }));
        menu.addItem((item) => item
            .setTitle('Copy details')
            .setIcon('copy')
            .onClick(async () => {
                try {
                    if (!this.readModel.getLogEntries()) {
                        const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
                        log.mergePersistedEntries(persisted);
                        this.readModel.setLogEntries(log.getEntries());
                    }
                    const entries = [...(this.readModel.getLogEntries() || [])].reverse();
                    const details = entries.length === 0
                        ? 'No activity yet'
                        : entries.map((entry) => {
                            const time = new Date(entry.timestamp).toISOString();
                            const data = entry.data ? `\n${typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data)}` : '';
                            return `${time} ${entry.level.toUpperCase()} [${entry.namespace}] ${entry.message}${data}`;
                        }).join('\n');
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
