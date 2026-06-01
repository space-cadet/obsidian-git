import { Modal, App } from 'obsidian';

interface ProgressPhase {
    name: string;
    status: 'pending' | 'active' | 'completed' | 'error';
    percent: number;
    loaded: number;
    total: number;
    rate?: string;
    detail?: string;
}

export class GitProgressModal extends Modal {
    private phases: Map<string, ProgressPhase> = new Map();
    private container: HTMLElement;
    private headerEl: HTMLElement;
    private phasesEl: HTMLElement;
    private footerEl: HTMLElement;
    private operationName: string;
    private startTime: number;
    private updateTimer: number | null = null;
    private isComplete: boolean = false;

    constructor(app: App, operationName: string) {
        super(app);
        this.operationName = operationName;
        this.startTime = Date.now();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('git-progress-modal');

        // Create modal structure
        this.container = contentEl.createDiv('git-progress-container');
        
        // Header
        this.headerEl = this.container.createDiv('git-progress-header');
        const titleEl = this.headerEl.createDiv('git-progress-title');
        titleEl.setText(this.operationName);
        const statusEl = this.headerEl.createDiv('git-progress-status');
        statusEl.setText('Initializing...');
        
        // Phases container
        this.phasesEl = this.container.createDiv('git-progress-phases');
        
        // Footer
        this.footerEl = this.container.createDiv('git-progress-footer');
        this.updateFooter();
    }

    onClose() {
        if (this.updateTimer) {
            window.clearInterval(this.updateTimer);
        }
        this.contentEl.empty();
    }

    /**
     * Update progress from isomorphic-git onProgress event
     */
    updateProgress(event: any) {
        const { phase, loaded, total, lengthComputable } = event;
        
        if (!phase) return;

        // Map isomorphic-git phases to display names
        const phaseName = this.formatPhaseName(phase);
        
        let percent = 0;
        if (lengthComputable && total > 0) {
            percent = Math.round((loaded / total) * 100);
        } else if (loaded > 0) {
            percent = 100; // Indeterminate completion
        }

        // Calculate rate if we have loaded data
        let rate = '';
        const elapsed = (Date.now() - this.startTime) / 1000;
        if (elapsed > 0 && loaded > 0) {
            const bytesPerSec = loaded / elapsed;
            if (bytesPerSec > 1024 * 1024) {
                rate = `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MiB/s`;
            } else if (bytesPerSec > 1024) {
                rate = `${(bytesPerSec / 1024).toFixed(2)} KiB/s`;
            } else {
                rate = `${Math.round(bytesPerSec)} B/s`;
            }
        }

        // Mark previous phases as completed
        let foundActive = false;
        for (const [key, p] of this.phases) {
            if (key === phaseName) {
                foundActive = true;
                this.phases.set(key, {
                    ...p,
                    status: 'active',
                    percent,
                    loaded,
                    total,
                    rate,
                    detail: lengthComputable ? `${this.formatBytes(loaded)} / ${this.formatBytes(total)}` : this.formatBytes(loaded)
                });
            } else if (!foundActive && p.status !== 'completed') {
                this.phases.set(key, { ...p, status: 'completed', percent: 100 });
            } else if (foundActive && p.status === 'pending') {
                // Keep pending
            }
        }

        // Add new phase if not exists
        if (!this.phases.has(phaseName)) {
            this.phases.set(phaseName, {
                name: phaseName,
                status: 'active',
                percent,
                loaded,
                total,
                rate,
                detail: lengthComputable ? `${this.formatBytes(loaded)} / ${this.formatBytes(total)}` : this.formatBytes(loaded)
            });
        }

        this.render();
    }

    /**
     * Mark operation as complete with optional message
     */
    complete(message?: string) {
        this.isComplete = true;
        
        // Mark all phases as completed
        for (const [key, p] of this.phases) {
            this.phases.set(key, { ...p, status: 'completed', percent: 100 });
        }
        
        this.render();
        
        if (this.headerEl) {
            const statusEl = this.headerEl.querySelector('.git-progress-status');
            if (statusEl) {
                statusEl.setText(message || 'Completed');
                statusEl.addClass('git-progress-status-success');
            }
        }

        // Auto-close after 2 seconds
        setTimeout(() => {
            this.close();
        }, 2000);
    }

