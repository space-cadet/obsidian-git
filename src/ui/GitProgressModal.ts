import { Modal, App } from 'obsidian';

export interface TransferProgressEvent {
    bytesLoaded: number;
    bytesTotal: number;
    bytesPerSecond?: number;
    lengthComputable: boolean;
}

export interface ProgressHandle {
    onProgress: (event: any) => void;
    onMessage: (text: string) => void;
    onTransfer: (event: TransferProgressEvent) => void;
    complete: (message?: string) => void;
    fail: (error: unknown) => void;
    signal: AbortSignal;
}

interface ProgressPhase {
    name: string;
    status: 'pending' | 'active' | 'completed' | 'error';
    percent: number;
    loaded: number;
    total: number;
    detail?: string;
}

const CLONE_PHASE_ORDER = [
    'Remote communication',
    'Fetching',
    'Receiving objects',
    'Resolving deltas',
    'Checking out',
];

const PUSH_PHASE_ORDER = [
    'Connecting to remote',
    'Preparing upload',
    'Uploading objects',
    'Waiting for remote confirmation',
    'Confirming branch',
];

export class GitProgressModal extends Modal {
    private phases: Map<string, ProgressPhase> = new Map();
    private container!: HTMLElement;
    private headerEl!: HTMLElement;
    private statsEl!: HTMLElement;
    private phasesEl!: HTMLElement;
    private footerEl!: HTMLElement;
    private operationName: string;
    private phaseOrder: string[];
    private startTime: number;
    private isComplete = false;
    private abortController = new AbortController();
    private bytesLoaded = 0;
    private bytesTotal = 0;
    private bytesPerSecond = 0;
    private lastTransferLoaded = 0;
    private lastTransferTime = 0;
    private objectsLoaded = 0;
    private objectsTotal = 0;
    private filesWritten = 0;
    private filesTotal = 0;
    private bytesWritten = 0;
    private elapsedTimer: number | null = null;

    constructor(app: App, operationName: string) {
        super(app);
        this.operationName = operationName;
        this.phaseOrder = /push/i.test(operationName) ? PUSH_PHASE_ORDER : CLONE_PHASE_ORDER;
        this.startTime = Date.now();
        this.lastTransferTime = this.startTime;
        for (const name of this.phaseOrder) {
            this.phases.set(name, {
                name,
                status: 'pending',
                percent: 0,
                loaded: 0,
                total: 0,
            });
        }
    }

    get signal(): AbortSignal {
        return this.abortController.signal;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('git-progress-modal');

        this.container = contentEl.createDiv('git-progress-container');
        this.headerEl = this.container.createDiv('git-progress-header');
        const titleEl = this.headerEl.createDiv('git-progress-title');
        titleEl.setText(this.operationName);
        const statusEl = this.headerEl.createDiv('git-progress-status');
        statusEl.setText('Initializing...');

        this.statsEl = this.container.createDiv('git-progress-statistics');
        this.phasesEl = this.container.createDiv('git-progress-phases');
        this.footerEl = this.container.createDiv('git-progress-footer');
        this.elapsedTimer = window.setInterval(() => this.render(), 1000);
        this.render();
    }

    onClose() {
        // The modal's close button is a real cancellation request. The Git
        // transport checks this signal before and while consuming responses.
        if (!this.isComplete) {
            this.abortController.abort();
        }
        if (this.elapsedTimer !== null) {
            window.clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
        }
        this.contentEl.empty();
    }

    updateProgress(event: any) {
        const payload = event?.payload || event || {};
        const phase = String(payload.phase || '');
        if (!phase) return;

        const phaseName = this.formatPhaseName(phase);
        const loaded = Number(payload.loaded || 0);
        const total = Number(payload.total || 0);

        if (phaseName === 'Checking out') {
            this.updateCheckout({ loaded, total, bytesWritten: Number(payload.bytesWritten || 0) });
        } else if (phaseName === 'Receiving objects' || phaseName === 'Resolving deltas') {
            this.objectsLoaded = loaded;
            this.objectsTotal = total;
        }

        this.activatePhase(phaseName, loaded, total);
        this.render();
    }

