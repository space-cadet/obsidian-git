import type { ActivityEntry } from "./pluginData";
import { formatLogTimestamp } from "./dateFormatting";

export function renderActivityPanel(
	content: HTMLElement,
	entries: readonly ActivityEntry[],
	visibleCount: number,
	onLoadMore: () => void,
): void {
	if (entries.length === 0) {
		content.createEl("p", {
			text: "No log entries recorded yet.",
			cls: "git-sync-state-description",
		});
		return;
	}

	const list = content.createDiv({ cls: "git-sync-log-list" });
	for (const entry of entries.slice(0, visibleCount)) {
		const item = list.createDiv({ cls: "git-sync-log-entry" });
		item.createDiv({ text: formatLogTimestamp(entry.timestamp), cls: "git-sync-log-time" });
		const level = item.createDiv({ text: entry.level, cls: "git-sync-log-level" });
		level.setAttribute("data-log-level", entry.level);
		item.createDiv({ text: entry.message, cls: "git-sync-log-message" });
	}
	if (visibleCount < entries.length) {
		const loadMore = content.createEl("button", {
			text: "Load more messages",
			cls: "git-sync-load-more",
			attr: { type: "button" },
		});
		loadMore.addEventListener("click", onLoadMore);
	}
}