    /**
     * Mark operation as failed
     */
    error(errorMessage: string) {
        this.isComplete = true;
        
        // Mark current active phase as error
        for (const [key, p] of this.phases) {
            if (p.status === 'active') {
                this.phases.set(key, { ...p, status: 'error' });
            }
        }
        
        this.render();
        
        if (this.headerEl) {
            const statusEl = this.headerEl.querySelector('.git-progress-status');
            if (statusEl) {
                statusEl.setText(`Failed: ${errorMessage}`);
                statusEl.addClass('git-progress-status-error');
            }
        }
    }

    private render() {
        if (!this.phasesEl) return;
        
        this.phasesEl.empty();
        
        for (const [key, phase] of this.phases) {
            const phaseEl = this.phasesEl.createDiv('git-progress-phase');
            phaseEl.addClass(`git-progress-phase-${phase.status}`);
            
            // Phase icon
            const iconEl = phaseEl.createDiv('git-progress-phase-icon');
            iconEl.setText(this.getStatusIcon(phase.status));
            
            // Phase info
            const infoEl = phaseEl.createDiv('git-progress-phase-info');
            
            const nameEl = infoEl.createDiv('git-progress-phase-name');
            nameEl.setText(phase.name);
            
            if (phase.detail || phase.rate) {
                const detailEl = infoEl.createDiv('git-progress-phase-detail');
                const parts: string[] = [];
                if (phase.detail) parts.push(phase.detail);
                if (phase.rate) parts.push(phase.rate);
                detailEl.setText(parts.join(' | '));
            }
            
            // Progress bar (for computable phases)
            if (phase.status === 'active' && phase.total > 0) {
                const barContainer = phaseEl.createDiv('git-progress-bar-container');
                const bar = barContainer.createDiv('git-progress-bar');
                const barFill = bar.createDiv('git-progress-bar-fill');
                barFill.style.width = `${phase.percent}%`;
                const barLabel = barContainer.createDiv('git-progress-bar-label');
                barLabel.setText(`${phase.percent}%`);
            }
        }

        this.updateFooter();
    }

    private updateFooter() {
        if (!this.footerEl) return;
        
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const totalPhases = this.phases.size;
        const completedPhases = Array.from(this.phases.values()).filter(p => p.status === 'completed').length;
        
        this.footerEl.empty();
        this.footerEl.createSpan({
            text: `Elapsed: ${elapsed}s | ${completedPhases}/${totalPhases} phases`
        });
    }

    private formatPhaseName(phase: string): string {
        // Map raw isomorphic-git phase names to human-friendly names
        const phaseMap: Record<string, string> = {
            'enumeratingObjects': 'Enumerating objects',
            'countingObjects': 'Counting objects',
            'compressingObjects': 'Compressing objects',
            'receivingObjects': 'Receiving objects',
            'resolvingDeltas': 'Resolving deltas',
            'analyzing': 'Analyzing',
            'checkingOut': 'Checking out',
            'fetching': 'Fetching',
            'writingObjects': 'Writing objects',
            'packing': 'Packing objects',
            'sending': 'Sending data',
            'updatingReferences': 'Updating references',
            'waiting': 'Waiting for remote',
        };
        
        return phaseMap[phase] || phase;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'pending': return '○';
            case 'active': return '◐';
            case 'completed': return '✓';
            case 'error': return '✗';
            default: return '○';
        }
    }
}

/**
 * Create a progress modal for git operations
 * Returns [onProgress callback, closeModal function]
 */
export function createProgressModal(app: App, operationName: string): [(event: any) => void, () => void] {
    const modal = new GitProgressModal(app, operationName);
    modal.open();

    const onProgress = (event: any) => {
        modal.updateProgress(event);
    };

    const closeModal = () => {
        modal.complete();
    };

    return [onProgress, closeModal];
}