    updateTransfer(event: TransferProgressEvent) {
        if (this.isComplete) return;

        const loaded = Math.max(0, Number(event.bytesLoaded || 0));
        const total = Math.max(0, Number(event.bytesTotal || 0));
        const now = Date.now();
        const elapsedSeconds = (now - this.lastTransferTime) / 1000;
        const deltaBytes = loaded - this.lastTransferLoaded;

        if (event.bytesPerSecond && event.bytesPerSecond > 0) {
            this.bytesPerSecond = event.bytesPerSecond;
        } else if (elapsedSeconds >= 0.05 && deltaBytes >= 0) {
            this.bytesPerSecond = deltaBytes / elapsedSeconds;
        }

        this.bytesLoaded = Math.max(this.bytesLoaded, loaded);
        this.bytesTotal = Math.max(this.bytesTotal, total);
        this.lastTransferLoaded = loaded;
        this.lastTransferTime = now;
        this.activatePhase(this.isPush() ? 'Waiting for remote confirmation' : 'Fetching', loaded, total);
        this.render();
    }

    updateCheckout(event: { loaded?: number; total?: number; bytesWritten?: number }) {
        this.filesWritten = Math.max(this.filesWritten, Number(event.loaded || 0));
        this.filesTotal = Math.max(this.filesTotal, Number(event.total || 0));
        this.bytesWritten = Math.max(this.bytesWritten, Number(event.bytesWritten || 0));
        this.activatePhase(this.isPush() ? 'Confirming branch' : 'Checking out', this.filesWritten, this.filesTotal);
        this.render();
    }

    updateMessage(text: string) {
        if (!text || this.isComplete) return;

        const message = text.trim();
        const statusEl = this.headerEl?.querySelector('.git-progress-status');
        statusEl?.setText(message);

        const phaseName = this.inferPhaseFromMessage(message);
        if (phaseName) {
            this.activatePhase(phaseName);
            this.render();
        }
    }

    complete(message = 'Completed') {
        if (this.isComplete) return;
        this.isComplete = true;

        for (const phase of this.phases.values()) {
            if (phase.status === 'active') {
                phase.status = 'completed';
                phase.percent = 100;
            }
        }
        this.render();

        const statusEl = this.headerEl?.querySelector('.git-progress-status');
        if (statusEl) {
            statusEl.setText(message);
            statusEl.addClass('git-progress-status-success');
        }

    }

    fail(error: unknown) {
        if (this.isComplete) return;
        this.isComplete = true;

        for (const phase of this.phases.values()) {
            if (phase.status === 'active') phase.status = 'error';
        }
        this.render();

        const message = error instanceof Error ? error.message : String(error);
        const statusEl = this.headerEl?.querySelector('.git-progress-status');
        if (statusEl) {
            statusEl.setText(`Failed: ${message}`);
            statusEl.addClass('git-progress-status-error');
        }
    }

    private activatePhase(name: string, loaded = 0, total = 0) {
        const phase = this.phases.get(name);
        if (!phase) return;

        const index = this.phaseOrder.indexOf(name);
        for (let i = 0; i < index; i++) {
            const previous = this.phases.get(this.phaseOrder[i]);
            if (previous && previous.status !== 'error') {
                previous.status = 'completed';
                previous.percent = 100;
            }
        }

        phase.status = 'active';
        phase.loaded = loaded;
        phase.total = total;
        phase.percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        phase.detail = this.phaseDetail(name, loaded, total);
    }

    private render() {
        if (!this.statsEl || !this.phasesEl) return;
        this.renderStatistics();
        this.renderPhases();
        this.updateFooter();
    }

