import type { GitCommit } from './gitManager';
import type { LogEntry } from './logger';

export interface SidebarCommitCache {
    branch: string;
    commits: GitCommit[];
}

export interface SidebarRemoteCommitCache extends SidebarCommitCache {
    repoUrl: string;
}

/**
 * Plugin-lifetime read data for the sidebar.
 *
 * The view owns rendering and user interaction. This model owns only immutable
 * read results and their invalidation, so recreating an Obsidian leaf does not
 * discard history unnecessarily and cache behavior can be tested without DOM.
 */
export class SidebarReadModel {
    private remoteCommits: SidebarRemoteCommitCache | null = null;
    private localCommits: SidebarCommitCache | null = null;
    private commitDetails = new Map<string, GitCommit['files']>();
    private logEntries: LogEntry[] | null = null;

    getRemoteCommits(repoUrl: string, branch: string): GitCommit[] | null {
        if (this.remoteCommits?.repoUrl !== repoUrl || this.remoteCommits.branch !== branch) return null;
        return this.remoteCommits.commits;
    }

    setRemoteCommits(repoUrl: string, branch: string, commits: GitCommit[]): void {
        this.remoteCommits = { repoUrl, branch, commits };
    }

    getRemoteRepositoryUrl(): string | null {
        return this.remoteCommits?.repoUrl || null;
    }

    getLocalCommits(branch: string): GitCommit[] | null {
        return this.localCommits?.branch === branch ? this.localCommits.commits : null;
    }

    setLocalCommits(branch: string, commits: GitCommit[]): void {
        this.localCommits = { branch, commits };
    }

    getCommitDetails(oid: string): GitCommit['files'] | null {
        return this.commitDetails.get(oid) || null;
    }

    setCommitDetails(oid: string, files: GitCommit['files']): void {
        this.commitDetails.set(oid, files);
    }

    getLogEntries(): LogEntry[] | null {
        return this.logEntries;
    }

    setLogEntries(entries: LogEntry[]): void {
        this.logEntries = entries;
    }

    invalidateHistory(): void {
        this.remoteCommits = null;
        this.localCommits = null;
        this.commitDetails.clear();
    }

    invalidateLogs(): void {
        this.logEntries = null;
    }

}
