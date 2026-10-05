import { setIcon } from "obsidian";
import type { LocalCommit } from "./repository";
import { formatCommitTimestamp, formatRelativeCommitTime } from "./dateFormatting";

export type CommitSource = "local" | "remote";

export interface CommitHistoryPanelState {
	source: CommitSource;
	commits: LocalCommit[] | null;
	remoteCommits: LocalCommit[] | null;
	remoteHistoryAvailable: boolean;
	remoteHistoryLoading: boolean;
	commitsError: string | null;
	remoteCommitsError: string | null;
	branchName: string;
	selectedCommitOid: string | null;
	commitChangesErrors: ReadonlyMap<string, string>;
	repositoryPath: string;
	commitHasMore: boolean;
	commitHistoryLoading: boolean;
	repositoryRefreshInProgress: boolean;
}

export interface CommitHistoryPanelActions {
	setSource(source: CommitSource): void;
	selectCommit(oid: string | null): void;
	loadMore(): void;
	loadCommitChanges(oid: string): void;
	refreshRepository(): void;
}

export function renderCommitHistoryPanel(
	content: HTMLElement,
	state: CommitHistoryPanelState,
	actions: CommitHistoryPanelActions,
): void {
	const commits = state.source === "local" ? state.commits : state.remoteCommits;
	const sourceLabel = state.source === "local" ? "local" : "remote";
	const header = content.createDiv({ cls: "git-sync-commits-header" });
	header.createDiv({ cls: "git-sync-state-title", text: "Commits" });
	header.createDiv({
		cls: "git-sync-commits-count",
		text: commits ? `${commits.length} ${sourceLabel} commit${commits.length === 1 ? "" : "s"}` : `${sourceLabel} history`,
	});

	const sourceToggle = content.createDiv({ cls: "git-sync-source-toggle", attr: { role: "tablist" } });
	for (const source of ["local", "remote"] as const) {
		const button = sourceToggle.createEl("button", {
			text: source === "local" ? "Local" : "Remote",
			cls: source === state.source ? "is-active" : "",
			attr: {
				type: "button",
				role: "tab",
				"aria-selected": String(source === state.source),
			},
		});
		button.addEventListener("click", () => actions.setSource(source));
	}

	if (state.source === "remote" && state.remoteCommitsError) {
		content.createEl("p", { text: state.remoteCommitsError, cls: "git-sync-state-description" });
		addRefreshButton(content, state.repositoryRefreshInProgress, actions.refreshRepository);
		return;
	}
	if (state.source === "remote" && !state.remoteCommits) {
		content.createEl("p", {
			text: "Reading remote commit history…",
			cls: "git-sync-state-description",
			attr: { "aria-busy": "true" },
		});
		renderCommitLoadingPlaceholder(content);
		return;
	}
	if (state.source === "remote" && state.remoteHistoryLoading) {
		content.createEl("p", {
			text: "Refreshing remote history…",
			cls: "git-sync-state-description",
			attr: { "aria-busy": "true" },
		});
	}
	if (state.source === "remote" && !state.remoteHistoryAvailable) {
		const unavailable = content.createDiv({ cls: "git-sync-history-unavailable" });
		const icon = unavailable.createSpan({ cls: "git-sync-history-unavailable-icon" });
		setIcon(icon, "cloud-off");
		unavailable.createDiv({ cls: "git-sync-state-title", text: "No fetched remote history" });
		unavailable.createEl("p", {
			text: `Fetch origin/${state.branchName} to load the remote commit history here.`,
			cls: "git-sync-state-description",
		});
		return;
	}

	if (state.commitsError) {
		content.createEl("p", { text: state.commitsError, cls: "git-sync-state-description" });
		addRefreshButton(content, state.repositoryRefreshInProgress, actions.refreshRepository);
		return;
	}
	if (!state.commits) {
		content.createEl("p", {
			text: "Reading local commit history…",
			cls: "git-sync-state-description",
			attr: { "aria-busy": "true" },
		});
		renderCommitLoadingPlaceholder(content);
		return;
	}
	if (commits!.length === 0) {
		content.createDiv({
			cls: "git-sync-history-empty",
			text: state.source === "local" ? "No local commits yet." : "No commits on the fetched remote branch.",
		});
		return;
	}

	renderCommitList(content, commits!, state.source === "local" ? "LOCAL" : "ORIGIN", state, actions);
	if (state.commitHasMore) {
		const loadMore = content.createEl("button", {
			text: state.commitHistoryLoading ? "Loading commits…" : "Load more commits",
			cls: "git-sync-load-more",
			attr: { type: "button", "aria-busy": String(state.commitHistoryLoading) },
		});
		loadMore.disabled = state.commitHistoryLoading;
		loadMore.addEventListener("click", actions.loadMore);
	}
}

function addRefreshButton(content: HTMLElement, refreshing: boolean, onRefresh: () => void): void {
	const refreshButton = content.createEl("button", {
		text: refreshing ? "Refreshing repository…" : "Refresh repository",
		cls: "",
		attr: { type: "button", "aria-busy": String(refreshing) },
	});
	refreshButton.disabled = refreshing;
	refreshButton.addEventListener("click", onRefresh);
}