    private renderStatistics() {
        this.statsEl.empty();

        const transferTitle = this.statsEl.createDiv('git-progress-section-title');
        transferTitle.setText('Transfer statistics');
        const transfer = this.statsEl.createDiv('git-progress-stat-card');
        this.addStatRow(transfer, 'Objects', this.countPair(this.objectsLoaded, this.objectsTotal));
        this.addStatRow(transfer, this.isPush() ? 'Response data' : 'Data', this.bytePair(this.bytesLoaded, this.bytesTotal));
        this.addStatRow(transfer, 'Rate', this.bytesPerSecond > 0 ? this.formatRate(this.bytesPerSecond) : '—');
        this.addStatRow(transfer, 'ETA', this.estimateRemaining());

        const checkoutTitle = this.statsEl.createDiv('git-progress-section-title');
        checkoutTitle.setText(this.isPush() ? 'Remote confirmation' : 'Checkout progress');
        const checkout = this.statsEl.createDiv('git-progress-stat-card');
        this.addStatRow(checkout, 'Files', this.countPair(this.filesWritten, this.filesTotal));
        this.addStatRow(
            checkout,
            'Written',
            this.bytesWritten > 0 ? `${this.formatBytes(this.bytesWritten)} written` : '—',
        );
    }

    private renderPhases() {
        this.phasesEl.empty();
        const title = this.phasesEl.createDiv('git-progress-section-title');
        title.setText(this.isPush() ? 'Push phases' : 'Clone phases');

        const phaseCard = this.phasesEl.createDiv('git-progress-phase-card');
        for (const phase of this.phases.values()) {
            const phaseEl = phaseCard.createDiv('git-progress-phase');
            phaseEl.addClass(`git-progress-phase-${phase.status}`);

            const iconEl = phaseEl.createDiv('git-progress-phase-icon');
            iconEl.setText(this.getStatusIcon(phase.status));

            const infoEl = phaseEl.createDiv('git-progress-phase-info');
            const nameEl = infoEl.createDiv('git-progress-phase-name');
            nameEl.setText(phase.name);
            const detailEl = infoEl.createDiv('git-progress-phase-detail');
            detailEl.setText(phase.detail || this.statusLabel(phase.status));

            if (phase.status === 'active' && phase.total > 0) {
                const barContainer = infoEl.createDiv('git-progress-bar-container');
                const bar = barContainer.createDiv('git-progress-bar');
                const fill = bar.createDiv('git-progress-bar-fill');
                fill.style.width = `${phase.percent}%`;
                const label = barContainer.createDiv('git-progress-bar-label');
                label.setText(`${phase.percent}%`);
            }
        }
    }

    private addStatRow(parent: HTMLElement, label: string, value: string) {
        const row = parent.createDiv('git-progress-stat-row');
        const labelEl = row.createSpan('git-progress-stat-label');
        labelEl.setText(label);
        const valueEl = row.createSpan('git-progress-stat-value');
        valueEl.setText(value);
    }

    private updateFooter() {
        if (!this.footerEl) return;
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const completed = Array.from(this.phases.values()).filter((p) => p.status === 'completed').length;
        const rate = this.bytesPerSecond > 0 ? this.formatRate(this.bytesPerSecond) : 'rate unavailable';
        this.footerEl.empty();
        this.footerEl.createSpan({ text: `Elapsed: ${elapsed}s | ${rate} | ${completed}/${this.phaseOrder.length} phases` });
    }

    private countPair(loaded: number, total: number): string {
        if (loaded === 0 && total === 0) return '—';
        return `${loaded.toLocaleString()} / ${total > 0 ? total.toLocaleString() : '?'}`;
    }

    private bytePair(loaded: number, total: number): string {
        if (loaded === 0 && total === 0) return '—';
        return `${this.formatBytes(loaded)} / ${total > 0 ? this.formatBytes(total) : '?'}`;
    }

    private estimateRemaining(): string {
        if (this.bytesPerSecond <= 0 || this.bytesTotal <= 0 || this.bytesLoaded >= this.bytesTotal) return '—';
        const seconds = Math.ceil((this.bytesTotal - this.bytesLoaded) / this.bytesPerSecond);
        return `${seconds}s`;
    }

