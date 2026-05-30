import { ItemView, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_GITSYNC = 'git-sync-view';

export class GitSyncView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: any) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_GITSYNC;
	}

	getDisplayText() {
		return 'Git Sync';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl('h4', { text: 'Git Sync (Test Mode)' });
		container.createEl('p', { text: 'Use command palette: "Test isomorphic-git"' });
	}

	async onClose() {
		return;
	}
}