function renderCommitLoadingPlaceholder(content: HTMLElement): void {
	const list = content.createDiv({ cls: "git-sync-commit-loading-list", attr: { "aria-hidden": "true" } });
	for (let index = 0; index < 4; index += 1) {
		const row = list.createDiv({ cls: "git-sync-commit-loading-row" });
		row.createSpan({ cls: "git-sync-loading-line is-commit-title" });
		row.createSpan({ cls: "git-sync-loading-line is-commit-meta" });
	}
}

function renderCommitList(
	content: HTMLElement,
	commits: LocalCommit[],
	badge: "LOCAL" | "ORIGIN",
	state: CommitHistoryPanelState,
	actions: CommitHistoryPanelActions,
): void {
	const list = content.createEl("ol", { cls: "git-sync-commit-list" });
	for (const commit of commits) {
		const item = list.createEl("li", { cls: "git-sync-commit-item" });
		const selected = state.selectedCommitOid === commit.oid;
		const button = item.createEl("button", {
			cls: selected ? "git-sync-commit-row is-selected" : "git-sync-commit-row",
			attr: {
				type: "button",
				"aria-expanded": String(selected),
				"aria-label": `${selected ? "Hide" : "Show"} details for ${commitTitle(commit.message)}`,
			},
		});
		const marker = button.createSpan({ cls: "git-sync-commit-marker" });
		marker.setAttribute("aria-hidden", "true");
		const summary = button.createDiv({ cls: "git-sync-commit-summary" });
		const title = summary.createDiv({ cls: "git-sync-commit-message", text: commitTitle(commit.message) });
		title.setAttribute("title", commit.message);
		const meta = summary.createDiv({ cls: "git-sync-commit-meta" });
		meta.createSpan({ cls: "git-sync-commit-oid", text: commit.oid.slice(0, 7) });
		meta.createSpan({ text: commit.author.name || "Unknown author" });
		meta.createSpan({ cls: badge === "ORIGIN" ? "git-sync-commit-origin-badge" : "git-sync-commit-local-badge", text: badge });
		const time = button.createSpan({ cls: "git-sync-commit-time", text: formatRelativeCommitTime(commit.author.timestamp) });
		time.setAttribute("title", formatCommitTimestamp(commit.author.timestamp));
		const chevron = button.createSpan({ cls: "git-sync-commit-chevron" });
		setIcon(chevron, selected ? "chevron-down" : "chevron-right");
		button.addEventListener("click", () => actions.selectCommit(selected ? null : commit.oid));

		if (selected) renderCommitDetails(item, commit, state, actions);
	}
}

function renderCommitDetails(
	item: HTMLElement,
	commit: LocalCommit,
	state: CommitHistoryPanelState,
	actions: CommitHistoryPanelActions,
): void {
	const details = item.createDiv({ cls: "git-sync-commit-details" });
	details.createDiv({ cls: "git-sync-commit-detail-message", text: commit.message.trim() });
	const author = details.createDiv({ cls: "git-sync-commit-detail-meta" });
	author.createSpan({ text: `${commit.author.name || "Unknown author"} <${commit.author.email}>` });
	author.createSpan({ text: formatCommitTimestamp(commit.author.timestamp) });
	details.createDiv({ cls: "git-sync-commit-detail-hash", text: commit.oid });

	const cacheKey = `${state.repositoryPath}\u0000${commit.oid}`;
	const loadingError = state.commitChangesErrors.get(cacheKey);
	if (!commit.changesLoaded) {
		details.createDiv({ cls: "git-sync-commit-files-title", text: "Changed files" });
		details.createDiv({
			cls: loadingError ? "git-sync-commit-files-error" : "git-sync-commit-files-loading",
			text: loadingError ? `Unable to load changed files: ${loadingError}` : "Loading changed files…",
		});
		actions.loadCommitChanges(commit.oid);
		return;
	}

	const filesTitle = details.createDiv({ cls: "git-sync-commit-files-title", text: `Changed files (${commit.changes.length})` });
	if (commit.changes.length === 0) {
		details.createDiv({ cls: "git-sync-commit-files-empty", text: "No changed files recorded." });
		return;
	}
	const files = details.createEl("ul", { cls: "git-sync-commit-files" });
	for (const file of commit.changes) {
		const row = files.createEl("li");
		const status = row.createSpan({ cls: "git-sync-commit-file-status", text: commitFileCode(file.status) });
		status.setAttribute("data-commit-file-status", file.status);
		row.createSpan({ cls: "git-sync-commit-file-path", text: file.path });
	}
	filesTitle.setAttribute("aria-hidden", "true");
}

function commitTitle(message: string): string {
	return message.split("\n", 1)[0].trim() || "(no commit message)";
}

function commitFileCode(status: "Added" | "Modified" | "Deleted"): string {
	switch (status) {
		case "Added":
			return "A";
		case "Deleted":
			return "D";
		default:
			return "M";
	}
}