    private phaseDetail(name: string, loaded: number, total: number): string {
        if (name === 'Receiving objects' || name === 'Resolving deltas') {
            return `${loaded.toLocaleString()} / ${total > 0 ? total.toLocaleString() : '?'} objects`;
        }
        if (name === 'Checking out') {
            return `${loaded.toLocaleString()} / ${total > 0 ? total.toLocaleString() : '?'} files`;
        }
        if ((name === 'Fetching' || name === 'Uploading objects') && total > 0) return `${this.formatBytes(loaded)} / ${this.formatBytes(total)}`;
        if (name === 'Waiting for remote confirmation' && total > 0) return `${this.formatBytes(loaded)} / ${this.formatBytes(total)} response`;
        return this.statusLabel('active');
    }

    private statusLabel(status: ProgressPhase['status']): string {
        switch (status) {
            case 'completed': return 'Completed';
            case 'active': return 'In progress';
            case 'error': return 'Failed';
            default: return 'Pending';
        }
    }

    private inferPhaseFromMessage(message: string): string | null {
        const lower = message.toLowerCase();
        if (this.isPush()) {
            if (lower.includes('confirm') || lower.includes('remote result')) return 'Confirming branch';
            if (lower.includes('upload') || lower.includes('enumerating') || lower.includes('counting') || lower.includes('compressing')) return 'Preparing upload';
            if (lower.includes('connect') || lower.includes('remote')) return 'Connecting to remote';
            return 'Uploading objects';
        }
        if (lower.includes('enumerating') || lower.includes('counting') || lower.includes('compressing')) return 'Fetching';
        if (lower.includes('receiving')) return 'Receiving objects';
        if (lower.includes('resolving deltas')) return 'Resolving deltas';
        if (lower.includes('checking out') || lower.includes('writing files') || lower.includes('updating workdir')) return 'Checking out';
        if (lower.includes('fetching') || lower.includes('download') || lower.includes('connecting')) return 'Fetching';
        if (lower.includes('remote') || lower.includes('origin') || lower.includes('preparing')) return 'Remote communication';
        return null;
    }

    private formatPhaseName(phase: string): string {
        if (this.isPush()) {
            const pushMap: Record<string, string> = {
                connecting: 'Connecting to remote',
                preparing: 'Preparing upload',
                enumeratingObjects: 'Preparing upload',
                countingObjects: 'Preparing upload',
                compressingObjects: 'Preparing upload',
                uploading: 'Uploading objects',
                receivingObjects: 'Waiting for remote confirmation',
                confirming: 'Confirming branch',
            };
            return pushMap[phase] || (this.phaseOrder.includes(phase) ? phase : 'Uploading objects');
        }
        const phaseMap: Record<string, string> = {
            enumeratingObjects: 'Fetching',
            countingObjects: 'Fetching',
            compressingObjects: 'Fetching',
            receivingObjects: 'Receiving objects',
            'Receiving objects': 'Receiving objects',
            resolvingDeltas: 'Resolving deltas',
            'Resolving deltas': 'Resolving deltas',
            'Updating workdir': 'Checking out',
            checkingOut: 'Checking out',
            fetching: 'Fetching',
        };
        return phaseMap[phase] || phase;
    }

    private formatBytes(bytes: number): string {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${parseFloat((bytes / Math.pow(1024, index)).toFixed(2))} ${units[index]}`;
    }

    private formatRate(bytesPerSecond: number): string {
        return `${this.formatBytes(bytesPerSecond)}/s`;
    }

    private getStatusIcon(status: ProgressPhase['status']): string {
        switch (status) {
            case 'completed': return '✓';
            case 'active': return '◐';
            case 'error': return '✗';
            default: return '○';
        }
    }

    private isPush(): boolean {
        return this.phaseOrder === PUSH_PHASE_ORDER;
    }
}

export function createProgressModal(app: App, operationName: string): ProgressHandle {
    const modal = new GitProgressModal(app, operationName);
    modal.open();

    return {
        onProgress: (event) => modal.updateProgress(event),
        onMessage: (text) => modal.updateMessage(text),
        onTransfer: (event) => modal.updateTransfer(event),
        complete: (message) => modal.complete(message),
        fail: (error) => modal.fail(error),
        signal: modal.signal,
    };
}
