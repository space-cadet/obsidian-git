import {
	App,
	ItemView,
	Menu,
	Notice,
	TAbstractFile,
	TFile,
	TFolder,
	setIcon,
	WorkspaceLeaf,
} from "obsidian";
import {
	ChangedFile,
	CommitFileChange,
	addToGitignore,
	commitChanges,
	inspectLocalRepository,
	invalidateRepositorySnapshot,
	LocalCommit,
	readCommits,
	readCommitChanges,
	readRemoteCommits,
	readChanges,
	removeFile,
	RepositoryState,
	stageFile,
	unstageFile,
	unstageFiles,
} from "./repository";
import { ConfirmActionModal, GitignoreEditorModal } from "./dialogs";
import { ACTIVITY_PAGE_SIZE } from "./pluginData";
import { elapsedMilliseconds, formatMilliseconds } from "./operationDiagnostics";
import { renderActivityPanel } from "./ActivityPanel";
import { renderCommitHistoryPanel } from "./CommitHistoryPanel";
import { applyStagingToSnapshot, replaceChangedPaths } from "./ChangeListState";
import { ChangeSelection, type ChangeSelectionSection } from "./ChangeSelection";
import type { CommitSource } from "./CommitHistoryPanel";
import type GitSyncPlugin from "./main";

export const VIEW_TYPE_GIT_SYNC = "git-sync-sidebar";
const COMMIT_PAGE_SIZE = 100;
type ChangeSection = ChangeSelectionSection;
type ChangeStatusFilter = "Untracked" | "Added" | "Modified" | "Deleted";
type ChangeSort = "path-asc" | "path-desc" | "status-path" | "folder-name";

const CHANGE_STATUS_FILTERS: ChangeStatusFilter[] = ["Untracked", "Added", "Modified", "Deleted"];
const CHANGE_SORTS: Array<{ value: ChangeSort; label: string }> = [
	{ value: "path-asc", label: "Path (A–Z)" },
	{ value: "path-desc", label: "Path (Z–A)" },
	{ value: "status-path", label: "Status, then path" },
	{ value: "folder-name", label: "Folder, then name" },
];

interface LongPressSelectionState {
	section: ChangeSection;
	path: string;
	visibleChanges: ChangedFile[];
	pointerId: number;
	startX: number;
	startY: number;
	timer: number;
	active: boolean;
	suppressClick: boolean;
}

interface ChangeTreeFolder {
	name: string;
	path: string;
	folders: Map<string, ChangeTreeFolder>;
	files: ChangedFile[];
	descendants: ChangedFile[];
}

export class GitSyncView extends ItemView {
	private readonly plugin: GitSyncPlugin;
	private activeTab = "Changes";
	private repositoryState: RepositoryState | null = null;
	private changes: ChangedFile[] | null = null;
	private commits: LocalCommit[] | null = null;
	private remoteCommits: LocalCommit[] | null = null;
	private remoteHistoryAvailable = false;
	private commitsError: string | null = null;
	private remoteCommitsError: string | null = null;
	private commitSource: CommitSource = "local";
	private selectedCommitOid: string | null = null;
	private readonly changeSelection = new ChangeSelection();
	private readonly commitChangesCache = new Map<string, CommitFileChange[]>();
	private readonly commitChangesLoading = new Set<string>();
	private readonly commitChangesErrors = new Map<string, string>();
	private readonly changeFilters = new Map<ChangeSection, Set<ChangeStatusFilter>>();
	private readonly changeSorts = new Map<ChangeSection, ChangeSort>();
	private readonly commitDepth = new Map<CommitSource, number>([
		["local", COMMIT_PAGE_SIZE],
		["remote", COMMIT_PAGE_SIZE],
	]);
	private readonly commitHasMore = new Map<CommitSource, boolean>();
	private commitHistoryRepositoryPath = "";
	private commitHistoryBranchName = "";
	private longPressState: LongPressSelectionState | null = null;
	private readonly collapsedSections = new Set<"staged" | "uncommitted">();
	private readonly collapsedChangeFolders = new Set<string>();
	private changesError: string | null = null;
	private changesRefreshRequired = false;
	private changesRefreshReason = "";
	private repositoryRefreshInProgress = false;
	private readonly pendingIntegrationStagePaths = new Set<string>();
	private committing = false;
	private activeChangeAction = "";
	private readonly pendingStagePaths = new Set<string>();
	private readonly pendingFileActions = new Set<string>();
	private commitHistoryRefreshInProgress = false;
	private commitMessage = "";
	private changesContentEl: HTMLElement | null = null;
	private changesScrollTop = 0;
	private refreshGeneration = 0;
	private activityVisibleCount = ACTIVITY_PAGE_SIZE;
	private commitHistoryLoading = false;
	private remoteHistoryLoading = false;
	private lastRepositoryActivity = "";
	private readonly pendingBackgroundRefreshPaths = new Set<string>();
	private backgroundRefreshTimer: number | null = null;
	private backgroundEventsRegistered = false;
	private backgroundViewOpen = false;

	constructor(leaf: WorkspaceLeaf, plugin: GitSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_GIT_SYNC;
	}

	getDisplayText(): string {
		return "Git Sync";
	}

	getIcon(): string {
		return "git-branch";
	}

