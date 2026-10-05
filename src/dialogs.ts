import { App, Modal, Notice, setIcon } from "obsidian";
import type { RemoteOperationResult, RemoteProgressEvent } from "./remote";

export class ConfirmActionModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly description: string,
		private readonly onConfirm: () => void,
		private readonly confirmLabel = "Delete",
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: this.title });
		this.contentEl.createEl("p", { text: this.description });
		const actions = this.contentEl.createDiv({ cls: "git-sync-confirm-actions" });
		const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
		cancel.addEventListener("click", () => this.close());
		const confirm = actions.createEl("button", { text: this.confirmLabel, cls: "mod-warning", attr: { type: "button" } });
		confirm.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}
}

export class GitignoreEditorModal extends Modal {
	constructor(
		app: App,
		private readonly initialContents: string,
		private readonly onSave: (contents: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Edit .gitignore" });
		this.contentEl.createEl("p", {
			text: "Add one ignore rule per line. Tracked files can still appear in Changes.",
			cls: "setting-item-description",
		});
		const editor = this.contentEl.createEl("textarea", {
			cls: "git-sync-gitignore-editor",
			attr: { "aria-label": ".gitignore rules", spellcheck: "false" },
		});
		editor.value = this.initialContents;
		const actions = this.contentEl.createDiv({ cls: "git-sync-confirm-actions" });
		const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
		cancel.addEventListener("click", () => this.close());
		const save = actions.createEl("button", { text: "Save", cls: "mod-cta", attr: { type: "button" } });
		save.addEventListener("click", () => {
			void (async () => {
				save.disabled = true;
				save.setText("Saving…");
				try {
					await this.onSave(editor.value);
					this.close();
				} catch (error) {
					save.disabled = false;
					save.setText("Save");
					new Notice(error instanceof Error ? error.message : "Unable to save .gitignore.");
				}
			})();
		});
	}
}



interface GitProgressModalCallbacks {
	onPhase?: (phase: string) => void;
	onMessage?: (message: string) => void;
}

export class GitProgressModal extends Modal {
	private readonly remoteMessages: string[] = [];
	private phaseEl: HTMLElement | null = null;
	private phaseIconEl: HTMLElement | null = null;
	private percentEl: HTMLElement | null = null;
	private progressEl: HTMLProgressElement | null = null;
	private countEl: HTMLElement | null = null;
	private remoteMessagesEl: HTMLElement | null = null;
	private detailsEl: HTMLElement | null = null;
	private resultEl: HTMLElement | null = null;
	private closeButton: HTMLButtonElement | null = null;
	private lastPhase = "";
	private pendingPhase: string | null = null;
	private pendingProgress: RemoteProgressEvent | null = null;
	private pendingMessages: string[] = [];
	private pendingFinish: { state: "Completed" | "Failed"; result: RemoteOperationResult; icon: string; className: string } | null = null;

