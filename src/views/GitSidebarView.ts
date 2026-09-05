import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, Modal, TextComponent, Menu, setIcon } from 'obsidian';
import GitSyncPlugin from '../main';
import { GitFileStatus, GitCommit, GitSidebarStatusSnapshot, GitComparisonState } from '../backend/obsidianAdapter';
import { parseGitHubRepositoryUrl } from '../backend/githubApi';
import { log } from '../logger';
import { SidebarReadModel } from '../sidebarReadModel';
import { createProgressModal } from '../ui/GitProgressModal';

export const VIEW_TYPE_GIT_SIDEBAR = 'git-sidebar-view';

type SidebarTab = 'status' | 'commits' | 'log';
type ChangeFilterStatus = Extract<GitFileStatus['status'], 'untracked' | 'added' | 'modified' | 'deleted'>;
type UncommittedSort = 'path-asc' | 'path-desc' | 'status' | 'folder';

const changeFilterStatuses: Array<{ status: ChangeFilterStatus; marker: string; label: string }> = [
    { status: 'untracked', marker: '?', label: 'Untracked' },
    { status: 'added', marker: 'A', label: 'Added' },
    { status: 'modified', marker: 'M', label: 'Modified' },
    { status: 'deleted', marker: 'D', label: 'Deleted' },
];