	onOpen(): Promise<void> {
		this.backgroundViewOpen = true;
		if (!this.backgroundEventsRegistered) {
			this.registerEvent(this.app.vault.on("create", (file) => this.queueBackgroundFileRefresh(file)));
			this.registerEvent(this.app.vault.on("modify", (file) => this.queueBackgroundFileRefresh(file)));
			this.registerEvent(this.app.vault.on("delete", (file) => this.queueBackgroundFileRefresh(file)));
			this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
				this.queueBackgroundFileRefresh(file, oldPath);
			}));
			this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf !== this.leaf) return;
				this.flushPendingBackgroundRefresh();
			}));
			this.backgroundEventsRegistered = true;
		}
		this.render();
		void this.refreshRepositoryState("view-open");
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.backgroundViewOpen = false;
		this.cancelLongPressSelection();
		this.clearBackgroundRefreshTimer();
		this.pendingBackgroundRefreshPaths.clear();
		this.refreshGeneration += 1;
		this.repositoryRefreshInProgress = false;
		this.pendingIntegrationStagePaths.clear();
		this.contentEl.empty();
		return Promise.resolve();
	}

	backgroundRefreshSettingChanged(): void {
		this.clearBackgroundRefreshTimer();
		if (this.plugin.settings.backgroundRefreshDelaySeconds <= 0) {
			this.pendingBackgroundRefreshPaths.clear();
			return;
		}
		this.scheduleBackgroundRefresh();
	}

	private queueBackgroundRefresh(vaultPath: string): void {
		if (!this.backgroundViewOpen || this.plugin.settings.backgroundRefreshDelaySeconds <= 0 || this.app.workspace.activeLeaf === this.leaf) return;
		const repositoryPath = this.plugin.settings.repositoryPath.trim().replace(/^\/+|\/+$/g, "");
		let path = vaultPath.replace(/^\/+|\/+$/g, "");
		if (repositoryPath && repositoryPath !== ".") {
			if (!path.startsWith(`${repositoryPath}/`)) return;
			path = path.slice(repositoryPath.length + 1);
		}
		if (!path || path === ".git" || path.startsWith(".git/") || path === "activity.log") return;
		this.pendingBackgroundRefreshPaths.add(path);
		this.scheduleBackgroundRefresh();
	}

	private queueBackgroundFileRefresh(file: TAbstractFile, oldPath?: string): void {
		if (file instanceof TFile) {
			if (oldPath) this.queueBackgroundRefresh(oldPath);
			this.queueBackgroundRefresh(file.path);
			return;
		}
		if (!(file instanceof TFolder)) return;
		const visit = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (child instanceof TFile) {
					this.queueBackgroundRefresh(child.path);
					if (oldPath) this.queueBackgroundRefresh(`${oldPath}${child.path.slice(file.path.length)}`);
				} else if (child instanceof TFolder) {
					visit(child);
				}
			}
		};
		visit(file);
	}

	private scheduleBackgroundRefresh(): void {
		this.clearBackgroundRefreshTimer();
		const delaySeconds = this.plugin.settings.backgroundRefreshDelaySeconds;
		if (delaySeconds <= 0 || this.pendingBackgroundRefreshPaths.size === 0) return;
		this.backgroundRefreshTimer = window.setTimeout(() => {
			this.backgroundRefreshTimer = null;
			if (this.app.workspace.activeLeaf === this.leaf) {
				this.flushPendingBackgroundRefresh();
				return;
			}
			void this.refreshPendingBackgroundPaths("background-idle");
		}, delaySeconds * 1000);
	}

	private flushPendingBackgroundRefresh(): void {
		this.clearBackgroundRefreshTimer();
		if (this.pendingBackgroundRefreshPaths.size > 0) {
			void this.refreshPendingBackgroundPaths("background-return");
		}
	}

	private async refreshPendingBackgroundPaths(reason: string): Promise<void> {
		const paths = [...this.pendingBackgroundRefreshPaths];
		this.pendingBackgroundRefreshPaths.clear();
		if (paths.length === 0) return;
		await this.refreshChangesForPaths(paths, paths, reason);
	}

	private clearBackgroundRefreshTimer(): void {
		if (this.backgroundRefreshTimer === null) return;
		window.clearTimeout(this.backgroundRefreshTimer);
		this.backgroundRefreshTimer = null;
	}

	refreshActivity(): void {
		if (this.activeTab === "Log") this.render();
	}

	render(): void {
		this.cancelLongPressSelection();
		this.captureChangesScrollTop();
		const root = this.contentEl;
		root.empty();
		root.addClass("git-sync-sidebar");

		const topbar = root.createDiv({ cls: "git-sync-topbar" });
		const tabs = topbar.createDiv({ cls: "git-sync-tabs", attr: { role: "tablist" } });
		for (const tabName of ["Changes", "Commits", "Log"]) {
			const tab = tabs.createEl("button", {
				text: tabName,
				cls: tabName === this.activeTab ? "git-sync-tab is-active" : "git-sync-tab",
				attr: { type: "button", role: "tab", "aria-selected": String(tabName === this.activeTab) },
			});
			tab.addEventListener("click", () => {
				this.activeTab = tabName;
				this.render();
				if (tabName === "Commits" && this.repositoryState?.kind === "ready" && (!this.commits || !this.remoteCommits)) {
					void this.loadCommitHistories("commits-tab");
				}
			});
		}

		const settingsButton = topbar.createEl("button", {
			cls: "git-sync-settings-button",
			attr: { type: "button", "aria-label": "Open Git Sync settings", title: "Open Settings" },
		});
		setIcon(settingsButton, "settings");
		settingsButton.addEventListener("click", () => this.openSettings());
		const repository = this.plugin.settings.repositoryPath.trim();
		this.renderRepositoryContext(root, repository);

		const content = root.createDiv({ cls: "git-sync-content" });
		this.changesContentEl = null;
		if (this.activeTab === "Log") {
			this.renderActivity(content);
			return;
		}

		if (!repository) {
			this.renderSettingsPrompt(content, "Set up your repository");
			return;
		}

		if (!this.repositoryState || this.repositoryState.kind === "checking") {
			if (this.activeTab === "Changes") {
				this.changesContentEl = content;
				this.renderChanges(content);
				this.renderChangesActionBar(root);
				this.restoreChangesScrollTop(content);
			} else if (this.activeTab === "Commits") {
				this.renderCommits(content);
			} else {
				content.createEl("p", {
					text: "Checking repository…",
					cls: "git-sync-state-description",
					attr: { "aria-busy": "true" },
				});
			}
			return;
		}

		if (this.repositoryState.kind === "missing") {
			content.createDiv({ cls: "git-sync-state-title", text: "No Git repository found" });
			content.createEl("p", {
				text: `No .git directory was found at ${this.repositoryState.repositoryPath}.`,
				cls: "git-sync-state-description",
			});
			this.addRefreshButton(content);
			return;
		}

		if (this.repositoryState.kind === "error") {
			content.createDiv({ cls: "git-sync-state-title", text: "Could not read repository" });
			content.createEl("p", {
				text: this.repositoryState.message,
				cls: "git-sync-state-description",
			});
			this.addRefreshButton(content);
			return;
		}

		if (this.activeTab === "Changes") {
			this.changesContentEl = content;
			this.renderChanges(content);
			this.renderChangesActionBar(root);
			this.restoreChangesScrollTop(content);
			return;
		}

		if (this.activeTab === "Commits") {
			this.renderCommits(content);
			return;
		}

		content.createDiv({ cls: "git-sync-state-title", text: this.activeTab });
		content.createEl("p", { text: `Local repository ready on ${this.repositoryState.branch}.`, cls: "git-sync-state-description" });
		this.addRefreshButton(content);
	}

	private renderRepositoryContext(root: HTMLElement, repository: string): void {
		const context = root.querySelector<HTMLElement>(".git-sync-repository-context") ?? root.createDiv({ cls: "git-sync-repository-context" });
		context.empty();
		const branch = context.createDiv({ cls: "git-sync-branch-context" });
		const branchIcon = branch.createSpan({ cls: "git-sync-branch-icon" });
		setIcon(branchIcon, "git-branch");
		const branchName = this.repositoryState?.kind === "ready"
			? this.repositoryState.branch
			: this.plugin.settings.branchName.trim() || "No branch";
		branch.createSpan({ cls: "git-sync-branch-name", text: branchName });

		const refreshButton = branch.createEl("button", {
			cls: "git-sync-context-action",
			attr: {
				type: "button",
				"aria-label": this.repositoryRefreshInProgress ? "Refreshing repository" : "Refresh repository",
				title: this.repositoryRefreshInProgress ? "Refreshing repository" : "Refresh repository",
				"aria-busy": String(this.repositoryRefreshInProgress),
			},
		});
		setIcon(refreshButton, "refresh-cw");
		if (this.repositoryRefreshInProgress) refreshButton.addClass("git-sync-branch-refreshing");
		refreshButton.disabled = !repository || this.repositoryRefreshInProgress;
		refreshButton.addEventListener("click", () => void this.refreshRepositoryState("manual-refresh"));

		const comparisonState = this.getComparisonState(repository);
		const comparison = context.createDiv({ cls: "git-sync-comparison-status" });
		const comparisonIcon = comparison.createSpan({ cls: "git-sync-comparison-icon" });
		comparisonIcon.setAttribute("data-comparison-state", comparisonState.kind);
		setIcon(comparisonIcon, comparisonState.icon);
		comparison.createDiv({
			cls: "git-sync-comparison-text",
			text: comparisonState.label,
		});
	}

	private getComparisonState(repository: string): {
		kind: "unconfigured" | "checking" | "deferred" | "unavailable" | "up-to-date" | "local-ahead" | "remote-ahead" | "diverged";
		icon: string;
		label: string;
	} {
		if (!repository) return { kind: "unconfigured", icon: "alert-circle", label: "Repository not configured" };
		if (this.repositoryState?.kind !== "ready") {
			return { kind: "checking", icon: "git-compare", label: "Checking repository comparison" };
		}
		if (!this.commits || this.remoteCommits === null) {
			return { kind: "deferred", icon: "git-compare", label: "Open Commits for comparison" };
		}
		if (!this.remoteHistoryAvailable) {
			return { kind: "unavailable", icon: "alert-circle", label: "Remote comparison unavailable" };
		}

		const localHead = this.commits[0]?.oid;
		const remoteHead = this.remoteCommits[0]?.oid;
		if ((!localHead && !remoteHead) || localHead === remoteHead) {
			return { kind: "up-to-date", icon: "check-circle", label: "Up to date" };
		}
		if (!localHead || !remoteHead) {
			return localHead
				? { kind: "local-ahead", icon: "arrow-up", label: "Local is ahead" }
				: { kind: "remote-ahead", icon: "arrow-down", label: "Remote is ahead" };
		}
		if (this.remoteCommits.some((commit) => commit.oid === localHead)) {
			return { kind: "remote-ahead", icon: "arrow-down", label: "Remote is ahead" };
		}
		if (this.commits.some((commit) => commit.oid === remoteHead)) {
			return { kind: "local-ahead", icon: "arrow-up", label: "Local is ahead" };
		}
		return { kind: "diverged", icon: "git-compare", label: "Branches have diverged" };
	}

	async refreshRepositoryState(reason = "refresh", refreshChanges = true): Promise<void> {
		const startedAt = Date.now();
		const phaseDurations: Array<{ label: string; elapsed: number }> = [];
		const timed = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
			const phaseStartedAt = Date.now();
			try {
				return await operation();
			} finally {
				phaseDurations.push({ label, elapsed: Date.now() - phaseStartedAt });
			}
		};
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (repositoryPath) invalidateRepositorySnapshot(repositoryPath);
		if (!repositoryPath) {
			this.repositoryRefreshInProgress = false;
			this.repositoryState = null;
			this.render();
			this.plugin.recordActivity(`Repository refresh [${reason}] skipped: no repository path configured.`, "METRIC");
			return;
		}
		const branchName = this.plugin.settings.branchName.trim();
		if (this.commitHistoryRepositoryPath !== repositoryPath) {
			this.commitDepth.set("local", COMMIT_PAGE_SIZE);
			this.commitDepth.set("remote", COMMIT_PAGE_SIZE);
			this.commitHasMore.clear();
			this.commitHistoryRepositoryPath = repositoryPath;
		}
		if (this.commitHistoryBranchName !== branchName) {
			this.commitDepth.set("remote", COMMIT_PAGE_SIZE);
			this.commitHasMore.delete("remote");
			this.commitHistoryBranchName = branchName;
		}

		const generation = ++this.refreshGeneration;
		this.repositoryRefreshInProgress = true;
		this.changesRefreshRequired = !refreshChanges;
		this.changesRefreshReason = refreshChanges ? "" : reason;
		if (!refreshChanges) {
			this.changes = null;
			this.changesError = null;
			this.changeSelection.clear();
		}
		this.repositoryState = { kind: "checking", repositoryPath };
		if (this.activeTab === "Changes" && this.changesContentEl?.isConnected) {
			this.renderRepositoryContext(this.contentEl, repositoryPath);
		} else {
			this.render();
		}
		const state = await timed("inspect", () => inspectLocalRepository(this.app.vault.adapter, repositoryPath));
		if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
		this.repositoryState = state;
		if (state.kind === "ready") {
			if (refreshChanges) {
				this.changesRefreshRequired = false;
				this.changesRefreshReason = "";
				try {
					const changes = await timed("changes", () => readChanges(this.app.vault.adapter, repositoryPath));
					if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
					this.changes = changes;
					const availablePaths = new Set(this.changes.map((change) => change.path));
					this.changeSelection.retainAvailablePaths(availablePaths);
					this.changesError = null;
				} catch (error) {
					this.changes = null;
					this.changesError = error instanceof Error ? error.message : "Unable to read local changes.";
				}
			}
			if (this.activeTab === "Commits") {
				try {
					const localCommitHistory = await timed(
						"commits",
						() => readCommits(this.app.vault.adapter, repositoryPath, this.commitDepth.get("local") ?? COMMIT_PAGE_SIZE),
					);
					this.commits = this.hydrateCommitChanges(
						localCommitHistory.commits,
						repositoryPath,
					);
					this.commitHasMore.set("local", localCommitHistory.hasMore);
					this.commitsError = null;
					if (this.selectedCommitOid && !this.commits.some((commit) => commit.oid === this.selectedCommitOid)) {
						this.selectedCommitOid = null;
					}
				} catch (error) {
					this.commits = null;
					this.commitHasMore.set("local", false);
					this.commitsError = error instanceof Error ? error.message : "Unable to read local commits.";
				}
				try {
					const remoteCommitHistory = await timed("remote-commits", () => readRemoteCommits(
						this.app.vault.adapter,
						repositoryPath,
						this.plugin.settings.branchName,
						this.commitDepth.get("remote") ?? COMMIT_PAGE_SIZE,
					));
					this.remoteCommits = this.hydrateCommitChanges(remoteCommitHistory.commits, repositoryPath);
					this.remoteHistoryAvailable = remoteCommitHistory.available;
					this.commitHasMore.set("remote", remoteCommitHistory.hasMore);
					this.remoteCommitsError = null;
				} catch (error) {
					this.remoteCommits = null;
					this.remoteHistoryAvailable = false;
					this.commitHasMore.set("remote", false);
					this.remoteCommitsError = error instanceof Error ? error.message : "Unable to read remote commits.";
				}
			} else {
				this.commits = null;
				this.remoteCommits = null;
				this.remoteHistoryAvailable = false;
				this.commitsError = null;
				this.remoteCommitsError = null;
			}
		} else {
			this.changes = null;
			this.changesError = null;
			this.commits = null;
			this.remoteCommits = null;
			this.remoteHistoryAvailable = false;
			this.commitsError = null;
			this.remoteCommitsError = null;
			this.selectedCommitOid = null;
		}
		if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
		const phases = phaseDurations.map(({ label, elapsed }) => `${label} ${formatMilliseconds(elapsed)}`).join(", ");
		const changeCount = this.changes?.length ?? 0;
		const localCommitCount = this.commits?.length ?? 0;
		const remoteCommitCount = this.remoteCommits?.length ?? 0;
		const refreshLabel = refreshChanges ? "Repository refresh" : "Repository metadata refresh";
		const changeSummary = refreshChanges ? `${changeCount} changes` : "Changes scan deferred";
		const historySummary = this.commits === null || this.remoteCommits === null
			? "commit history deferred"
			: `${localCommitCount} local commits, ${remoteCommitCount} remote commits`;
		this.plugin.recordActivity(
			`${refreshLabel} [${reason}] completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))} (${phases}; ${changeSummary}, ${historySummary}).`,
			"METRIC",
		);
		this.recordRepositoryActivity(state);
		this.repositoryRefreshInProgress = false;
		invalidateRepositorySnapshot(repositoryPath);
		if (this.activeTab === "Changes" && this.changesContentEl?.isConnected) {
			this.renderRepositoryContext(this.contentEl, repositoryPath);
			this.updateChangesContent();
		} else {
			this.render();
		}
		this.flushPendingIntegrationStagePaths();
		if (this.activeTab === "Commits" && (!this.commits || !this.remoteCommits)) {
			void this.loadCommitHistories("commits-tab");
		}
	}

	private async loadCommitHistories(reason: string): Promise<void> {
		if (this.commitHistoryRefreshInProgress || this.repositoryRefreshInProgress) return;
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (!repositoryPath || this.repositoryState?.kind !== "ready") return;

		const startedAt = Date.now();
		const generation = this.refreshGeneration;
		this.commitHistoryRefreshInProgress = true;
		if (this.activeTab === "Commits") this.render();
		try {
			const localRequest = readCommits(
				this.app.vault.adapter,
				repositoryPath,
				this.commitDepth.get("local") ?? COMMIT_PAGE_SIZE,
			).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
			const remoteRequest = readRemoteCommits(
					this.app.vault.adapter,
					repositoryPath,
					this.plugin.settings.branchName,
					this.commitDepth.get("remote") ?? COMMIT_PAGE_SIZE,
				).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
			const [localResult, remoteResult] = await Promise.all([localRequest, remoteRequest]);
			if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;

			if (localResult.ok) {
				this.commits = this.hydrateCommitChanges(localResult.value.commits, repositoryPath);
				this.commitHasMore.set("local", localResult.value.hasMore);
				this.commitsError = null;
			} else {
				this.commits = null;
				this.commitsError = localResult.error instanceof Error ? localResult.error.message : "Unable to read local commits.";
			}
			if (remoteResult.ok) {
				this.remoteCommits = this.hydrateCommitChanges(remoteResult.value.commits, repositoryPath);
				this.remoteHistoryAvailable = remoteResult.value.available;
				this.commitHasMore.set("remote", remoteResult.value.hasMore);
				this.remoteCommitsError = null;
			} else {
				this.remoteCommits = null;
				this.remoteHistoryAvailable = false;
				this.remoteCommitsError = remoteResult.error instanceof Error ? remoteResult.error.message : "Unable to read remote commits.";
			}
			this.plugin.recordActivity(
				`Commit history refresh [${reason}] completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`,
				"METRIC",
			);
		} finally {
			this.commitHistoryRefreshInProgress = false;
			if (this.contentEl.isConnected && this.activeTab === "Commits") this.render();
		}
	}

	private renderChanges(content: HTMLElement): void {
		if (this.changesRefreshRequired) {
			const notice = content.createDiv({ cls: "git-sync-refresh-required" });
			notice.createDiv({ cls: "git-sync-state-title", text: "Changes need refreshing" });
			notice.createEl("p", {
				text: `The working tree may have changed after ${this.changesRefreshReason}. Refresh the repository to read the current Changes list.`,
				cls: "git-sync-state-description",
			});
			const refresh = notice.createEl("button", {
				text: this.repositoryRefreshInProgress ? "Refreshing repository…" : "Refresh repository",
				cls: "",
				attr: { type: "button", "aria-busy": String(this.repositoryRefreshInProgress) },
			});
			refresh.disabled = this.repositoryRefreshInProgress;
			refresh.addEventListener("click", () => void this.refreshRepositoryState("manual-refresh"));
			return;
		}
		if (this.changesError) {
			content.createEl("p", { text: this.changesError, cls: "git-sync-state-description" });
			return;
		}
		if (!this.changes) {
			content.createEl("p", {
				text: "Reading local changes…",
				cls: "git-sync-state-description",
				attr: { "aria-busy": "true" },
			});
			this.renderChangeSection(content, "staged", "STAGED", [], "Unstage selected", true);
			this.renderChangeSection(content, "uncommitted", "UNCOMMITTED CHANGES", [], "Stage selected", true);
			this.renderCommitComposer(content, null);
			return;
		}
		const staged = this.changes.filter((change) => change.staged);
		const uncommitted = this.changes.filter((change) => !change.staged);
		this.renderChangeSection(content, "staged", "STAGED", staged, "Unstage selected");
		this.renderChangeSection(content, "uncommitted", "UNCOMMITTED CHANGES", uncommitted, "Stage selected");

		this.renderCommitComposer(content, staged.length);
	}

	private renderCommitComposer(content: HTMLElement, stagedCount: number | null): void {
		const commit = content.createDiv({ cls: "git-sync-commit" });
		commit.createDiv({ text: "Commit staged changes", cls: "git-sync-commit-title" });
		commit.createDiv({
			text: stagedCount === null
				? "Checking staged files…"
				: `${stagedCount} file${stagedCount === 1 ? "" : "s"} staged`,
			cls: "git-sync-commit-meta",
		});
		const message = commit.createEl("textarea", {
			attr: { placeholder: "Commit message", "aria-label": "Commit message", rows: "3" },
		});
		message.value = this.commitMessage;
		message.addEventListener("input", () => {
			this.commitMessage = message.value;
		});
		const commitActions = commit.createDiv({ cls: "git-sync-commit-actions" });
		const committing = this.committing && !this.activeChangeAction;
		const commitButton = commitActions.createEl("button", {
			text: committing ? "Committing…" : "Commit",
			cls: "mod-cta",
			attr: { type: "button", "aria-busy": String(committing) },
		});
		commitButton.disabled = stagedCount === null || stagedCount === 0 || this.committing;
		commitButton.addEventListener("click", () => void this.commit(message.value));
	}

	private renderCommits(content: HTMLElement): void {
		renderCommitHistoryPanel(content, {
			source: this.commitSource,
			commits: this.commits,
			remoteCommits: this.remoteCommits,
			remoteHistoryAvailable: this.remoteHistoryAvailable,
			remoteHistoryLoading: this.remoteHistoryLoading,
			commitsError: this.commitsError,
			remoteCommitsError: this.remoteCommitsError,
			branchName: this.plugin.settings.branchName,
			selectedCommitOid: this.selectedCommitOid,
			commitChangesErrors: this.commitChangesErrors,
			repositoryPath: this.plugin.settings.repositoryPath.trim(),
			commitHasMore: this.commitHasMore.get(this.commitSource) ?? false,
			commitHistoryLoading: this.commitHistoryLoading,
			repositoryRefreshInProgress: this.repositoryRefreshInProgress,
		}, {
			setSource: (source) => {
				this.commitSource = source;
				this.selectedCommitOid = null;
				this.render();
			},
			selectCommit: (oid) => {
				this.selectedCommitOid = oid;
				this.render();
			},
			loadMore: () => void this.loadMoreCommits(),
			loadCommitChanges: (oid) => void this.loadCommitChanges(oid),
			refreshRepository: () => void this.refreshRepositoryState(),
		});
	}

	private async loadMoreCommits(): Promise<void> {
		if (this.commitHistoryLoading || !this.commitHasMore.get(this.commitSource)) return;
		const source = this.commitSource;
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		const previousDepth = this.commitDepth.get(source) ?? COMMIT_PAGE_SIZE;
		const nextDepth = previousDepth + COMMIT_PAGE_SIZE;
		this.commitDepth.set(source, nextDepth);
		this.commitHistoryLoading = true;
		this.render();
		const startedAt = Date.now();

		try {
			if (source === "local") {
				const history = await readCommits(this.app.vault.adapter, repositoryPath, nextDepth);
				this.commits = this.hydrateCommitChanges(history.commits, repositoryPath);
				this.commitHasMore.set(source, history.hasMore);
				this.commitsError = null;
			} else {
				const history = await readRemoteCommits(
					this.app.vault.adapter,
					repositoryPath,
					this.plugin.settings.branchName,
					nextDepth,
				);
				this.remoteCommits = this.hydrateCommitChanges(history.commits, repositoryPath);
				this.remoteHistoryAvailable = history.available;
				this.commitHasMore.set(source, history.hasMore);
				this.remoteCommitsError = null;
			}
			this.plugin.recordActivity(
				`Loaded ${source} commits through ${nextDepth} entries in ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`,
				"METRIC",
			);
		} catch (error) {
			this.commitDepth.set(source, previousDepth);
			if (source === "local") {
				this.commitsError = error instanceof Error ? error.message : "Unable to load more local commits.";
			} else {
				this.remoteCommitsError = error instanceof Error ? error.message : "Unable to load more remote commits.";
			}
		} finally {
			this.commitHistoryLoading = false;
			this.render();
		}
	}

	private hydrateCommitChanges(commits: LocalCommit[], repositoryPath: string): LocalCommit[] {
		return commits.map((commit) => {
			const changes = this.commitChangesCache.get(this.commitChangesCacheKey(commit.oid, repositoryPath));
			return changes
				? { ...commit, changes, changesLoaded: true }
				: commit;
		});
	}

	private async loadCommitChanges(commitOid: string): Promise<void> {
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		const cacheKey = this.commitChangesCacheKey(commitOid, repositoryPath);
		if (this.commitChangesLoading.has(cacheKey)) return;
		const cached = this.commitChangesCache.get(cacheKey);
		if (cached) {
			this.applyLoadedCommitChanges(commitOid, cached);
			return;
		}

		this.commitChangesLoading.add(cacheKey);
		this.commitChangesErrors.delete(cacheKey);
		const startedAt = Date.now();
		try {
			const changes = await readCommitChanges(this.app.vault.adapter, repositoryPath, commitOid);
			this.commitChangesCache.set(cacheKey, changes);
			this.applyLoadedCommitChanges(commitOid, changes);
			this.plugin.recordActivity(
				`Commit ${commitOid.slice(0, 7)} changed-file details loaded in ${formatMilliseconds(elapsedMilliseconds(startedAt))} (${changes.length} files).`,
				"METRIC",
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to read changed files.";
			this.commitChangesErrors.set(
				cacheKey,
				detail,
			);
			this.plugin.recordActivity(
				`Commit ${commitOid.slice(0, 7)} changed-file details failed after ${formatMilliseconds(elapsedMilliseconds(startedAt))}: ${detail}`,
				"ERROR",
			);
		} finally {
			this.commitChangesLoading.delete(cacheKey);
			if (this.selectedCommitOid === commitOid) this.render();
		}
	}

	private applyLoadedCommitChanges(commitOid: string, changes: CommitFileChange[]): void {
		const update = (commits: LocalCommit[] | null): LocalCommit[] | null => commits?.map((commit) =>
			commit.oid === commitOid ? { ...commit, changes, changesLoaded: true } : commit,
		) ?? null;
		this.commits = update(this.commits);
		this.remoteCommits = update(this.remoteCommits);
	}

	private commitChangesCacheKey(commitOid: string, repositoryPath = this.plugin.settings.repositoryPath.trim()): string {
		return `${repositoryPath}\u0000${commitOid}`;
	}

	private renderChangeSection(
		content: HTMLElement,
		section: ChangeSection,
		title: string,
		changes: ChangedFile[],
		bulkAction: string,
		loading = false,
	): void {
		const sectionEl = content.createDiv({ cls: "git-sync-change-section" });
		const header = sectionEl.createDiv({ cls: "git-sync-change-section-header" });
		header.createDiv({ cls: "git-sync-section-title", text: title });
		const actionInProgress = this.activeChangeAction === (section === "staged" ? "Unstage all" : "Stage all") ||
			this.activeChangeAction === `${section === "staged" ? "Unstage" : "Stage"} selected`;
		header.createDiv({
			cls: "git-sync-section-count",
			text: loading ? "…" : actionInProgress ? `${section === "staged" ? "Unstaging" : "Staging"}…` : String(changes.length),
		});
		const filter = header.createEl("button", {
			cls: "git-sync-section-action",
			attr: {
				type: "button",
				"aria-label": `Filter ${title.toLowerCase()}`,
				title: "Filter by status",
				"data-active": String(this.hasChangeFilter(section)),
			},
		});
		setIcon(filter, "filter");
		filter.addEventListener("click", (event) => this.showChangeFilterMenu(section, event));
		const sort = header.createEl("button", {
			cls: "git-sync-section-action",
			attr: {
				type: "button",
				"aria-label": `Sort ${title.toLowerCase()}`,
				title: `Sort: ${this.getChangeSortLabel(section)}`,
			},
		});
		setIcon(sort, "arrow-down-up");
		sort.addEventListener("click", (event) => this.showChangeSortMenu(section, event));
		const sectionActionName = section === "staged" ? "Unstage all" : "Stage all";
		const sectionActionLoading = actionInProgress;
		const sectionAction = header.createEl("button", {
			cls: `git-sync-section-action git-sync-stage-all-action ${section === "staged" ? "is-unstage" : "is-stage"}`,
			attr: {
				type: "button",
				"aria-label": sectionActionLoading ? `${section === "staged" ? "Unstaging" : "Staging"} files` : section === "staged" ? "Unstage all staged files" : "Stage all uncommitted files",
				title: sectionActionLoading ? `${section === "staged" ? "Unstaging" : "Staging"} files…` : sectionActionName,
			},
		});
		setIcon(sectionAction, section === "staged" ? "minus" : "plus");
		sectionAction.createSpan({ text: sectionActionName });
		sectionAction.disabled = loading || changes.length === 0 || this.committing;
		sectionAction.addEventListener("click", () => void this.applyAllStage(section === "staged"));
		const collapse = header.createEl("button", {
			cls: "git-sync-icon-button",
			attr: { type: "button", "aria-label": `${this.collapsedSections.has(section) ? "Expand" : "Collapse"} ${title}` },
		});
		setIcon(collapse, this.collapsedSections.has(section) ? "chevron-right" : "chevron-down");
		collapse.addEventListener("click", () => {
			if (this.collapsedSections.has(section)) this.collapsedSections.delete(section);
			else this.collapsedSections.add(section);
			this.render();
		});

		if (this.collapsedSections.has(section)) return;
		if (loading) {
			const placeholders = sectionEl.createDiv({
				cls: "git-sync-change-loading-list",
				attr: { "aria-hidden": "true" },
			});
			for (let index = 0; index < 2; index += 1) {
				const row = placeholders.createDiv({ cls: "git-sync-change-loading-row" });
				row.createSpan({ cls: "git-sync-loading-checkbox" });
				row.createSpan({ cls: "git-sync-loading-action" });
				row.createSpan({ cls: "git-sync-loading-line" });
			}
			return;
		}
		const visibleChanges = this.getVisibleChanges(section, changes);

		if (changes.length === 0) {
			sectionEl.createDiv({ cls: "git-sync-section-empty", text: section === "staged" ? "No staged files" : "No uncommitted changes" });
			return;
		}

		if (visibleChanges.length === 0) {
			sectionEl.createDiv({ cls: "git-sync-section-empty", text: "No files match this filter" });
			return;
		}

		const selectedInSection = visibleChanges.filter((change) => this.changeSelection.isSelected(change.path));
		if (selectedInSection.length > 0) {
			const toolbar = sectionEl.createDiv({ cls: "git-sync-change-toolbar" });
			const selectedActionName = section === "staged" ? "Unstage selected" : "Stage selected";
			const selectedActionLoading = this.activeChangeAction === selectedActionName;
			toolbar.createDiv({
				cls: "git-sync-select-label",
				text: selectedActionLoading ? `${section === "staged" ? "Unstaging" : "Staging"} selected…` : `${selectedInSection.length} selected`,
			});
			const clear = toolbar.createEl("button", {
				cls: "git-sync-selection-action",
				attr: { type: "button", "aria-label": "Clear selection", title: "Clear selection" },
			});
			setIcon(clear, "x");
			clear.addEventListener("click", () => {
				this.changeSelection.clearPaths(visibleChanges.map((change) => change.path));
				this.render();
			});
			const action = toolbar.createEl("button", {
				cls: `git-sync-selection-action is-stage-selection-action ${section === "staged" ? "is-unstage" : "is-stage"}`,
				attr: {
					type: "button",
					"aria-label": selectedActionLoading ? `${section === "staged" ? "Unstaging" : "Staging"} selected files` : bulkAction === "Stage selected" ? "Stage selected files" : "Unstage selected files",
					title: selectedActionLoading ? `${section === "staged" ? "Unstaging" : "Staging"} selected files…` : bulkAction === "Stage selected" ? "Stage selected files" : "Unstage selected files",
				},
			});
			setIcon(action, section === "staged" ? "minus" : "plus");
			action.createSpan({ text: section === "staged" ? "Unstage" : "Stage" });
			action.disabled = this.committing;
			action.addEventListener("click", () => void this.applySelectedStage(section, visibleChanges));
		}

		const list = sectionEl.createEl("ul", { cls: "git-sync-changes-list" });
		this.renderChangeTree(list, section, visibleChanges);
	}

	private renderChangeTree(list: HTMLElement, section: ChangeSection, changes: ChangedFile[]): void {
		const root: ChangeTreeFolder = { name: "", path: "", folders: new Map(), files: [], descendants: [] };
		const changeIndexes = new Map(changes.map((change, index) => [change.path, index]));
		for (const change of changes) {
			const parts = change.path.split("/").filter(Boolean);
			let parent = root;
			for (const name of parts.slice(0, -1)) {
				let folder = parent.folders.get(name);
				if (!folder) {
					folder = {
						name,
						path: parent.path ? `${parent.path}/${name}` : name,
						folders: new Map(),
						files: [],
						descendants: [],
					};
					parent.folders.set(name, folder);
				}
				folder.descendants.push(change);
				parent = folder;
			}
			parent.files.push(change);
		}

		const renderFolder = (parentList: HTMLElement, folder: ChangeTreeFolder): void => {
			const item = parentList.createEl("li", { cls: "git-sync-change-folder" });
			const row = item.createDiv({ cls: "git-sync-folder-row" });
			const selectedCount = this.changeSelection.countSelected(folder.descendants);
			const folderActionPending = this.pendingFileActions.has(folder.path);
			const checkbox = row.createEl("input", {
				attr: {
					type: "checkbox",
					"aria-label": `Select ${folder.descendants.length} visible changed files in ${folder.path}`,
				},
			});
			checkbox.checked = selectedCount === folder.descendants.length;
			checkbox.indeterminate = selectedCount > 0 && selectedCount < folder.descendants.length;
			checkbox.disabled = this.committing || folderActionPending;
			checkbox.addEventListener("click", (event) => {
				event.preventDefault();
				const select = selectedCount < folder.descendants.length;
				this.changeSelection.setSelected(folder.descendants.map((change) => change.path), select);
				this.render();
			});

			const key = `${section}\u0000${folder.path}`;
			const collapsed = this.collapsedChangeFolders.has(key);
			const toggle = row.createEl("button", {
				cls: "git-sync-folder-toggle",
				attr: {
					type: "button",
					"aria-label": `${collapsed ? "Expand" : "Collapse"} ${folder.path}`,
					"aria-expanded": String(!collapsed),
					title: `${collapsed ? "Expand" : "Collapse"} ${folder.name}`,
				},
			});
			setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
			toggle.addEventListener("click", () => {
				if (collapsed) this.collapsedChangeFolders.delete(key);
				else this.collapsedChangeFolders.add(key);
				this.render();
			});
			const icon = row.createSpan({ cls: "git-sync-folder-icon" });
			setIcon(icon, "folder");
			row.createSpan({ cls: "git-sync-folder-name", text: folder.name });
			row.createSpan({
				cls: "git-sync-folder-count",
				text: this.hasChangeFilter(section) ? `${folder.descendants.length} visible` : String(folder.descendants.length),
				attr: { "aria-label": `${folder.descendants.length} visible changed files` },
			});
			if (selectedCount > 0 && selectedCount < folder.descendants.length) {
				row.createSpan({
					cls: "git-sync-folder-selected-count",
					text: `${selectedCount}/${folder.descendants.length}`,
					attr: { title: `${selectedCount} of ${folder.descendants.length} visible files selected` },
				});
			}
			const folderMenu = row.createEl("button", {
				cls: "git-sync-change-menu git-sync-folder-menu",
				attr: {
					type: "button",
					"aria-label": `More actions for folder ${folder.path}`,
					title: "Folder actions",
				},
			});
			setIcon(folderMenu, "more-horizontal");
			folderMenu.disabled = this.committing || folderActionPending;
			folderMenu.addEventListener("click", (event) => this.showFolderMenu(folder, section, event));

			if (collapsed) return;
			const children = item.createEl("ul", { cls: "git-sync-change-tree-children" });
			for (const child of [...folder.folders.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))) {
				renderFolder(children, child);
			}
			for (const change of folder.files) {
				this.renderChangeRow(children, change, section, changeIndexes.get(change.path) ?? 0, changes);
			}
		};

		for (const folder of [...root.folders.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))) {
			renderFolder(list, folder);
		}
		for (const change of root.files) this.renderChangeRow(list, change, section, changeIndexes.get(change.path) ?? 0, changes);
	}

	private renderChangeRow(
		list: HTMLElement,
		change: ChangedFile,
		section: ChangeSection,
		index: number,
		visibleChanges: ChangedFile[],
	): void {
		const item = list.createEl("li", {
			cls: this.changeSelection.isSelected(change.path) ? "git-sync-change is-selected" : "git-sync-change",
			attr: { "data-change-path": change.path, "data-change-section": section },
		});
		const checkbox = item.createEl("input", {
			attr: { type: "checkbox", "aria-label": `Select ${change.path}`, "data-change-path": change.path },
		});
		checkbox.checked = this.changeSelection.isSelected(change.path);
		checkbox.disabled = this.committing;
		checkbox.addEventListener("click", (event) => {
			event.preventDefault();
			this.handleSelectionClick(section, change.path, event, visibleChanges);
		});

		const code = item.createSpan({ cls: "git-sync-change-code", text: changeCode(change.status) });
		code.setAttribute("data-change-status", change.status);
		const stagePending = this.pendingStagePaths.has(change.path);
		const fileActionPending = this.pendingFileActions.has(change.path);
		const directAction = item.createEl("button", {
			cls: `git-sync-change-direct-action ${change.staged ? "is-unstage" : "is-stage"}`,
			attr: {
				type: "button",
				"aria-label": stagePending ? `${change.staged ? "Unstaging" : "Staging"} ${change.path}` : `${change.staged ? "Unstage" : "Stage"} ${change.path}`,
				title: stagePending ? `${change.staged ? "Unstaging" : "Staging"}…` : change.staged ? "Unstage" : "Stage",
				"data-change-path": change.path,
			},
		});
		setIcon(directAction, change.staged ? "minus" : "plus");
		directAction.createSpan({
			text: stagePending ? `${change.staged ? "Unstaging" : "Staging"}…` : change.staged ? "Unstage" : "Stage",
		});
		directAction.disabled = this.committing || stagePending || fileActionPending;
		directAction.addEventListener("click", () => void this.toggleStage(change));
		const displayName = change.path.split("/").filter(Boolean).pop() ?? change.path;
		const path = item.createDiv({ cls: "git-sync-change-path", text: displayName });
		path.setAttribute("title", change.path);
		if (stagePending || fileActionPending) {
			path.createSpan({
				cls: "git-sync-change-activity",
				text: stagePending ? `${change.staged ? "Unstaging" : "Staging"}…` : "Updating…",
			});
		}
		const menuButton = item.createEl("button", {
			cls: "git-sync-change-menu",
			attr: {
				type: "button",
				"aria-label": `More actions for ${change.path}`,
				title: "More actions",
				"data-change-path": change.path,
			},
		});
		setIcon(menuButton, "more-horizontal");
		menuButton.disabled = this.committing || stagePending || fileActionPending;
		menuButton.addEventListener("click", (event) => this.showChangeMenu(change, event));
		this.bindLongPressSelection(item, section, change.path, visibleChanges, index);
	}

	private getVisibleChanges(section: ChangeSection, changes: ChangedFile[]): ChangedFile[] {
		const filters = this.changeFilters.get(section);
		const filtered = filters && filters.size > 0
			? changes.filter((change) => filters.has(changeFilterKey(change.status)))
			: [...changes];
		const sort = this.changeSorts.get(section) ?? "path-asc";
		return filtered.sort((left, right) => compareChanges(left, right, sort));
	}

	private hasChangeFilter(section: ChangeSection): boolean {
		const filters = this.changeFilters.get(section);
		return Boolean(filters && filters.size < CHANGE_STATUS_FILTERS.length);
	}

	private getChangeSortLabel(section: ChangeSection): string {
		return CHANGE_SORTS.find((sort) => sort.value === (this.changeSorts.get(section) ?? "path-asc"))?.label ?? "Path (A–Z)";
	}

	private showChangeFilterMenu(section: ChangeSection, event: MouseEvent): void {
		const menu = new Menu();
		const filters = this.changeFilters.get(section);
		menu.addItem((item) => item
			.setTitle("All status types")
			.setIcon("list")
			.setChecked(!filters || filters.size === 0)
			.onClick(() => {
				this.changeFilters.delete(section);
				this.render();
			}));
		for (const status of CHANGE_STATUS_FILTERS) {
			menu.addItem((item) => item
				.setTitle(`${changeCode(status)} ${status}`)
				.setChecked(!filters || filters.size === 0 || filters.has(status))
				.onClick(() => this.toggleChangeFilter(section, status)));
		}
		menu.showAtMouseEvent(event);
	}

	private toggleChangeFilter(section: ChangeSection, status: ChangeStatusFilter): void {
		const current = new Set(this.changeFilters.get(section) ?? CHANGE_STATUS_FILTERS);
		if (current.has(status)) current.delete(status);
		else current.add(status);
		if (current.size === 0 || current.size === CHANGE_STATUS_FILTERS.length) this.changeFilters.delete(section);
		else this.changeFilters.set(section, current);
		this.render();
	}

	private showChangeSortMenu(section: ChangeSection, event: MouseEvent): void {
		const current = this.changeSorts.get(section) ?? "path-asc";
		const menu = new Menu();
		for (const sort of CHANGE_SORTS) {
			menu.addItem((item) => item
				.setTitle(sort.label)
				.setChecked(current === sort.value)
				.onClick(() => {
					this.changeSorts.set(section, sort.value);
					this.render();
				}));
		}
		menu.showAtMouseEvent(event);
	}

	private handleSelectionClick(
		section: ChangeSection,
		path: string,
		event: MouseEvent,
		visibleChanges: ChangedFile[],
	): void {
		this.changeSelection.handleClick(section, path, event.shiftKey, visibleChanges);
		this.render();
	}

	private bindLongPressSelection(
		item: HTMLElement,
		section: ChangeSection,
		path: string,
		visibleChanges: ChangedFile[],
		_index: number,
	): void {
		item.addEventListener("pointerdown", (event) => {
			if (event.pointerType === "mouse" || (event.target instanceof HTMLElement && event.target.closest("button, input"))) return;
			this.cancelLongPressSelection();
			item.setPointerCapture?.(event.pointerId);
			const state: LongPressSelectionState = {
				section,
				path,
				visibleChanges,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				timer: 0,
				active: false,
				suppressClick: false,
			};
			state.timer = window.setTimeout(() => {
				if (this.longPressState !== state) return;
				state.active = true;
				state.suppressClick = true;
				this.changeSelection.beginRange(section, path);
				item.addClass("is-selected");
			}, 450);
			this.longPressState = state;
		});

		item.addEventListener("pointermove", (event) => {
			const state = this.longPressState;
			if (!state || state.pointerId !== event.pointerId) return;
			if (!state.active) {
				const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
				if (moved > 10) this.cancelLongPressSelection();
				return;
			}
			event.preventDefault();
			const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".git-sync-change");
			if (!target || target.dataset.changeSection !== section) return;
			const targetPath = target.dataset.changePath;
			if (!targetPath) return;
			this.changeSelection.selectRange(path, targetPath, visibleChanges);
			this.updateRenderedSelectionState(section);
		});

		const finish = (event: PointerEvent) => {
			const state = this.longPressState;
			if (!state || state.pointerId !== event.pointerId) return;
			window.clearTimeout(state.timer);
			item.releasePointerCapture?.(event.pointerId);
			this.longPressState = null;
			if (state.active) {
				this.updateRenderedSelectionState(section);
				this.render();
			}
		};
		item.addEventListener("pointerup", finish);
		item.addEventListener("pointercancel", finish);
		item.addEventListener("contextmenu", (event) => {
			if (this.longPressState?.active) event.preventDefault();
		});
	}

	private updateRenderedSelectionState(section: ChangeSection): void {
		for (const row of this.contentEl.querySelectorAll<HTMLElement>(`.git-sync-change[data-change-section="${section}"]`)) {
			const path = row.dataset.changePath;
			const selected = Boolean(path && this.changeSelection.isSelected(path));
			row.classList.toggle("is-selected", selected);
			const checkbox = row.querySelector<HTMLInputElement>("input[type=checkbox]");
			if (checkbox) checkbox.checked = selected;
		}
	}

	private cancelLongPressSelection(): void {
		if (this.longPressState) window.clearTimeout(this.longPressState.timer);
		this.longPressState = null;
	}

	private showChangeMenu(change: ChangedFile, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Open file").setIcon("file").onClick(() => this.openChangedFile(change.path)));
		menu.addItem((item) => item.setTitle("Copy path").setIcon("copy").onClick(() => void this.copyChangedPath(change.path)));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(change.staged ? "Unstage" : "Stage")
			.setIcon(change.staged ? "minus" : "plus")
			.onClick(() => void this.toggleStage(change)));
		menu.addItem((item) => item.setTitle("Add to gitignore").setIcon("file-minus").onClick(() => void this.ignoreChangedFile(change.path)));
		menu.addItem((item) => item
			.setTitle("Delete (git rm)")
			.setIcon("trash-2")
			.setWarning(true)
			.setDisabled(change.status === "Untracked")
			.onClick(() => this.confirmRemoveChangedFile(change)));
		menu.showAtMouseEvent(event);
	}

	private showFolderMenu(folder: ChangeTreeFolder, section: ChangeSection, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle("Copy folder path")
			.setIcon("copy")
			.onClick(() => void this.copyChangedPath(folder.path)));
		menu.addSeparator();
		const unstage = section === "staged";
		const stageable = folder.descendants.filter((change) => change.staged === unstage);
		menu.addItem((item) => item
			.setTitle(`${unstage ? "Unstage" : "Stage"} visible files in folder`)
			.setIcon(unstage ? "minus" : "plus")
			.setDisabled(this.committing || stageable.length === 0)
			.onClick(() => void this.applyFolderStage(section, folder)));
		if (!unstage && folder.descendants.some((change) => change.status === "Untracked")) {
			menu.addItem((item) => item
				.setTitle("Add folder to .gitignore")
				.setIcon("file-minus")
				.setDisabled(this.committing)
				.onClick(() => void this.ignoreChangedFolder(folder)));
		}
		menu.showAtMouseEvent(event);
	}

	private async ignoreChangedFolder(folder: ChangeTreeFolder): Promise<void> {
		const folderPrefix = `${folder.path}/`;
		const affectedPaths = (this.changes ?? [])
			.filter((change) => change.path.startsWith(folderPrefix))
			.map((change) => change.path);
		this.pendingFileActions.add(folder.path);
		this.updateChangesContent();
		try {
			await addToGitignore(this.app.vault.adapter, this.plugin.settings.repositoryPath, `${folder.path}/`);
			this.plugin.recordActivity(`Added ${folder.path}/ to .gitignore.`);
			new Notice(`Added ${folder.path}/ to .gitignore.`);
			await this.refreshChangesForPaths(
				[...affectedPaths, ".gitignore"],
				[...affectedPaths, ".gitignore"],
				"gitignore-folder-refresh",
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to add the folder to .gitignore.";
			this.plugin.recordActivity(`Could not update .gitignore: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.pendingFileActions.delete(folder.path);
			this.updateChangesContent();
		}
	}

	private async applyFolderStage(section: ChangeSection, folder: ChangeTreeFolder): Promise<void> {
		const unstage = section === "staged";
		const changes = folder.descendants.filter((change) => change.staged === unstage);
		if (changes.length === 0 || this.committing) return;

		const startedAt = Date.now();
		const action = `${unstage ? "Unstage" : "Stage"} folder ${folder.path}`;
		this.committing = true;
		this.activeChangeAction = action;
		this.render();
		let completed = false;
		try {
			if (unstage) {
				await unstageFiles(this.app.vault.adapter, this.plugin.settings.repositoryPath, changes.map((change) => change.path));
			} else {
				await stageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, changes.map((change) => change.path));
			}
			for (const change of changes) {
				this.changeSelection.deselect(change.path);
				this.plugin.recordActivity(`${unstage ? "Unstaged" : "Staged"} ${change.path}.`);
			}
			completed = true;
		} catch (error) {
			const detail = error instanceof Error ? error.message : `Unable to ${unstage ? "unstage" : "stage"} folder files.`;
			this.plugin.recordActivity(`Could not update ${folder.path}: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.committing = false;
			this.activeChangeAction = "";
			this.render();
		}
		if (completed) this.applyKnownStagingState(changes, !unstage);
		else this.markChangesRefreshRequired(`${unstage ? "unstage" : "stage"} folder`);
		this.plugin.recordActivity(`${action} completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))} (${changes.length} visible files).`, "METRIC");
	}

	private openChangedFile(path: string): void {
		this.app.workspace.openLinkText(this.vaultPathForChange(path), "", false);
	}

	private async copyChangedPath(path: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.vaultPathForChange(path));
			new Notice("Path copied.");
		} catch {
			new Notice("Unable to copy the path.");
		}
	}

	private async ignoreChangedFile(path: string): Promise<void> {
		this.pendingFileActions.add(path);
		this.updateChangesContent();
		try {
			await addToGitignore(this.app.vault.adapter, this.plugin.settings.repositoryPath, path);
			this.plugin.recordActivity(`Added ${path} to .gitignore.`);
			new Notice("Added to .gitignore.");
			await this.refreshChangesForPaths([path, ".gitignore"], [".gitignore"], "gitignore-refresh");
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update .gitignore.";
			this.plugin.recordActivity(`Could not update .gitignore: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.pendingFileActions.delete(path);
			this.updateChangesContent();
		}
	}

	private async editGitignore(): Promise<void> {
		const path = this.vaultPathForChange(".gitignore");
		try {
			const adapter = this.app.vault.adapter;
			const exists = await adapter.exists(path);
			const contents = exists ? await adapter.read(path) : "";
			new GitignoreEditorModal(this.app, contents, async (nextContents) => {
				await adapter.write(path, nextContents);
				invalidateRepositorySnapshot(this.plugin.settings.repositoryPath);
				await this.refreshRepositoryState("gitignore-edit");
				new Notice(".gitignore saved.");
			}).open();
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to open .gitignore.";
			new Notice(detail);
		}
	}

	private confirmRemoveChangedFile(change: ChangedFile): void {
		new ConfirmActionModal(
			this.app,
			"Delete changed file?",
			`This runs git rm for ${change.path} and stages the deletion.`,
			() => void this.removeChangedFile(change),
		).open();
	}

	private async removeChangedFile(change: ChangedFile): Promise<void> {
		this.pendingFileActions.add(change.path);
		this.updateChangesContent();
		try {
			await removeFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
			this.changeSelection.deselect(change.path);
			this.plugin.recordActivity(`Removed ${change.path} with git rm.`);
			new Notice("File removed with git rm.");
			this.applyKnownChangeUpdates([change.path], [{ path: change.path, status: "Deleted", staged: true }]);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to remove the file with git rm.";
			this.plugin.recordActivity(`Could not remove ${change.path}: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.pendingFileActions.delete(change.path);
			this.updateChangesContent();
		}
	}

	private vaultPathForChange(path: string): string {
		const repository = this.plugin.settings.repositoryPath.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
		return repository && repository !== "." ? `${repository}/${path}` : path;
	}

	private renderChangesActionBar(root: HTMLElement): HTMLElement {
		const bar = root.createDiv({ cls: "git-sync-bottom-bar" });
		const selectAll = bar.createEl("button", {
			cls: "git-sync-bottom-action is-primary",
			attr: { type: "button", "aria-label": "Select all changed files", title: "Select all" },
		});
		setIcon(selectAll, "check-square");
		selectAll.addEventListener("click", () => {
			this.selectAllChanges();
			this.render();
		});

		const pull = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Pull from remote", title: "Pull from remote" },
		});
		setIcon(pull, "arrow-down-to-line");
		pull.addEventListener("click", () => void this.plugin.pullRemote());

		const forcePull = bar.createEl("button", {
			cls: "git-sync-bottom-action is-destructive",
			attr: { type: "button", "aria-label": "Reset local branch to remote", title: "Reset local branch to remote" },
		});
		setIcon(forcePull, "arrow-down-to-line");
		forcePull.addEventListener("click", () => this.plugin.forcePullRemote());

		const push = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Push to remote", title: "Push to remote" },
		});
		setIcon(push, "arrow-up-to-line");
		push.addEventListener("click", () => void this.plugin.pushRemote());

		const forcePush = bar.createEl("button", {
			cls: "git-sync-bottom-action is-destructive",
			attr: { type: "button", "aria-label": "Force push to remote", title: "Force push to remote" },
		});
		setIcon(forcePush, "arrow-up-to-line");
		forcePush.addEventListener("click", () => this.plugin.forcePushRemote());

		const refresh = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Fetch from remote", title: "Fetch from remote" },
		});
		setIcon(refresh, "refresh-cw");
		refresh.addEventListener("click", () => void this.plugin.fetchRemote());

		const editIgnore = bar.createEl("button", {
			cls: "git-sync-bottom-action",
			attr: { type: "button", "aria-label": "Edit .gitignore", title: "Edit .gitignore" },
		});
		setIcon(editIgnore, "file-text");
		editIgnore.addEventListener("click", () => void this.editGitignore());
		const repositoryReady = this.repositoryState?.kind === "ready";
		for (const action of Array.from(bar.querySelectorAll<HTMLButtonElement>("button"))) {
			action.disabled = !repositoryReady;
		}
		selectAll.disabled = !repositoryReady || !this.changes?.length;
		return bar;
	}

	private selectAllChanges(): void {
		this.changeSelection.selectAll(this.changes ?? []);
	}

	private async applyAllStage(unstage: boolean): Promise<void> {
		const changes = (this.changes ?? []).filter((change) => change.staged === unstage);
		if (changes.length === 0) return;

		const startedAt = Date.now();
		const action = unstage ? "Unstage all" : "Stage all";
		this.committing = true;
		this.activeChangeAction = action;
		this.render();
		let completed = false;
		try {
			if (unstage) {
				await unstageFiles(this.app.vault.adapter, this.plugin.settings.repositoryPath, changes.map((change) => change.path));
			} else {
				await stageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, changes.map((change) => change.path));
			}
			for (const change of changes) {
				this.changeSelection.deselect(change.path);
				this.plugin.recordActivity(`${unstage ? "Unstaged" : "Staged"} ${change.path}.`);
			}
			completed = true;
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update all changed files.";
			this.plugin.recordActivity(`Could not update all changed files: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.committing = false;
			this.activeChangeAction = "";
			this.render();
		}
		if (completed) this.applyKnownStagingState(changes, !unstage);
		else this.markChangesRefreshRequired(unstage ? "unstage all" : "stage all");
		this.plugin.recordActivity(`${action} completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))} (${changes.length} files).`, "METRIC");
	}

	private async applySelectedStage(section: ChangeSection, visibleChanges: ChangedFile[]): Promise<void> {
		const unstage = section === "staged";
		const selected = visibleChanges.filter((change) =>
			this.changeSelection.isSelected(change.path) && change.staged === unstage,
		);
		if (selected.length === 0) return;

		const startedAt = Date.now();
		const action = unstage ? "Unstage selected" : "Stage selected";
		this.committing = true;
		this.activeChangeAction = action;
		this.render();
		let completed = false;
		try {
			if (unstage) {
				await unstageFiles(this.app.vault.adapter, this.plugin.settings.repositoryPath, selected.map((change) => change.path));
			} else {
				await stageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, selected.map((change) => change.path));
			}
			for (const change of selected) {
				this.plugin.recordActivity(`${unstage ? "Unstaged" : "Staged"} ${change.path}.`);
				this.changeSelection.deselect(change.path);
			}
			completed = true;
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update selected files.";
			this.plugin.recordActivity(`Could not update selected files: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.committing = false;
			this.activeChangeAction = "";
			this.render();
		}
		if (completed) this.applyKnownStagingState(selected, !unstage);
		else this.markChangesRefreshRequired(unstage ? "unstage selected" : "stage selected");
		this.plugin.recordActivity(`${action} completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))} (${selected.length} files).`, "METRIC");
	}

	private async toggleStage(change: ChangedFile): Promise<void> {
		const startedAt = Date.now();
		const action = change.staged ? "Unstage" : "Stage";
		this.pendingStagePaths.add(change.path);
		this.updateChangesContent();
		try {
			if (change.staged) {
				await unstageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
				this.plugin.recordActivity(`Unstaged ${change.path}.`);
			} else {
				await stageFile(this.app.vault.adapter, this.plugin.settings.repositoryPath, change.path);
				this.plugin.recordActivity(`Staged ${change.path}.`);
			}
			this.applyKnownStagingState([change], !change.staged);
			this.plugin.recordActivity(`${action} ${change.path} completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`, "METRIC");
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to update staging.";
			this.plugin.recordActivity(`Could not update ${change.path} after ${formatMilliseconds(elapsedMilliseconds(startedAt))}: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.pendingStagePaths.delete(change.path);
			this.updateChangesContent();
		}
	}

	private applyKnownStagingState(changes: ChangedFile[], staged: boolean): void {
		this.changes = applyStagingToSnapshot(this.changes, changes, staged);
		this.changesError = null;
		this.updateChangesContent();
	}

	private async commit(message: string): Promise<void> {
		const trimmedMessage = message.trim();
		if (!trimmedMessage) {
			new Notice("Enter a commit message.");
			return;
		}
		const authorName = this.plugin.settings.authorName.trim();
		const authorEmail = this.plugin.settings.authorEmail.trim();
		if (!authorName || !authorEmail) {
			new Notice("Enter your commit name and email in Git Sync settings.");
			this.openSettings();
			return;
		}
		const stagedPaths = (this.changes ?? [])
			.filter((change) => change.staged)
			.map((change) => change.path);
		this.committing = true;
		this.render();
		try {
			const oid = await commitChanges(this.app.vault.adapter, this.plugin.settings.repositoryPath, trimmedMessage, {
				name: authorName,
				email: authorEmail,
			});
			this.plugin.recordActivity(`Committed ${oid.slice(0, 7)}: ${trimmedMessage}`);
			this.commitMessage = "";
			new Notice("Commit created.");
			await this.refreshAfterCommit(oid, stagedPaths);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "Unable to create the commit.";
			this.plugin.recordActivity(`Commit failed: ${detail}`, "ERROR");
			new Notice(detail);
		} finally {
			this.committing = false;
			this.render();
		}
	}

	private async refreshAfterCommit(commitOid: string, committedPaths: string[]): Promise<void> {
		const startedAt = Date.now();
		this.applyKnownChangeUpdates(committedPaths, []);
		if (this.repositoryState?.kind === "ready") {
			this.repositoryState = { ...this.repositoryState, head: commitOid };
		}

		try {
			const history = await readCommits(
				this.app.vault.adapter,
				this.plugin.settings.repositoryPath,
				this.commitDepth.get("local") ?? COMMIT_PAGE_SIZE,
			);
			this.commits = this.hydrateCommitChanges(history.commits, this.plugin.settings.repositoryPath);
			this.commitHasMore.set("local", history.hasMore);
			this.commitsError = null;
		} catch (error) {
			this.commitsError = error instanceof Error ? error.message : "Unable to read local commits.";
		}

		this.render();
		this.plugin.recordActivity(
			`Commit refresh completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))} without a full Changes scan.`,
			"METRIC",
		);
	}

	async refreshRemoteHistory(reason = "remote-history-refresh"): Promise<void> {
		const startedAt = Date.now();
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (!repositoryPath || this.repositoryState?.kind !== "ready") {
			this.markChangesRefreshRequired(reason);
			return;
		}

		const generation = ++this.refreshGeneration;
		this.remoteHistoryLoading = true;
		if (this.commitSource === "remote") this.render();
		try {
			const history = await readRemoteCommits(
				this.app.vault.adapter,
				repositoryPath,
				this.plugin.settings.branchName,
				this.commitDepth.get("remote") ?? COMMIT_PAGE_SIZE,
			);
			if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
			this.remoteCommits = this.hydrateCommitChanges(history.commits, repositoryPath);
			this.remoteHistoryAvailable = history.available;
			this.commitHasMore.set("remote", history.hasMore);
			this.remoteCommitsError = null;
		} catch (error) {
			if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
			this.remoteCommits = null;
			this.remoteHistoryAvailable = false;
			this.commitHasMore.set("remote", false);
			this.remoteCommitsError = error instanceof Error ? error.message : "Unable to read remote commits.";
		} finally {
			this.remoteHistoryLoading = false;
		}

		this.plugin.recordActivity(
			`Remote history refresh [${reason}] completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`,
			"METRIC",
		);
		if (this.activeTab === "Changes" && this.changesContentEl?.isConnected) {
			this.renderRepositoryContext(this.contentEl, repositoryPath);
			this.updateChangesContent();
		} else {
			this.render();
		}
	}

	markChangesRefreshRequired(reason: string): void {
		this.changesRefreshRequired = true;
		this.changesRefreshReason = reason;
		this.changes = null;
		this.changesError = null;
		this.changeSelection.clear();
		this.render();
	}

	async refreshIntegrationStage(paths: string[]): Promise<void> {
		const affectedPaths = [...new Set(paths)];
		if (affectedPaths.length === 0) return;
		if (this.repositoryRefreshInProgress) {
			for (const path of affectedPaths) this.pendingIntegrationStagePaths.add(path);
			return;
		}
		if (this.repositoryState?.kind !== "ready") {
			if (!this.repositoryState) {
				for (const path of affectedPaths) this.pendingIntegrationStagePaths.add(path);
				void this.refreshRepositoryState("integration-stage");
			} else {
				this.markChangesRefreshRequired("integration-stage");
			}
			return;
		}
		if (!this.changes || this.changesRefreshRequired) {
			await this.refreshChangesSnapshot("integration-stage");
			return;
		}

		const generation = ++this.refreshGeneration;
		const affected = new Set(affectedPaths);
		const knownChanges = this.changes.filter((change) => affected.has(change.path));
		const knownPaths = new Set(knownChanges.map((change) => change.path));
		const unknownPaths = affectedPaths.filter((path) => !knownPaths.has(path));
		if (knownChanges.length > 0) this.applyKnownStagingState(knownChanges, true);
		if (unknownPaths.length > 0) {
			await this.refreshChangesForPaths(unknownPaths, unknownPaths, "integration-stage", generation);
		}
		this.plugin.recordActivity(
			`Changes updated after integration staging for ${affectedPaths.length} path${affectedPaths.length === 1 ? "" : "s"} (${knownChanges.length} updated locally, ${unknownPaths.length} checked by path).`,
			"METRIC",
		);
	}

	private async refreshChangesSnapshot(reason: string): Promise<void> {
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (!repositoryPath) {
			this.markChangesRefreshRequired(reason);
			return;
		}
		const generation = ++this.refreshGeneration;
		const startedAt = Date.now();
		this.repositoryRefreshInProgress = true;
		try {
			const changes = await readChanges(this.app.vault.adapter, repositoryPath);
			if (generation !== this.refreshGeneration || !this.contentEl.isConnected) return;
			this.changes = changes;
			this.changesRefreshRequired = false;
			this.changesRefreshReason = "";
			this.changesError = null;
			const availablePaths = new Set(changes.map((change) => change.path));
			this.changeSelection.retainAvailablePaths(availablePaths);
		} catch (error) {
			if (generation !== this.refreshGeneration) return;
			this.changes = null;
			this.changesError = error instanceof Error ? error.message : "Unable to read local changes.";
		} finally {
			if (generation === this.refreshGeneration) {
				this.repositoryRefreshInProgress = false;
				this.updateChangesContent();
				this.plugin.recordActivity(
					`Changes refresh [${reason}] completed in ${formatMilliseconds(elapsedMilliseconds(startedAt))} (${this.changes?.length ?? 0} changes).`,
					"METRIC",
				);
				this.flushPendingIntegrationStagePaths();
			}
		}
	}

	private flushPendingIntegrationStagePaths(): void {
		if (this.pendingIntegrationStagePaths.size === 0) return;
		const paths = [...this.pendingIntegrationStagePaths];
		this.pendingIntegrationStagePaths.clear();
		void this.refreshIntegrationStage(paths);
	}

	private async refreshChangesForPaths(
		affectedPaths: string[],
		filepaths: string[],
		reason: string,
		generation = this.refreshGeneration,
	): Promise<void> {
		const startedAt = Date.now();
		const repositoryPath = this.plugin.settings.repositoryPath.trim();
		if (!repositoryPath || this.repositoryState?.kind !== "ready") {
			this.markChangesRefreshRequired(reason);
			return;
		}

		try {
			const updates = await readChanges(this.app.vault.adapter, repositoryPath, filepaths);
			if (generation !== this.refreshGeneration) return;
			this.applyKnownChangeUpdates(affectedPaths, updates);
			this.plugin.recordActivity(
				`Changes refresh [${reason}] completed for ${filepaths.length} path${filepaths.length === 1 ? "" : "s"} in ${formatMilliseconds(elapsedMilliseconds(startedAt))}.`,
				"METRIC",
			);
		} catch {
			if (generation === this.refreshGeneration) this.markChangesRefreshRequired(reason);
		}
	}

	private applyKnownChangeUpdates(affectedPaths: string[], updates: ChangedFile[]): void {
		this.changes = replaceChangedPaths(this.changes, affectedPaths, updates);
		this.changesError = null;
		const availablePaths = new Set(this.changes.map((change) => change.path));
		this.changeSelection.retainAvailablePaths(availablePaths);
		this.updateChangesContent();
	}

	private updateChangesContent(): void {
		const content = this.changesContentEl;
		if (!content || !content.isConnected || this.activeTab !== "Changes") {
			this.render();
			return;
		}

		this.captureChangesScrollTop();
		const activeElement = content.ownerDocument.activeElement;
		const focusedPath = activeElement instanceof HTMLElement
			? activeElement.getAttribute("data-change-path")
			: null;
		const focusedTextarea = activeElement instanceof HTMLTextAreaElement && content.contains(activeElement);
		const textareaSelection = focusedTextarea && activeElement instanceof HTMLTextAreaElement
			? { start: activeElement.selectionStart, end: activeElement.selectionEnd }
			: null;

		content.empty();
		this.renderChanges(content);
		this.restoreChangesScrollTop(content);

		if (focusedTextarea) {
			const textarea = content.querySelector<HTMLTextAreaElement>(".git-sync-commit textarea");
			if (textarea) {
				textarea.focus();
				if (textareaSelection) textarea.setSelectionRange(textareaSelection.start, textareaSelection.end);
			}
		} else if (focusedPath) {
			const focusedControl = Array.from(content.querySelectorAll<HTMLElement>("[data-change-path]"))
				.find((element) => element.getAttribute("data-change-path") === focusedPath);
			focusedControl?.focus();
		}
	}

	private captureChangesScrollTop(): void {
		if (this.changesContentEl?.isConnected) this.changesScrollTop = this.changesContentEl.scrollTop;
	}

	private restoreChangesScrollTop(content: HTMLElement): void {
		content.scrollTop = this.changesScrollTop;
		window.requestAnimationFrame(() => {
			if (content.isConnected) content.scrollTop = this.changesScrollTop;
		});
	}

	private recordRepositoryActivity(state: RepositoryState): void {
		const message = repositoryActivityMessage(state);
		if (message === this.lastRepositoryActivity) return;
		this.lastRepositoryActivity = message;
		this.plugin.recordActivity(message);
	}

	private renderActivity(content: HTMLElement): void {
		renderActivityPanel(
			content,
			this.plugin.getActivity(),
			this.activityVisibleCount,
			() => {
				this.activityVisibleCount += ACTIVITY_PAGE_SIZE;
				this.render();
			},
		);
	}

	private renderSettingsPrompt(content: HTMLElement, title: string): void {
		content.createDiv({ cls: "git-sync-state-title", text: title });
		content.createEl("p", {
			text: "Choose a vault-relative repository path in Settings to start using Git Sync.",
			cls: "git-sync-state-description",
		});
		const settingsButton = content.createEl("button", {
			text: "Open Settings",
			cls: "mod-cta",
			attr: { type: "button" },
		});
		settingsButton.addEventListener("click", () => this.openSettings());
	}

	private addRefreshButton(content: HTMLElement): void {
		const refreshButton = content.createEl("button", {
			text: this.repositoryRefreshInProgress ? "Refreshing repository…" : "Refresh repository",
			cls: "",
			attr: { type: "button", "aria-busy": String(this.repositoryRefreshInProgress) },
		});
		refreshButton.disabled = this.repositoryRefreshInProgress;
		refreshButton.addEventListener("click", () => void this.refreshRepositoryState());
	}

	private openSettings(): void {
		const settings = (this.app as App & {
			setting: { open: () => void; openTabById: (id: string) => void };
		}).setting;
		settings.open();
		settings.openTabById(this.plugin.manifest.id);
	}
}




function repositoryActivityMessage(state: RepositoryState): string {
	switch (state.kind) {
		case "missing":
			return `No Git repository found at ${state.repositoryPath}.`;
		case "ready":
			return `Read local repository on ${state.branch}.`;
		case "error":
			return `Could not read repository: ${state.message}`;
		case "checking":
			return `Checking repository at ${state.repositoryPath}.`;
	}
}


function changeFilterKey(status: string): ChangeStatusFilter {
	if (status === "Untracked") return "Untracked";
	if (status.startsWith("Added")) return "Added";
	if (status.includes("Deleted")) return "Deleted";
	return "Modified";
}

function compareChanges(left: ChangedFile, right: ChangedFile, sort: ChangeSort): number {
	const pathCompare = left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
	if (sort === "path-desc") return -pathCompare;
	if (sort === "status-path") {
		const statusCompare = changeFilterKey(left.status).localeCompare(changeFilterKey(right.status));
		return statusCompare || pathCompare;
	}
	if (sort === "folder-name") {
		const leftParts = left.path.split("/");
		const rightParts = right.path.split("/");
		const folderCompare = leftParts.slice(0, -1).join("/").localeCompare(rightParts.slice(0, -1).join("/"), undefined, { sensitivity: "base" });
		return folderCompare || leftParts[leftParts.length - 1].localeCompare(rightParts[rightParts.length - 1], undefined, { sensitivity: "base" });
	}
	return pathCompare;
}

function changeCode(status: string): string {
	switch (status) {
		case "Untracked":
			return "?";
		case "Added":
			return "A";
		case "Deleted":
		case "Added, deleted":
			return "D";
		default:
			return "M";
	}
}