	constructor(
		app: App,
		private readonly operation: string,
		private readonly branch: string,
		private readonly callbacks: GitProgressModalCallbacks = {},
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("git-sync-progress-modal");
		this.contentEl.empty();
		this.contentEl.addClass("git-sync-progress-content");

		this.contentEl.createDiv({ cls: "git-sync-progress-kicker", text: operationKicker(this.operation) });
		const heading = this.contentEl.createDiv({ cls: "git-sync-progress-heading" });
		heading.createEl("h2", { text: `${this.operation} origin/${this.branch}` });
		const phase = this.contentEl.createDiv({ cls: "git-sync-progress-phase" });
		this.phaseIconEl = phase.createSpan({ cls: "git-sync-progress-icon" });
		setIcon(this.phaseIconEl, "git-branch");
		this.phaseEl = phase.createSpan({ text: "Starting operation…" });
		this.percentEl = phase.createSpan({ cls: "git-sync-progress-percent" });

		this.progressEl = this.contentEl.createEl("progress", {
			cls: "git-sync-progress-bar",
			attr: { max: "100", value: "0", "aria-label": `${this.operation} progress` },
		});
		this.progressEl.hidden = true;
		this.countEl = this.contentEl.createDiv({ cls: "git-sync-progress-count" });

		this.remoteMessagesEl = this.contentEl.createDiv({ cls: "git-sync-progress-messages" });
		this.remoteMessagesEl.hidden = true;
		this.detailsEl = this.contentEl.createDiv({ cls: "git-sync-progress-details" });
		this.detailsEl.hidden = true;
		this.resultEl = this.contentEl.createDiv({ cls: "git-sync-progress-result" });

		const footer = this.contentEl.createDiv({ cls: "git-sync-progress-footer" });
		this.closeButton = footer.createEl("button", {
			text: "Close",
			attr: { type: "button", "aria-label": "Close Git operation progress" },
		});
		this.closeButton.disabled = true;
		this.closeButton.addEventListener("click", () => this.close());

		if (this.pendingPhase) this.setPhase(this.pendingPhase);
		if (this.pendingProgress) this.renderProgress(this.pendingProgress);
		for (const message of this.pendingMessages) this.renderRemoteMessage(message);
		this.pendingProgress = null;
		this.pendingMessages = [];
		if (this.pendingFinish) {
			const finish = this.pendingFinish;
			this.pendingFinish = null;
			this.finish(finish.state, finish.result, finish.icon, finish.className);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	setPhase(phase: string): void {
		const normalized = phase.trim() || "Working…";
		this.lastPhase = normalized;
		if (!this.phaseEl) {
			this.pendingPhase = normalized;
			return;
		}
		this.phaseEl.setText(normalized);
	}

	updateProgress(event: RemoteProgressEvent): void {
		const phase = event.phase.trim() || "Working…";
		if (phase !== this.lastPhase) {
			this.lastPhase = phase;
			this.callbacks.onPhase?.(phase);
		}
		if (!this.phaseEl || !this.progressEl || !this.percentEl || !this.countEl) {
			this.pendingProgress = { ...event, phase };
			return;
		}
		this.renderProgress({ ...event, phase });
	}

	addRemoteMessage(message: string): void {
		const safeMessage = safeRemoteMessage(message);
		if (!safeMessage) return;
		this.callbacks.onMessage?.(safeMessage);
		if (!this.remoteMessagesEl) {
			this.pendingMessages.push(safeMessage);
			return;
		}
		this.renderRemoteMessage(safeMessage);
	}

	complete(result: RemoteOperationResult): void {
		this.finish("Completed", result, "check", "is-complete");
	}

	fail(detail: string): void {
		this.finish("Failed", { summary: "The operation could not be completed.", details: [detail] }, "x", "is-error");
	}

	private renderProgress(event: RemoteProgressEvent): void {
		if (!this.phaseEl || !this.progressEl || !this.percentEl || !this.countEl) return;
		this.phaseEl.setText(event.phase);
		const total = Number(event.total);
		const loaded = Number(event.loaded);
		if (Number.isFinite(total) && total > 0 && Number.isFinite(loaded)) {
			const completed = Math.max(0, Math.floor(loaded));
			const totalCount = Math.floor(total);
			const percent = Math.max(0, Math.min(100, Math.round((completed / totalCount) * 100)));
			this.progressEl.hidden = false;
			this.progressEl.value = percent;
			this.percentEl.setText(`${percent}%`);
			this.countEl.setText(`${completed} / ${totalCount}`);
			this.progressEl.setAttribute("aria-valuetext", `${event.phase}: ${percent}%`);
		} else {
			this.progressEl.hidden = true;
			this.percentEl.setText("");
			this.countEl.setText("Working…");
		}
	}

	private renderRemoteMessage(message: string): void {
		if (!this.remoteMessagesEl) return;
		this.remoteMessagesEl.hidden = false;
		this.remoteMessages.push(message);
		this.remoteMessages.splice(0, Math.max(0, this.remoteMessages.length - 4));
		this.remoteMessagesEl.empty();
		for (const entry of this.remoteMessages) {
			this.remoteMessagesEl.createDiv({
				cls: "git-sync-progress-message",
				text: entry.startsWith("remote:") ? entry : `remote: ${entry}`,
			});
		}
	}

	private finish(state: "Completed" | "Failed", result: RemoteOperationResult, icon: string, className: string): void {
		if (!this.phaseEl || !this.resultEl || !this.closeButton) {
			this.pendingFinish = { state, result, icon, className };
			return;
		}
		this.modalEl.addClass(className);
		if (this.phaseEl) this.phaseEl.setText(state);
		if (this.phaseIconEl) {
			this.phaseIconEl.empty();
			setIcon(this.phaseIconEl, icon);
		}
		this.resultEl.setText(result.summary);
		this.renderDetails(result.details);
		if (this.progressEl && !this.progressEl.hidden && state === "Completed") {
			this.progressEl.value = 100;
			this.percentEl?.setText("100%");
			this.countEl?.setText("Transfer complete");
		} else if (this.countEl) {
			this.countEl.setText(state === "Completed" ? "No transfer needed" : "Transfer stopped");
		}
		this.closeButton.disabled = false;
		this.closeButton.focus();
	}

	private renderDetails(details: string[]): void {
		if (!this.detailsEl) return;
		this.detailsEl.empty();
		this.detailsEl.hidden = details.length === 0;
		for (const detail of details) {
			this.detailsEl.createDiv({ cls: "git-sync-progress-detail", text: detail });
		}
	}

}

function operationKicker(operation: string): string {
	switch (operation) {
		case "Push": return "Sending your local commits to the remote";
		case "Pull": return "Bringing remote commits into this vault";
		case "Fetch": return "Checking the remote without changing your files";
		case "Clone": return "Setting up a fresh local repository";
		default: return "Git is working";
	}
}


export function safeRemoteMessage(message: string): string {
	return message
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
		.trim()
		.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[redacted]@")
		.replace(/\b(token|password|authorization|bearer)\s*[:=]\s*\S+/gi, "$1: [redacted]");
}
