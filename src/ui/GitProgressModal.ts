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

interface MessagePhase {
    text: string;
    timestamp: number;
}

export class GitProgressModal extends Modal {
    private phases: Map<string, ProgressPhase> = new Map();
    private messages: MessagePhase[] = [];
    private container: HTMLElement;
    private headerEl: HTMLElement;
    private phasesEl: HTMLElement;
    private footerEl: HTMLElement;
    private operationName: string;
    private startTime: number;
    private isComplete: boolean = false;
    private bytesLoaded: number = 0;
    private lastUpdateTime: number = 0;
    private transferRate: string = '';

    constructor(app: App, operationName: string) {
        super(app);
        this.operationName = operationName;
        this.startTime = Date.now();
        this.lastUpdateTime = this.startTime;
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
        this.contentEl.empty();
    }

    /**
     * Update progress from isomorphic-git onProgress event (structured data)
     */
    updateProgress(event: any) {
        const { phase, loaded, total } = event;
        
        if (!phase) return;

        // Update bytes loaded for rate calculation
        if (loaded > this.bytesLoaded) {
            this.bytesLoaded = loaded;
            this.transferRate = this.calculateRate();
        }

        const phaseName = this.formatPhaseName(phase);
        let percent = 0;
        if (total > 0) {
            percent = Math.round((loaded / total) * 100);
        } else if (loaded > 0) {
            percent = 100;
        }

        // Update status text
        const statusEl = this.headerEl.querySelector('.git-progress-status');
        if (statusEl) {
            statusEl.setText(`${phaseName}...`);
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
                    rate: this.transferRate,
                    detail: total > 0 ? `${this.formatBytes(loaded)} / ${this.formatBytes(total)}` : this.formatBytes(loaded)
                });
            } else if (!foundActive && p.status !== 'completed') {
                this.phases.set(key, { ...p, status: 'completed', percent: 100 });
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
                rate: this.transferRate,
                detail: total > 0 ? `${this.formatBytes(loaded)} / ${this.formatBytes(total)}` : this.formatBytes(loaded)
            });
        }

        this.render();
    }

    /**
     * Update from isomorphic-git onMessage event (text-based progress)
     * This is the primary method for git.fetch and git.pull with custom HTTP clients
     */
    updateMessage(text: string) {
        if (!text) return;

        // Parse common git message patterns
        const message = text.trim();
        
        // Update header status with latest message
        const statusEl = this.headerEl.querySelector('.git-progress-status');
        if (statusEl) {
            statusEl.setText(message);
        }

        // Try to extract phase from message
        const phaseName = this.inferPhaseFromMessage(message);
        if (phaseName) {
            // Update or create phase
            const existing = this.phases.get(phaseName);
            if (existing) {
                this.phases.set(phaseName, {
                    ...existing,
                    status: 'active',
                    detail: message
                });
            } else {
                this.phases.set(phaseName, {
                    name: phaseName,
                    status: 'active',
                    percent: 0,
                    loaded: 0,
                    total: 0,
                    detail: message
                });
            }
            this.render();
        }

        // Store message for log
        this.messages.push({ text: message, timestamp: Date.now() });
    }

    /**
     * Mark operation as complete with optional message
     */
    complete(message?: string) {
        this.isComplete = true;
        
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

        setTimeout(() => {
            this.close();
        }, 2000);
    }

    /**
     * Mark operation as failed
     */
    error(errorMessage: string) {
        this.isComplete = true;
        
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
            
            const iconEl = phaseEl.createDiv('git-progress-phase-icon');
            iconEl.setText(this.getStatusIcon(phase.status));
            
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
        
        const parts: string[] = [];
        parts.push(`Elapsed: ${elapsed}s`);
        if (this.transferRate) {
            parts.push(this.transferRate);
        }
        parts.push(`${completedPhases}/${totalPhases} phases`);
        
        this.footerEl.createSpan({
            text: parts.join(' | ')
        });
    }

    private calculateRate(): string {
        const now = Date.now();
        const timeDelta = (now - this.lastUpdateTime) / 1000;
        if (timeDelta < 0.1) return this.transferRate; // Too soon, keep old rate
        
        const bytesDelta = this.bytesLoaded - (this.bytesLoaded > 0 ? this.bytesLoaded : 0);
        const bytesPerSec = bytesDelta / timeDelta;
        
        this.lastUpdateTime = now;
        
        if (bytesPerSec > 1024 * 1024) {
            return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MiB/s`;
        } else if (bytesPerSec > 1024) {
            return `${(bytesPerSec / 1024).toFixed(2)} KiB/s`;
        } else if (bytesPerSec > 0) {
            return `${Math.round(bytesPerSec)} B/s`;
        }
        return '';
    }

    private inferPhaseFromMessage(message: string): string | null {
        const lower = message.toLowerCase();
        
        if (lower.includes('enumerating')) return 'Enumerating objects';
        if (lower.includes('counting')) return 'Counting objects';
        if (lower.includes('compressing')) return 'Compressing objects';
        if (lower.includes('receiving')) return 'Receiving objects';
        if (lower.includes('resolving deltas')) return 'Resolving deltas';
        if (lower.includes('checking out')) return 'Checking out';
        if (lower.includes('fetching') || lower.includes('download')) return 'Fetching';
        if (lower.includes('writing')) return 'Writing objects';
        if (lower.includes('packing')) return 'Packing objects';
        if (lower.includes('updating')) return 'Updating references';
        if (lower.includes('remote') || lower.includes('origin')) return 'Remote communication';
        
        // Default: use first 30 chars of message as phase name
        return message.length > 30 ? message.substring(0, 30) + '...' : message;
    }

    private formatPhaseName(phase: string): string {
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
 * Returns [onProgress callback, onMessage callback, closeModal function]
 */
export function createProgressModal(app: App, operationName: string): [(event: any) => void, (text: string) => void, () => void] {
    const modal = new GitProgressModal(app, operationName);
    modal.open();

    const onProgress = (event: any) => {
        modal.updateProgress(event);
    };

    const onMessage = (text: string) => {
        modal.updateMessage(text);
    };

    const closeModal = () => {
        modal.complete();
    };

    return [onProgress, onMessage, closeModal];
}