const uncommittedSortOptions: Array<{ value: UncommittedSort; label: string }> = [
    { value: 'path-asc', label: 'Path (A–Z)' },
    { value: 'path-desc', label: 'Path (Z–A)' },
    { value: 'status', label: 'Status, then path' },
    { value: 'folder', label: 'Folder, then name' },
];

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
    private vaultRefreshTimer: number | null = null;
    private readonly collapsedStatusSections = new Map<'staged' | 'unstaged', boolean>();
    private readonly changeRows = new Map<string, HTMLElement>();
    private readonly changeLists = new Map<'staged' | 'unstaged', HTMLElement>();
    private readonly activityRows = new Map<string, HTMLElement>();
    private mutationInFlight = false;
    private repositoryStateKnown = false;
    private repositoryReadInFlight: Promise<void> | null = null;
    private statusRevision = 0;
    private renderedStatusRevision = -1;
    private renderedHeaderKey: string | null = null;
    private renderedFooterKey: string | null = null;
    private readonly uncommittedFilters = new Set<ChangeFilterStatus>(changeFilterStatuses.map(({ status }) => status));
    private uncommittedSort: UncommittedSort = 'path-asc';
    private readonly selectedFilePaths = new Set<string>();
    private readonly selectionAnchorBySection = new Map<'staged' | 'unstaged', string>();
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
            this.readModel.setLogEntries(log.getEntries());
            if (this.activeTab !== 'log' || this.logRenderScheduled) return;
            this.logRenderScheduled = true;
            window.setTimeout(() => {
                this.logRenderScheduled = false;
                if (this.activeTab === 'log' && this.containerEl.isConnected) {
                    this.applyLiveActivityEntries();
                }
            }, 0);
        });
        // Reconcile every vault change once Obsidian's watcher notices it.
        // A Changes view that only reacts to deletes can retain an empty
        // snapshot while newly created or modified untracked files accumulate.
        const refreshAfterVaultChange = () => this.scheduleVaultRefresh();
        this.registerEvent(this.app.vault.on('create', refreshAfterVaultChange));
        this.registerEvent(this.app.vault.on('modify', refreshAfterVaultChange));
        this.registerEvent(this.app.vault.on('delete', refreshAfterVaultChange));
        this.registerEvent(this.app.vault.on('rename', refreshAfterVaultChange));

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
        if (this.vaultRefreshTimer !== null) {
            window.clearTimeout(this.vaultRefreshTimer);
            this.vaultRefreshTimer = null;
        }
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
        if (tab === 'status') {
            this.changeRows.clear();
            this.changeLists.clear();
        } else if (tab === 'log') {
            this.activityRows.clear();
        }
    }

    /** Coalesce watcher bursts into one status read after Obsidian settles. */
    private scheduleVaultRefresh(): void {
        if (!this.containerEl.isConnected || this.vaultRefreshTimer !== null) return;
        this.vaultRefreshTimer = window.setTimeout(() => {
            this.vaultRefreshTimer = null;
            void this.refresh({ skipIfRepositoryReadInFlight: true }).catch((error) => {
                log.debug('GitSidebar', 'Vault-change refresh failed', error);
            });
        }, 100);
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
    private applyFileMutationToSnapshot(filepath: string, destination: 'staged' | 'unstaged' | 'removed'): void {
        if (!this.sidebarSnapshot) return;

        const staged = this.sidebarSnapshot.staged.filter((path) => path !== filepath);
        const unstaged = this.sidebarSnapshot.unstaged.filter((path) => path !== filepath);
        if (destination === 'staged') staged.push(filepath);
        else if (destination === 'unstaged') unstaged.push(filepath);

        this.sidebarSnapshot = {
            ...this.sidebarSnapshot,
            staged,
            unstaged,
        };
        this.patchChangedFileRow(filepath, destination);
    }

    /**
     * Apply the state that can change without replacing the Changes list.
     * Filters and sort order intentionally request a rebuild because they alter
     * the list's ordering; ordinary selection and file mutations do not.
     */
    private repaintStatusSnapshot(rebuild = false): void {
        if (this.activeTab !== 'status') return;
        if (!rebuild && this.patchStatusControls()) return;
        const pane = this.tabContainer('status');
        pane.empty();
        this.changeRows.clear();
        this.changeLists.clear();
        this.renderStatusTab(this.sidebarSnapshot, pane);
        this.renderedTabs.add('status');
        this.renderedStatusRevision = this.statusRevision;
        this.renderedFooterKey = null;
        const footerEl = this.containerEl.querySelector('.git-sidebar-footer') as HTMLElement;
        if (footerEl) this.renderFooter(footerEl);
    }

    private patchChangedFileRow(filepath: string, destination: 'staged' | 'unstaged' | 'removed'): void {
        if (this.activeTab !== 'status') return;
        const row = this.changeRows.get(filepath);
        if (!row) return;
        if (destination === 'removed') {
            row.remove();
            this.changeRows.delete(filepath);
            return;
        }
        const section = destination;
        const list = this.changeLists.get(section);
        if (!list) return;
        row.setAttr('data-section', section);
        const button = row.querySelector('.git-file-stage-toggle') as HTMLButtonElement | null;
        if (button) {
            button.empty();
            setIcon(button, section === 'staged' ? 'square-check' : 'square');
            button.removeClass(section === 'staged' ? 'git-file-stage-empty' : 'git-file-stage-checked');
            button.addClass(section === 'staged' ? 'git-file-stage-checked' : 'git-file-stage-empty');
            button.setAttr('title', section === 'staged' ? 'Unstage file' : 'Stage file');
            button.setAttr('aria-label', `${section === 'staged' ? 'Unstage' : 'Stage'} ${filepath}`);
        }
        list.appendChild(row);
    }

    private patchStatusControls(): boolean {
        const snapshot = this.sidebarSnapshot;
        if (!snapshot || this.changeLists.size === 0) return false;
        const statusByPath = new Map(snapshot.detailedStatus.map((file) => [file.filepath, file.status] as const));
        const filesBySection: Record<'staged' | 'unstaged', string[]> = {
            staged: [...snapshot.staged],
            unstaged: this.filteredAndSortedUnstagedFiles(snapshot.unstaged, statusByPath),
        };
        for (const section of ['staged', 'unstaged'] as const) {
            const sectionEl = this.contentContainer.querySelector(`.git-status-section-${section}`) as HTMLElement | null;
            const list = this.changeLists.get(section);
            if (!sectionEl || !list) return false;
            const files = filesBySection[section];
            const count = sectionEl.querySelector('.git-status-section-count');
            if (count) count.setText(section === 'unstaged' && files.length !== snapshot.unstaged.length
                ? `${files.length}/${snapshot.unstaged.length}`
                : String(files.length));
            const bulk = sectionEl.querySelector('.git-status-section-action') as HTMLButtonElement | null;
            const bulkLabel = section === 'staged'
                ? 'Unstage all'
                : files.length === snapshot.unstaged.length ? 'Stage all' : 'Stage visible';
            if (bulk) {
                bulk.disabled = files.length === 0;
                bulk.setAttr('title', bulkLabel);
                bulk.setAttr('aria-label', bulkLabel);
            }
            const empty = list.querySelector('.git-empty-state');
            if (files.length === 0 && !empty) {
                list.createEl('p', {
                    text: section === 'staged'
                        ? 'No staged files'
                        : snapshot.unstaged.length > 0 ? 'No files match the selected filters' : 'No uncommitted changes',
                    cls: 'git-empty-state',
                });
            } else if (files.length > 0) {
                empty?.remove();
            }
            this.patchSelectionToolbar(section, files, statusByPath);
        }
        this.stagedCount = snapshot.staged.length;
        this.renderedFooterKey = null;
        const footerEl = this.containerEl.querySelector('.git-sidebar-footer') as HTMLElement;
        if (footerEl) this.renderFooter(footerEl);
        return true;
    }

    private patchSelectionToolbar(
        section: 'staged' | 'unstaged',
        files: string[],
        statusByPath: ReadonlyMap<string, GitFileStatus['status']>,
    ): void {
        const list = this.changeLists.get(section);
        if (!list) return;
        const selected = files.filter((filepath) => this.selectedFilePaths.has(filepath));
        const toolbar = list.querySelector('.git-selection-toolbar') as HTMLElement | null;
        if (!toolbar) return;
        toolbar.toggleAttribute('hidden', files.length === 0);
        const count = toolbar.querySelector('.git-selection-count');
        if (count) count.setText(selected.length > 0 ? `${selected.length} selected` : 'Select files');
        const selectAll = toolbar.querySelector('[data-selection-action="all"]') as HTMLButtonElement | null;
        if (selectAll) selectAll.setText(selected.length === files.length && files.length > 0 ? 'Clear selection' : 'Select all');
        const stage = toolbar.querySelector('[data-selection-action="stage"]') as HTMLButtonElement | null;
        if (stage) stage.toggleAttribute('hidden', selected.length === 0);
        const revert = toolbar.querySelector('[data-selection-action="revert"]') as HTMLButtonElement | null;
        if (revert) revert.toggleAttribute('hidden', !selected.some((filepath) => statusByPath.get(filepath) !== 'untracked'));
        const remove = toolbar.querySelector('[data-selection-action="remove"]') as HTMLButtonElement | null;
        if (remove) remove.toggleAttribute('hidden', !selected.some((filepath) => statusByPath.get(filepath) === 'untracked'));
        for (const filepath of files) {
            const row = this.changeRows.get(filepath);
            if (!row) continue;
            const selectedRow = this.selectedFilePaths.has(filepath);
            row.setAttr('aria-selected', String(selectedRow));
            row.toggleClass('git-file-row-selected', selectedRow);
        }
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
            if (changed) {
                log.info('GitStatus', 'Sidebar status snapshot applied', {
                    activeTab: this.activeTab,
                    repositoryStatusAvailable: snapshot.repositoryStatusAvailable !== false,
                    detailedFiles: snapshot.detailedStatus.length,
                    stagedFiles: snapshot.staged.length,
                    unstagedFiles: snapshot.unstaged.length,
                    untrackedFiles: snapshot.detailedStatus.filter((file) => file.status === 'untracked').length,
                });
            }
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
        this.changeRows.clear();
        this.changeLists.clear();
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
            const visiblePaths = new Set([...staged, ...unstaged]);
            for (const filepath of this.selectedFilePaths) {
                if (!visiblePaths.has(filepath)) this.selectedFilePaths.delete(filepath);
            }
            for (const [sectionClass, filepath] of this.selectionAnchorBySection) {
                if (!visiblePaths.has(filepath)) this.selectionAnchorBySection.delete(sectionClass);
            }
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
                },
                async (paths) => {
                    const result = await this.plugin.runGitMutation('Unstage selected files', async (manager) => {
                        const unstaged: string[] = [];
                        const failed: Array<{ filepath: string; message: string }> = [];
                        for (const filepath of paths) {
                            try {
                                await manager.unstageFile(filepath);
                                unstaged.push(filepath);
                            } catch (error: any) {
                                failed.push({ filepath, message: error?.message || String(error) });
                            }
                        }
                        return { requested: paths.length, unstaged, failed };
                    });
                    for (const filepath of result.unstaged) {
                        this.selectedFilePaths.delete(filepath);
                        this.applyFileMutationToSnapshot(filepath, 'unstaged');
                    }
                    new Notice(result.failed.length > 0
                        ? `Unstaged ${result.unstaged.length} of ${result.requested} selected files.`
                        : `Unstaged ${result.unstaged.length} selected file${result.unstaged.length === 1 ? '' : 's'}.`);
                }
            );

            // ── Uncommitted section ── (always show, default collapsed if empty)
            const visibleUnstaged = this.filteredAndSortedUnstagedFiles(unstaged, statusByPath);
            const bulkLabel = visibleUnstaged.length === unstaged.length ? 'Stage all' : 'Stage visible';
            this.renderCollapsibleSection(container, 'Uncommitted Changes', visibleUnstaged, 'unstaged', bulkLabel, statusByPath,
                async (fp) => {
                    await this.plugin.runGitMutation('Stage file', async (manager) => {
                        await manager.stageFile(fp);
                    });
                    new Notice(`Staged ${fp}`);
                },
                async () => {
                    const result = await this.plugin.runGitMutation('Stage all files', async (manager) => {
                        return manager.addAll(this.filesInStatusSection('unstaged'));
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
                },
                async (paths) => {
                    const result = await this.plugin.runGitMutation('Stage selected files', async (manager) => manager.addAll(paths));
                    for (const filepath of result.staged) {
                        this.selectedFilePaths.delete(filepath);
                        this.applyFileMutationToSnapshot(filepath, 'staged');
                    }
                    new Notice(result.failed.length > 0
                        ? `Staged ${result.staged.length} of ${result.requested} selected files.`
                        : `Staged ${result.staged.length} selected file${result.staged.length === 1 ? '' : 's'}.`);
                }
            , { totalFiles: unstaged.length, showChangeControls: true });

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

    private filteredAndSortedUnstagedFiles(
        files: readonly string[],
        statusByPath: ReadonlyMap<string, GitFileStatus['status']>,
    ): string[] {
        const statusFor = (path: string): ChangeFilterStatus => {
            const status = statusByPath.get(path);
            return status === 'untracked' || status === 'added' || status === 'deleted'
                ? status
                : 'modified';
        };
        const splitPath = (path: string): [string, string] => {
            const slash = path.lastIndexOf('/');
            return slash === -1 ? ['', path] : [path.slice(0, slash), path.slice(slash + 1)];
        };
        const statusOrder: Record<ChangeFilterStatus, number> = {
            untracked: 0,
            added: 1,
            modified: 2,
            deleted: 3,
        };

        return files
            .filter((path) => this.uncommittedFilters.has(statusFor(path)))
            .sort((left, right) => {
                if (this.uncommittedSort === 'path-desc') return right.localeCompare(left);
                if (this.uncommittedSort === 'status') {
                    const difference = statusOrder[statusFor(left)] - statusOrder[statusFor(right)];
                    return difference || left.localeCompare(right);
                }
                if (this.uncommittedSort === 'folder') {
                    const [leftFolder, leftName] = splitPath(left);
                    const [rightFolder, rightName] = splitPath(right);
                    return leftFolder.localeCompare(rightFolder) || leftName.localeCompare(rightName);
                }
                return left.localeCompare(right);
            });
    }

    private filesInStatusSection(section: 'staged' | 'unstaged'): string[] {
        if (!this.sidebarSnapshot) return [];
        if (section === 'staged') return [...this.sidebarSnapshot.staged];
        return this.filteredAndSortedUnstagedFiles(this.sidebarSnapshot.unstaged, this.statusByPath());
    }

    private statusByPath(): Map<string, GitFileStatus['status']> {
        return new Map(this.sidebarSnapshot?.detailedStatus.map((file) => [file.filepath, file.status] as const) || []);
    }

    private statusForPath(filepath: string): GitFileStatus['status'] | undefined {
        return this.statusByPath().get(filepath);
    }

    private renderCollapsibleSection(
        container: HTMLElement,
        title: string,
        files: string[],
        sectionClass: 'staged' | 'unstaged',
        bulkLabel: string,
        statusByPath: Map<string, GitFileStatus['status']>,
        onAction: (filepath: string) => Promise<void>,
        onBulk: () => Promise<void>,
        onSelected: (filepaths: string[]) => Promise<void>,
        options: { totalFiles?: number; showChangeControls?: boolean } = {},
    ): void {
        const totalFiles = options.totalFiles ?? files.length;
        const section = container.createDiv(`git-status-section git-status-section-${sectionClass}`);
        section.setAttr('data-section', sectionClass);
        
        // The initial default is collapsed when empty. After that, collapse is
        // view state, not a side effect of replacing a list or moving a row.
        const isCollapsed = this.collapsedStatusSections.get(sectionClass) ?? files.length === 0;
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
            text: files.length === totalFiles ? String(totalFiles) : `${files.length}/${totalFiles}`,
            cls: 'git-status-section-count' 
        });

        const headerControls: HTMLButtonElement[] = [];
        if (options.showChangeControls) {
            const filterBtn = header.createEl('button', {
                cls: 'git-status-section-control',
                attr: { type: 'button', 'aria-label': 'Filter uncommitted changes' },
            }) as HTMLButtonElement;
            setIcon(filterBtn, 'filter');
            filterBtn.setAttr('title', `Filter statuses (${this.uncommittedFilters.size} of ${changeFilterStatuses.length} shown)`);
            filterBtn.classList.toggle('is-active', this.uncommittedFilters.size !== changeFilterStatuses.length);
            filterBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const menu = new Menu();
                menu.addItem((item) => item
                    .setTitle('All status types')
                    .setChecked(this.uncommittedFilters.size === changeFilterStatuses.length)
                    .onClick(() => {
                        this.uncommittedFilters.clear();
                        for (const { status } of changeFilterStatuses) this.uncommittedFilters.add(status);
                        this.repaintStatusSnapshot(true);
                    }));
                menu.addSeparator();
                for (const { status, marker, label } of changeFilterStatuses) {
                    menu.addItem((item) => item
                        .setTitle(`${marker} ${label}`)
                        .setChecked(this.uncommittedFilters.has(status))
                        .onClick(() => {
                            if (this.uncommittedFilters.has(status)) this.uncommittedFilters.delete(status);
                            else this.uncommittedFilters.add(status);
                            this.repaintStatusSnapshot(true);
                        }));
                }
                menu.showAtMouseEvent(event);
            });
            headerControls.push(filterBtn);

            const sortBtn = header.createEl('button', {
                cls: 'git-status-section-control',
                attr: { type: 'button', 'aria-label': 'Sort uncommitted changes' },
            }) as HTMLButtonElement;
            setIcon(sortBtn, 'arrow-down-up');
            sortBtn.setAttr('title', `Sort: ${uncommittedSortOptions.find((option) => option.value === this.uncommittedSort)?.label}`);
            sortBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const menu = new Menu();
                for (const option of uncommittedSortOptions) {
                    menu.addItem((item) => item
                        .setTitle(option.label)
                        .setChecked(option.value === this.uncommittedSort)
                        .onClick(() => {
                            this.uncommittedSort = option.value;
                            this.repaintStatusSnapshot(true);
                        }));
                }
                menu.showAtMouseEvent(event);
            });
            headerControls.push(sortBtn);
        }
        
        // Bulk action button (always visible)
        const bulkBtn = header.createEl('button', { cls: 'git-status-section-action' }) as HTMLButtonElement;
        setIcon(bulkBtn, sectionClass === 'staged' ? 'minus' : 'plus');
        bulkBtn.disabled = files.length === 0;
        bulkBtn.setAttr('title', bulkLabel);
        bulkBtn.setAttr('aria-label', bulkLabel);
        headerControls.push(bulkBtn);
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
            if (headerControls.some((control) => e.target === control || control.contains(e.target as Node))) return;
            const currentlyCollapsed = section.getAttr('data-collapsed') === 'true';
            section.setAttr('data-collapsed', String(!currentlyCollapsed));
            this.collapsedStatusSections.set(sectionClass, !currentlyCollapsed);
            toggle.setText(!currentlyCollapsed ? '▸' : '▾');
            toggle.setAttr('aria-expanded', String(currentlyCollapsed));
        });

        const list = section.createDiv('git-status-section-list');
        this.changeLists.set(sectionClass, list);

        const selected = files.filter((filepath) => this.selectedFilePaths.has(filepath));
        const selectionToolbar = list.createDiv('git-selection-toolbar');
        selectionToolbar.toggleAttribute('hidden', files.length === 0);
            selectionToolbar.createSpan({
                text: selected.length > 0 ? `${selected.length} selected` : 'Select files',
                cls: 'git-selection-count',
            });
            const selectAll = selectionToolbar.createEl('button', {
                text: selected.length === files.length ? 'Clear selection' : 'Select all',
                cls: 'git-selection-btn',
                attr: { type: 'button', 'data-selection-action': 'all' },
            });
            selectAll.addEventListener('click', (event) => {
                event.stopPropagation();
                if (selected.length === files.length) {
                    for (const filepath of files) this.selectedFilePaths.delete(filepath);
                } else {
                    for (const filepath of files) this.selectedFilePaths.add(filepath);
                }
                this.repaintStatusSnapshot();
            });
        const selectedAction = selectionToolbar.createEl('button', {
            text: sectionClass === 'staged' ? 'Unstage selected' : 'Stage selected',
            cls: 'git-selection-btn git-selection-primary',
            attr: { type: 'button', 'data-selection-action': 'stage' },
        });
        selectedAction.toggleAttribute('hidden', selected.length === 0);
        selectedAction.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (this.mutationInFlight) return;
            const currentFiles = this.filesInStatusSection(sectionClass);
            const currentSelection = currentFiles.filter((filepath) => this.selectedFilePaths.has(filepath));
            if (currentSelection.length === 0) return;
            this.setMutationBusy(true);
            try {
                await onSelected(currentSelection);
                this.repaintStatusSnapshot();
            } catch (error: any) {
                new Notice(`${sectionClass === 'staged' ? 'Unstage' : 'Stage'} selected failed: ${error?.message || String(error)}`);
            } finally {
                this.setMutationBusy(false);
            }
        });
        if (sectionClass === 'unstaged') {
            const revertAction = selectionToolbar.createEl('button', {
                text: 'Revert selected', cls: 'git-selection-btn git-selection-warning',
                attr: { type: 'button', 'data-selection-action': 'revert' },
            });
            revertAction.toggleAttribute('hidden', !selected.some((filepath) => statusByPath.get(filepath) !== 'untracked'));
            revertAction.addEventListener('click', (event) => {
                event.stopPropagation();
                const current = this.filesInStatusSection('unstaged').filter((filepath) => this.selectedFilePaths.has(filepath) && this.statusForPath(filepath) !== 'untracked');
                if (current.length > 0) this.confirmDiscardSelected(current, this.statusByPath());
            });
            const deleteAction = selectionToolbar.createEl('button', {
                text: 'Delete selected', cls: 'git-selection-btn git-selection-warning',
                attr: { type: 'button', 'data-selection-action': 'remove' },
            });
            deleteAction.toggleAttribute('hidden', !selected.some((filepath) => statusByPath.get(filepath) === 'untracked'));
            deleteAction.addEventListener('click', (event) => {
                event.stopPropagation();
                const current = this.filesInStatusSection('unstaged').filter((filepath) => this.selectedFilePaths.has(filepath) && this.statusForPath(filepath) === 'untracked');
                if (current.length > 0) this.confirmDiscardSelected(current, this.statusByPath());
            });
        }
        
        if (files.length === 0) {
            const emptyMsg = sectionClass === 'staged' 
                ? 'No staged files' 
                : totalFiles > 0 ? 'No files match the selected filters' : 'No uncommitted changes';
            list.createEl('p', { text: emptyMsg, cls: 'git-empty-state' });
        } else {
            for (const filepath of files) {
                const row = list.createDiv('git-file-row');
                row.setAttr('data-filepath', filepath);
                row.setAttr('data-section', sectionClass);
                this.changeRows.set(filepath, row);

                row.setAttr('role', 'option');
                row.setAttr('aria-selected', String(this.selectedFilePaths.has(filepath)));
                if (this.selectedFilePaths.has(filepath)) row.addClass('git-file-row-selected');
                row.addEventListener('click', (event) => {
                    const mouseEvent = event as MouseEvent;
                    if (this.mutationInFlight) return;
                    const anchor = this.selectionAnchorBySection.get(sectionClass);
                    const currentIndex = files.indexOf(filepath);
                    if (mouseEvent.shiftKey && anchor && files.includes(anchor)) {
                        const anchorIndex = files.indexOf(anchor);
                        const start = Math.min(anchorIndex, currentIndex);
                        const end = Math.max(anchorIndex, currentIndex);
                        for (const selectedPath of files.slice(start, end + 1)) {
                            this.selectedFilePaths.add(selectedPath);
                        }
                    } else if (mouseEvent.metaKey || mouseEvent.ctrlKey) {
                        if (this.selectedFilePaths.has(filepath)) this.selectedFilePaths.delete(filepath);
                        else this.selectedFilePaths.add(filepath);
                        this.selectionAnchorBySection.set(sectionClass, filepath);
                    } else {
                        for (const selectedPath of files) this.selectedFilePaths.delete(selectedPath);
                        this.selectedFilePaths.add(filepath);
                        this.selectionAnchorBySection.set(sectionClass, filepath);
                    }
                    this.repaintStatusSnapshot();
                });

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
                    : status === 'untracked'
                        ? '?'
                        : status === 'added'
                        ? 'A'
                        : 'M';
                const statusClass = status === 'deleted'
                    ? 'git-status-deleted'
                    : status === 'untracked'
                        ? 'git-status-untracked'
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
                    if (sectionClass === 'unstaged' && this.plugin.settings.reviewActionsEnabled) {
                        menu.addItem((item) => item
                            .setTitle('Review changes')
                            .setIcon('columns-2')
                            .onClick(() => this.openReviewModal(filepath)));
                    }
                    if (sectionClass === 'unstaged') {
                        menu.addSeparator();
                        menu.addItem((item) => item
                            .setTitle(status === 'untracked' ? 'Discard untracked file…' : 'Discard changes…')
                            .setIcon('undo-2')
                            .setWarning(true)
                            .onClick(() => this.confirmDiscard(filepath, status || 'modified')));
                    }
                    menu.showAtMouseEvent(e);
                });

                stageBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (this.mutationInFlight) return;
                    this.setMutationBusy(true);
                    try {
                        const currentSection = row.getAttr('data-section') as 'staged' | 'unstaged';
                        await this.plugin.runGitMutation(currentSection === 'staged' ? 'Unstage file' : 'Stage file', async (manager) => {
                            if (currentSection === 'staged') await manager.unstageFile(filepath);
                            else await manager.stageFile(filepath);
                        });
                        new Notice(`${currentSection === 'staged' ? 'Unstaged' : 'Staged'} ${filepath}`);
                        this.applyFileMutationToSnapshot(
                            filepath,
                            currentSection === 'staged' ? 'unstaged' : 'staged',
                        );
                        this.repaintStatusSnapshot();
                    } catch (err: any) {
                        const currentSection = row.getAttr('data-section') as 'staged' | 'unstaged';
                        new Notice(`${currentSection === 'staged' ? 'Unstage' : 'Stage'} failed: ${err.message}`);
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
            '.git-file-stage-toggle, .git-status-section-action, .git-selection-btn',
        ) || [];
        controls.forEach((control) => {
            control.disabled = busy;
            control.setAttr('aria-busy', String(busy));
            if (busy) control.addClass('git-operation-busy');
            else control.removeClass('git-operation-busy');
        });
    }

    private confirmDiscard(filepath: string, status: GitFileStatus['status']): void {
        const untracked = status === 'untracked';
        const modal = new Modal(this.app);
        modal.titleEl.setText(untracked ? 'Discard untracked file?' : 'Discard changes?');
        modal.contentEl.createEl('p', {
            text: untracked
                ? `“${filepath}” is not in Git. It will be moved to Obsidian’s trash.`
                : `Restore “${filepath}” to its committed HEAD version. Its current changes will be lost.`,
        });
        const actions = modal.contentEl.createDiv('git-confirm-actions');
        new ButtonComponent(actions).setButtonText('Cancel').onClick(() => modal.close());
        new ButtonComponent(actions).setButtonText(untracked ? 'Move to trash' : 'Discard changes').setWarning().onClick(async () => {
            try {
                if (untracked) {
                    const file = this.app.vault.getAbstractFileByPath(filepath);
                    if (!file) throw new Error('File no longer exists in the vault');
                    await this.app.vault.trash(file, false);
                } else {
                    await this.plugin.runGitMutation('Discard file changes', async (manager) => manager.discardFile(filepath));
                }
                this.applyFileMutationToSnapshot(filepath, 'removed');
                this.repaintStatusSnapshot();
                new Notice(untracked ? `Moved ${filepath} to trash` : `Restored ${filepath} from HEAD`);
                modal.close();
            } catch (error: any) {
                new Notice(`Discard failed: ${error?.message || String(error)}`);
            }
        });
        modal.open();
    }

    private confirmDiscardSelected(
        filepaths: string[],
        statusByPath: Map<string, GitFileStatus['status']>,
    ): void {
        const untracked = filepaths.every((filepath) => statusByPath.get(filepath) === 'untracked');
        const modal = new Modal(this.app);
        modal.titleEl.setText(untracked ? 'Delete selected untracked files?' : 'Revert selected changes?');
        modal.contentEl.createEl('p', {
            text: untracked
                ? `${filepaths.length} untracked file${filepaths.length === 1 ? '' : 's'} will be moved to Obsidian’s trash.`
                : `${filepaths.length} file change${filepaths.length === 1 ? '' : 's'} will be restored to their committed HEAD versions.`,
        });
        const actions = modal.contentEl.createDiv('git-confirm-actions');
        new ButtonComponent(actions).setButtonText('Cancel').onClick(() => modal.close());
        new ButtonComponent(actions)
            .setButtonText(untracked ? 'Move to trash' : 'Revert changes')
            .setWarning()
            .onClick(async () => {
                const succeeded: string[] = [];
                const failed: string[] = [];
                this.setMutationBusy(true);
                try {
                    if (untracked) {
                        for (const filepath of filepaths) {
                            const file = this.app.vault.getAbstractFileByPath(filepath);
                            if (!file) {
                                failed.push(filepath);
                                continue;
                            }
                            await this.app.vault.trash(file, false);
                            succeeded.push(filepath);
                        }
                    } else {
                        const result = await this.plugin.runGitMutation('Revert selected changes', async (manager) => {
                            for (const filepath of filepaths) await manager.discardFile(filepath);
                            return filepaths;
                        });
                        succeeded.push(...result);
                    }
                    for (const filepath of succeeded) {
                        this.selectedFilePaths.delete(filepath);
                        this.applyFileMutationToSnapshot(filepath, 'removed');
                    }
                    this.repaintStatusSnapshot();
                    new Notice(failed.length > 0
                        ? `${untracked ? 'Deleted' : 'Reverted'} ${succeeded.length} of ${filepaths.length} selected files.`
                        : `${untracked ? 'Moved' : 'Reverted'} ${succeeded.length} selected file${succeeded.length === 1 ? '' : 's'}.`);
                    modal.close();
                } catch (error: any) {
                    new Notice(`Could not ${untracked ? 'delete' : 'revert'} selected files: ${error?.message || String(error)}`);
                } finally {
                    this.setMutationBusy(false);
                }
            });
        modal.open();
    }

    private async openReviewModal(filepath: string): Promise<void> {
        const modal = new Modal(this.app);
        modal.titleEl.setText(`Review changes: ${filepath}`);
        modal.contentEl.createEl('p', { text: 'Read-only comparison of the committed HEAD version and the current vault file.', cls: 'git-review-description' });
        const panes = modal.contentEl.createDiv('git-review-panes');
        const headPane = panes.createDiv('git-review-pane');
        const worktreePane = panes.createDiv('git-review-pane');
        headPane.createEl('h4', { text: 'HEAD' });
        worktreePane.createEl('h4', { text: 'Working copy' });
        const headContent = headPane.createEl('pre', { text: 'Loading…', cls: 'git-review-content' });
        const worktreeContent = worktreePane.createEl('pre', { text: 'Loading…', cls: 'git-review-content' });
        modal.open();
        try {
            const review = await this.plugin.gitManager?.reviewFile(filepath);
            if (!review) throw new Error('Git backend unavailable');
            headContent.setText(review.head ?? '(Not tracked in HEAD)');
            worktreeContent.setText(review.worktree ?? '(Deleted from working copy)');
        } catch (error: any) {
            headContent.setText(`Could not load review: ${error?.message || String(error)}`);
            worktreeContent.setText('');
        }
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
        
        const cachedEntries = this.readModel.getLogEntries();
        if (!cachedEntries) {
            const persisted = await this.plugin.fileLogger?.readEntries(500) || [];
            if (!this.isCurrentRender(generation)) return;
            log.mergePersistedEntries(persisted);
            this.readModel.setLogEntries(log.getEntries());
        }
        this.activityRows.clear();
        this.syncActivityRows(this.readModel.getLogEntries() || [], listContainer, false);
    }

    /** Update the visible Activity feed from live memory only; disk is read on initial open/reload. */
    private applyLiveActivityEntries(): void {
        const entries = log.getEntries();
        this.readModel.setLogEntries(entries);
        const pane = this.tabContainers.get('log');
        const list = pane?.querySelector('.git-log-list') as HTMLElement | null;
        if (list) this.syncActivityRows(entries, list, true);
    }

    private activityKey(entry: { timestamp: number; level: string; namespace: string; message: string; data?: unknown }): string {
        return `${entry.timestamp}:${entry.level}:${entry.namespace}:${entry.message}:${JSON.stringify(entry.data)}`;
    }

    private syncActivityRows(entries: readonly ReturnType<typeof log.getEntries>[number][], list: HTMLElement, preservePosition: boolean): void {
        const scrollContainer = this.contentContainer;
        const previousTop = scrollContainer.scrollTop;
        const previousHeight = scrollContainer.scrollHeight;
        const wasAtTop = previousTop <= 4;
        const keys = new Set(entries.map((entry) => this.activityKey(entry)));
        for (const [key, row] of this.activityRows) {
            if (!keys.has(key)) {
                row.remove();
                this.activityRows.delete(key);
            }
        }
        list.querySelector('.git-empty-state')?.remove();
        if (entries.length === 0) {
            list.createEl('p', { text: 'No activity yet', cls: 'git-empty-state' });
            return;
        }
        const firstRow = () => list.querySelector('.git-log-entry');
        // Insert oldest-to-newest before the current first row so final order
        // remains newest-first without replacing rows the reader may be using.
        for (const entry of entries) {
            const key = this.activityKey(entry);
            if (this.activityRows.has(key)) continue;
            const row = this.createActivityRow(entry);
            list.insertBefore(row, firstRow());
            this.activityRows.set(key, row);
        }
        if (preservePosition && !wasAtTop) {
            scrollContainer.scrollTop = previousTop + (scrollContainer.scrollHeight - previousHeight);
        }
    }

    private createActivityRow(entry: ReturnType<typeof log.getEntries>[number]): HTMLElement {
        const row = document.createElement('div');
        row.addClass('git-log-entry');
        const time = row.createSpan({ text: this.formatLogTime(new Date(entry.timestamp)), cls: 'git-log-time' });
        const level = row.createSpan({ text: entry.level.toUpperCase(), cls: 'git-log-level git-log-' + entry.level });
        const message = row.createSpan({ text: entry.message, cls: 'git-log-message' });
        message.setAttr('title', `[${entry.namespace}] ${entry.message}`);
        if (entry.data) {
            const detail = row.createDiv('git-log-detail');
            detail.setText(typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data).slice(0, 200));
        }
        return row;
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
