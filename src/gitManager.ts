import * as git from 'isomorphic-git';
import { requestUrl, RequestUrlResponse, Notice } from 'obsidian';
import { log } from './logger';
import { filterAutomaticallyStagedPaths, normalizeRemoteUrl } from './security';
import {
    classifyRepositoryError,
    RepositoryInitializationError,
    repositoryFailureMessage,
} from './repositoryState';

/**
 * Git HTTP client using Obsidian's requestUrl API.
 *
 * requestUrl runs at the native level (Capacitor bridge), bypassing CORS
 * restrictions entirely. This works on both desktop and mobile without
 * requiring any proxy server.
 */
class GitHttpClient {
  private credentials: GitCredentials;
  private signals: AbortSignal[];
  private onTransfer?: (event: TransferProgressEvent) => void;

    constructor(credentials: GitCredentials, options: {
      signal?: AbortSignal;
      signals?: readonly (AbortSignal | undefined)[];
      onTransfer?: (event: TransferProgressEvent) => void;
    } = {}) {
        this.credentials = credentials;
        this.signals = [options.signal, ...(options.signals || [])].filter(
          (signal): signal is AbortSignal => !!signal,
        );
        this.onTransfer = options.onTransfer;
        log.setSensitiveValues([credentials.password]);
    }

  async request(config: any, attempt: number = 1): Promise<any> {
    const maxAttempts = 3;
    this.throwIfAborted(config.signal);
    log.debug('GitHttpClient', `Requesting: ${config.method || 'GET'} ${config.url}`);

    // Build headers with Basic Auth
    const headers: Record<string, string> = {
      ...config.headers,
    };

    if (this.credentials.username && this.credentials.password) {
      const auth = btoa(`${this.credentials.username}:${this.credentials.password}`);
      headers['Authorization'] = `Basic ${auth}`;
    }

    // Collect body if it's an async iterable (isomorphic-git sends Uint8Array chunks)
    let body: string | ArrayBuffer | undefined;
    if (config.body) {
      body = await this.collectBody(config.body, config.signal);
    }

    try {
      this.throwIfAborted(config.signal);
      const response: RequestUrlResponse = await requestUrl({
        url: config.url,
        method: config.method || 'GET',
        headers,
        body,
        throw: false, // Don't throw on 4xx/5xx — let isomorphic-git handle Git errors
      });

      this.throwIfAborted(config.signal);

      log.debug('GitHttpClient', `Response status: ${response.status}`);

      const total = response.arrayBuffer?.byteLength || 0;
      let lastLoaded = 0;
      let lastTime = Date.now();
      this.onTransfer?.({
        bytesLoaded: 0,
        bytesTotal: total,
        lengthComputable: total > 0,
      });

      // Convert Obsidian response to isomorphic-git expected format
      return {
        url: config.url,
        method: config.method || 'GET',
        statusCode: response.status,
        statusMessage: this.getStatusMessage(response.status),
        body: this.toAsyncIterator(response.arrayBuffer, (bytesLoaded) => {
          const now = Date.now();
          const elapsedSeconds = (now - lastTime) / 1000;
          const deltaBytes = bytesLoaded - lastLoaded;
          const bytesPerSecond = elapsedSeconds >= 0.05 && deltaBytes >= 0
            ? deltaBytes / elapsedSeconds
            : undefined;
          lastLoaded = bytesLoaded;
          lastTime = now;
          this.onTransfer?.({
            bytesLoaded,
            bytesTotal: total,
            bytesPerSecond,
            lengthComputable: total > 0,
          });
        }, config.signal),
        headers: response.headers,
      };
    } catch (error: any) {
      const isRetryable = error.message?.includes('Connection reset')
        || error.message?.includes('timeout')
        || error.message?.includes('ETIMEDOUT')
        || error.message?.includes('ECONNRESET')
        || error.message?.includes('SocketException');

      if (isRetryable && attempt < maxAttempts) {
        const delayMs = 1000 * attempt;
        log.warn('GitHttpClient', `Request failed (attempt ${attempt}/${maxAttempts}): ${error.message}. Retrying in ${delayMs}ms...`);
        await this.waitBeforeRetry(delayMs, config.signal);
        return this.request(config, attempt + 1);
      }

      log.error('GitHttpClient', `Request failed: ${error.message}`, error);
      throw error;
    }
  }

  private throwIfAborted(requestSignal?: AbortSignal): void {
    if (this.signals.some((signal) => signal.aborted) || requestSignal?.aborted) {
      const error = new Error('Git operation cancelled');
      error.name = 'AbortError';
      throw error;
    }
  }

  /**
   * Collect an async iterable of Uint8Arrays into a single ArrayBuffer
   */
  private async collectBody(body: AsyncIterable<Uint8Array>, requestSignal?: AbortSignal): Promise<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      this.throwIfAborted(requestSignal);
      chunks.push(chunk);
    }

    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.byteLength;
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result.buffer;
  }

  private async waitBeforeRetry(delayMs: number, requestSignal?: AbortSignal): Promise<void> {
    this.throwIfAborted(requestSignal);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const signals = [...this.signals, requestSignal].filter(
        (value): value is AbortSignal => !!value,
      );
      const cleanup = () => signals.forEach((signal) => signal.removeEventListener('abort', onAbort));
      const timer = setTimeout(() => {
        settled = true;
        cleanup();
        resolve();
      }, delayMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(Object.assign(new Error('Git operation cancelled'), { name: 'AbortError' }));
      };
      for (const signal of signals) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Convert an ArrayBuffer into an async iterator of Uint8Arrays.
   * 
   * CHUNKING STRATEGY: Yield in 64KB chunks instead of the entire buffer at once.
   * This allows isomorphic-git's packfile parser to process objects incrementally
   * and potentially free memory between chunks, reducing peak memory usage on mobile.
   * 
   * Uses subarray() (view, not copy) to avoid additional memory allocation.
   */
  private toAsyncIterator(
    arrayBuffer: ArrayBuffer,
    onChunk?: (bytesLoaded: number) => void,
    signal?: AbortSignal,
    chunkSize = 65536,
  ): AsyncIterable<Uint8Array> {
    return arrayBufferToAsyncIterable(arrayBuffer, chunkSize, onChunk, signal);
  }

  private getStatusMessage(status: number): string {
    const messages: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
    };
    return messages[status] || 'Unknown';
  }
}

/**
 * Yield an HTTP response body in bounded, zero-copy chunks.
 *
 * Exported so the mobile memory-safety boundary can be verified without an
 * Obsidian runtime or a network request.
 */
export function arrayBufferToAsyncIterable(
    arrayBuffer: ArrayBuffer,
    chunkSize = 65536,
    onChunk?: (bytesLoaded: number, bytesTotal: number) => void,
    signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
        throw new RangeError('chunkSize must be a positive integer');
    }

    return {
        [Symbol.asyncIterator]: async function* () {
            const view = new Uint8Array(arrayBuffer);
            let bytesLoaded = 0;
            onChunk?.(0, view.length);
            for (let offset = 0; offset < view.length; offset += chunkSize) {
                if (signal?.aborted) {
                    const error = new Error('Git operation cancelled');
                    error.name = 'AbortError';
                    throw error;
                }
                const end = Math.min(offset + chunkSize, view.length);
                bytesLoaded = end;
                onChunk?.(bytesLoaded, view.length);
                yield view.subarray(offset, end);
            }
        },
    };
}

/**
 * Verify that a remote Git repository can be reached with the supplied
 * credentials without touching the vault.  This intentionally uses Git's
 * read-only ref-advertisement endpoint rather than clone, init, or fetch, so
 * it is safe to use from the Settings screen before a local repository exists.
 *
 * A successful empty response is valid: newly created remote repositories have
 * no refs yet, but their URL and credentials are still usable.
 */
export async function testRemoteConnection(credentials: GitCredentials): Promise<void> {
    const repoUrl = credentials.repoUrl ? normalizeRemoteUrl(credentials.repoUrl) : '';
    if (!repoUrl) {
        throw new Error('Please enter a repository URL first');
    }

    log.setSensitiveValues([credentials.password]);
    log.info('GitManager', `Testing read-only remote connection to ${repoUrl}`);
    await git.listServerRefs({
        http: new GitHttpClient({ ...credentials, repoUrl }),
        url: repoUrl,
    });
    log.info('GitManager', 'Remote connection test succeeded');
}

// Progress event emitter for isomorphic-git
export class GitProgressEmitter {
    private listeners: Map<string, ((data: any) => void)[]> = new Map();
    private currentPhase: string = '';

    on(event: string, callback: (data: any) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    emit(event: string, data: any): void {
        const callbacks = this.listeners.get(event) || [];
        for (const cb of callbacks) {
            try { cb(data); } catch (e) { /* ignore */ }
        }
    }

    /**
     * Create an emitter that shows progress via Notice toasts
     */
    static withNotice(initialMessage: string): GitProgressEmitter {
        const emitter = new GitProgressEmitter();
        let notice: Notice | null = new Notice(initialMessage, 0); // 0 = persistent

        emitter.on('progress', (event: any) => {
            const { phase, loaded, total, lengthComputable } = event?.payload || event || {};
            if (phase && phase !== emitter.currentPhase) {
                emitter.currentPhase = phase;
            }
            let msg = `${initialMessage} — ${phase || 'working'}`;
            if (lengthComputable && total > 0) {
                const pct = Math.round((loaded / total) * 100);
                msg += ` (${pct}%, ${Math.round(loaded / 1024)}KB / ${Math.round(total / 1024)}KB)`;
            } else if (loaded > 0) {
                msg += ` (${Math.round(loaded / 1024)}KB)`;
            }
            if (notice) {
                notice.setMessage(msg);
            }
        });

        emitter.on('message', (event: any) => {
            const text = event?.payload?.text || event?.text || String(event);
            log.debug('GitProgress', text);
        });

        emitter.on('complete', () => {
            if (notice) {
                notice.hide();
                notice = null;
            }
        });

        emitter.on('error', () => {
            if (notice) {
                notice.hide();
                notice = null;
            }
        });

        return emitter;
    }

    hideNotice(): void {
        // Handled by complete/error events
    }
}

// Simple EventEmitter-compatible object for isomorphic-git
export function createGitEmitter(onProgress?: (phase: string, loaded: number, total: number, lengthComputable: boolean) => void): any {
    const emitter = new GitProgressEmitter();
    if (onProgress) {
        emitter.on('progress', (e: any) => {
            const p = e?.payload || e || {};
            onProgress(p.phase || '', p.loaded || 0, p.total || 0, p.lengthComputable || false);
        });
    }
    return emitter;
}

/**
 * Create a progress handle for environments where a modal is unavailable.
 * Object counts, response bytes, and checkout items remain separate here too.
 */
export function createProgressNotice(initialMessage: string): ProgressHandle {
    let notice: Notice | null = new Notice(initialMessage, 0);
    const abortController = new AbortController();

    const onProgress = (event: any) => {
        const { phase, loaded, total } = event;
        let msg = `${initialMessage} — ${phase || 'working'}`;
        if (total > 0) {
            const pct = Math.round((loaded / total) * 100);
            msg += ` (${pct}%, ${loaded.toLocaleString()} / ${total.toLocaleString()} objects)`;
        } else if (loaded > 0) {
            msg += ` (${loaded.toLocaleString()} objects)`;
        }
        if (notice) {
            notice.setMessage(msg);
        }
    };

    const onTransfer = (event: TransferProgressEvent) => {
        const loaded = formatProgressBytes(event.bytesLoaded);
        const total = event.bytesTotal > 0 ? ` / ${formatProgressBytes(event.bytesTotal)}` : '';
        if (notice) notice.setMessage(`${initialMessage} — Data ${loaded}${total}`);
    };

    const onMessage = (text: string) => {
        const msg = `${initialMessage} — ${text}`;
        if (notice) {
            notice.setMessage(msg);
        }
    };

    const complete = () => {
        if (notice) {
            notice.hide();
            notice = null;
        }
    };

    return {
        onProgress,
        onMessage,
        onTransfer,
        complete,
        fail: complete,
        signal: abortController.signal,
    };
}

function formatProgressBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${parseFloat((bytes / Math.pow(1024, index)).toFixed(2))} ${units[index]}`;
}


export interface GitFileStatus {
    filepath: string;
    status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'conflict';
}

export interface BulkStageResult {
    requested: number;
    staged: string[];
    failed: Array<{ filepath: string; message: string }>;
}

export interface BulkUnstageResult {
    requested: number;
    unstaged: string[];
    failed: Array<{ filepath: string; message: string }>;
}

type GitStatusMatrixRow = [string, number, number, number];

// Keep bulk staging bounded for mobile vaults. isomorphic-git processes a
// filepath array in parallel, so a batch avoids one index write per file
// without retaining every file's contents in memory at once.
const BULK_STAGE_BATCH_SIZE = 64;
const MOBILE_IO_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);

    const run = async (): Promise<void> => {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => run()));
    return results;
}

export interface GitCommit {
    oid: string;
    message: string;
    author: string;
    date: Date;
    commit: any;
    files?: { filepath: string; status: 'added' | 'modified' | 'deleted' }[];
}

function isTransientMissingPath(error: unknown): boolean {
    const value = error as { code?: unknown; message?: unknown } | null;
    const message = String(value?.message ?? error ?? '');
    return value?.code === 'ENOENT' || /\bENOENT\b|no such file or directory/i.test(message);
}

function parseGitHubRepositoryUrl(repoUrl: string): { owner: string; repo: string } | null {
    const value = repoUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
    const httpsMatch = value.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

    const sshMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    return null;
}

function isProtectedRepairPath(filepath: string): boolean {
    const normalized = filepath.replace(/^\.\//, '').replace(/^\/+/, '');
    return normalized === '.git'
        || normalized.startsWith('.git/')
        || normalized === '.git-sync-repair'
        || normalized.startsWith('.git-sync-repair-')
        || normalized.startsWith('.obsidian/plugins/obsidian-git-sync/');
}

export interface GitSidebarStatusSnapshot {
    branch: string;
    ahead: number;
    behind: number;
    comparison: GitComparisonState;
    comparisonError?: string;
    repositoryStatusAvailable?: boolean;
    detailedStatus: GitFileStatus[];
    staged: string[];
    unstaged: string[];
}

export type GitComparisonState =
    | 'up-to-date'
    | 'ahead'
    | 'behind'
    | 'diverged'
    | 'local-only'
    | 'unavailable';

export interface GitCommitFile {
    filepath: string;
    status: 'added' | 'modified' | 'deleted';
}

import {
    GitProgressModal,
    createProgressModal,
    ProgressHandle,
    TransferProgressEvent,
} from './ui/GitProgressModal';

export interface GitCredentials {
    username: string;
    password: string;
    repoUrl?: string;
    author: {
        name: string;
        email: string;
    };
}

export type RepositoryHealthState = 'missing' | 'healthy' | 'damaged';

export interface RepositoryHealth {
    state: RepositoryHealthState;
    exists: boolean;
    healthy: boolean;
    branch: string | null;
    hasCommits: boolean;
    reason?: string;
}

export type RepositoryIndexState = 'missing' | 'healthy' | 'empty' | 'invalid';

export interface RepositoryIndexHealth {
    state: RepositoryIndexState;
    exists: boolean;
    size: number | null;
    reason?: string;
}

export interface RepositoryIndexRepairResult {
    backupPath: string | null;
    trackedFiles: number;
    worktreeFiles: number;
    stagedStateRecovered: false;
}

export interface RepositoryIndexRepairPreview {
    index: RepositoryIndexHealth;
    trackedFiles: number;
    modifiedFiles: number;
    deletedFiles: number;
    untrackedFiles: number;
    unchangedFiles: number;
}

export interface RepositoryIndexBackupPreview {
    filename: string;
    size: number;
    validFormat: boolean;
}

export interface RepositoryRebuildPreview {
    branch: string;
    remoteOid: string | null;
    localOnly: string[];
    remoteOnly: string[];
    conflicts: string[];
    unchanged: string[];
}

export function compareRepositoryPaths(
    localFiles: ReadonlyMap<string, string>,
    remoteFiles: ReadonlyMap<string, string>,
): Omit<RepositoryRebuildPreview, 'branch' | 'remoteOid'> {
    const localOnly: string[] = [];
    const remoteOnly: string[] = [];
    const conflicts: string[] = [];
    const unchanged: string[] = [];
    const paths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);

    for (const filepath of [...paths].sort()) {
        const local = localFiles.get(filepath);
        const remote = remoteFiles.get(filepath);
        if (local === undefined) remoteOnly.push(filepath);
        else if (remote === undefined) localOnly.push(filepath);
        else if (local === remote) unchanged.push(filepath);
        else conflicts.push(filepath);
    }

    return { localOnly, remoteOnly, conflicts, unchanged };
}

interface PendingCheckoutState {
    version: 1;
    repoUrl: string;
    branchName: string;
    depth: number;
    oid: string;
}

export class GitManager {
    private fs: any;
    private dir: string;
    private credentials: GitCredentials;
    private statusBarItem: HTMLElement | null = null;
    private app: any;
    private operationSignal: AbortSignal | null = null;
    private comparisonCache: {
        branch: string;
        localOid: string | null;
        remoteOid: string | null;
        result: { branch: string; ahead: number; behind: number; comparison: GitComparisonState; comparisonError?: string };
    } | null = null;

    constructor(fs: any, dir: string, credentials: GitCredentials, app?: any, statusBarItem?: HTMLElement) {
        this.fs = fs;
        this.dir = dir;
        this.credentials = credentials;
        this.app = app || null;
        this.statusBarItem = statusBarItem || null;
    }

    /**
     * Update the Git credentials
     */
    updateCredentials(credentials: GitCredentials): void {
        this.credentials = credentials;
        log.setSensitiveValues([credentials.password]);
        log.debug('GitManager', 'Credentials updated');
    }

    /** Attach the plugin-wide cancellation signal to the current mutation. */
    setOperationSignal(signal: AbortSignal | null): void {
        this.operationSignal = signal;
    }

    private assertOperationActive(): void {
        if (!this.operationSignal?.aborted) return;
        const error = new Error('Git operation cancelled');
        error.name = 'AbortError';
        throw error;
    }

    /** Keep long vault scans cancellable and give Obsidian a chance to paint. */
    private async yieldToEventLoop(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    private updateStatus(message: string) {
        if (this.statusBarItem) {
            this.statusBarItem.setText(`Git: ${message}`);
        }
        log.info('GitManager', message);
    }

    private createProgress(operationName: string): ProgressHandle {
        const progress = this.app
            ? createProgressModal(this.app, operationName)
            : createProgressNotice(operationName);
        if (this.operationSignal) {
            this.operationSignal.addEventListener('abort', () => {
                progress.fail(new Error('Git operation cancelled'));
            }, { once: true });
        }
        return progress;
    }

    private createHttpClient(progress?: ProgressHandle): GitHttpClient {
        return new GitHttpClient(this.credentials, {
            signal: progress?.signal,
            signals: [this.operationSignal || undefined],
            onTransfer: progress?.onTransfer,
        });
    }

    private setWriteProgress(callback?: (path: string, bytes: number) => void): void {
        const setProgress = (this.fs as any)?.setWriteProgress;
        if (typeof setProgress === 'function') setProgress(callback);
    }

    private assertProgressActive(progress: ProgressHandle): void {
        this.assertOperationActive();
        if (progress.signal.aborted) {
            const error = new Error('Git operation cancelled');
            error.name = 'AbortError';
            throw error;
        }
    }

    /**
     * Initialize a new repository or check if one exists
     */
    /**
     * Ensure the 'origin' remote is configured with the given URL
     */
    async ensureRemote(repoUrl: string): Promise<void> {
        try {
            this.assertOperationActive();
            const remoteUrl = normalizeRemoteUrl(repoUrl);
            const remotes = await git.listRemotes({ fs: this.fs, dir: this.dir });
            const hasOrigin = remotes.some((r: any) => r.remote === 'origin');
            
            if (!hasOrigin) {
                log.info('GitManager', 'Adding remote origin');
                await git.addRemote({ fs: this.fs, dir: this.dir, remote: 'origin', url: remoteUrl });
            } else {
                // Optionally update URL if it changed
                const origin = remotes.find((r: any) => r.remote === 'origin');
                if (origin && origin.url !== remoteUrl) {
                    log.info('GitManager', 'Updating remote origin');
                    await git.deleteRemote({ fs: this.fs, dir: this.dir, remote: 'origin' });
                    try {
                        await git.addRemote({ fs: this.fs, dir: this.dir, remote: 'origin', url: remoteUrl });
                    } catch (error) {
                        try {
                            await git.addRemote({ fs: this.fs, dir: this.dir, remote: 'origin', url: origin.url });
                        } catch (restoreError) {
                            log.error('GitManager', 'Could not restore the previous origin URL', restoreError);
                        }
                        throw error;
                    }
                }
            }
        } catch (error) {
            log.error('GitManager', 'Failed to ensure remote', error);
            throw error;
        }
    }

    async initializeRepo(repoUrl: string, branchName: string): Promise<boolean> {
        try {
            this.assertOperationActive();
            const remoteUrl = repoUrl ? normalizeRemoteUrl(repoUrl) : '';
            log.debug('GitManager', `Initializing repository: ${remoteUrl || '(local only)'}, branch: ${branchName}`);
            // Check if .git directory exists
            const isRepo = await this.isRepository();
            
            if (!isRepo) {
                if (!remoteUrl) {
                    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: branchName });
                    this.updateStatus('Local repository initialized');
                    return true;
                }

                // Only a verified empty remote may fall back to local initialization.
                try {
                    log.info('GitManager', `Cloning repository (branch: ${branchName})`);
                    
                    await this.cloneRepository(remoteUrl, branchName, 1);
                    
                    this.updateStatus('Repository cloned');
                    log.info('GitManager', `Repository successfully cloned to ${this.dir}`);
                    return true;
                } catch (cloneError: any) {
                    const kind = classifyRepositoryError(cloneError);
                    if (kind !== 'empty-remote') {
                        log.warn('GitManager', `Clone refused local fallback (${kind})`);
                        throw new RepositoryInitializationError(kind, repositoryFailureMessage(kind));
                    }

                    log.info('GitManager', 'Remote is empty; initializing a local repository');
                    
                    this.updateStatus('Initializing local repository...');
                    log.info('GitManager', `Initializing empty repo at ${this.dir}`);
                    
                    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: branchName });
                    await this.ensureRemote(remoteUrl);
                    
                    this.updateStatus('Local repository initialized');
                    log.info('GitManager', 'Local repo initialized with remote configured');
                    return true;
                }
            }
            
            // If repository exists locally, ensure remote is configured
            if (remoteUrl) {
                await this.ensureRemote(remoteUrl);
            } else {
                this.updateStatus('Repository ready');
                return true;
            }
            
            // Validate the remote URL by attempting to list the remote refs
            this.updateStatus('Validating repository...');
            log.debug('GitManager', 'Validating remote repository URL');
            
            await git.listServerRefs({
                http: this.createHttpClient(),
                url: remoteUrl,
                prefix: `refs/heads/${branchName}`,
                onAuth: () => ({
                    username: this.credentials.username,
                    password: this.credentials.password
                })
            });
            
            this.updateStatus('Repository validated');
            log.info('GitManager', `Repository exists and remote URL is valid`);
            return true;
        } catch (error) {
            log.error('GitManager', 'Failed to initialize repository', error);
            this.updateStatus('Failed to initialize');
            throw error;
        }
    }

    /**
     * Check if the current directory is a local git repository
     * Note: This only checks for local repository structure, not remote connectivity
     */
    async isRepository(): Promise<boolean> {
        try {
            // Check the repository owned by this manager. Using findRoot with a
            // relative dummy path can accidentally inspect the process cwd on
            // desktop, which is often this plugin's own checkout rather than
            // the vault being cloned.
            const gitHead = this.dir === '.' ? '.git/HEAD' : `${this.dir}/.git/HEAD`;
            await this.fs.stat(gitHead);
            log.debug('GitManager', `Local Git repository found`);
            return true;
        } catch (error) {
            log.debug('GitManager', `No local Git repository found`);
            return false;
        }
    }

    /**
     * Distinguish a missing repository from a present but unreadable one.
     * This check only reads metadata; it never repairs or replaces files.
     */
    async checkRepositoryHealth(): Promise<RepositoryHealth> {
        const gitDir = this.dir === '.' ? '.git' : `${this.dir}/.git`;
        try {
            const stat = await this.fs.stat(gitDir);
            if (!stat?.isDirectory?.()) {
                return { state: 'missing', exists: false, healthy: false, branch: null, hasCommits: false, reason: 'missing .git directory' };
            }
        } catch {
            return { state: 'missing', exists: false, healthy: false, branch: null, hasCommits: false, reason: 'missing .git directory' };
        }

        try {
            const branch = await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: false });
            if (!branch) {
                return { state: 'damaged', exists: true, healthy: false, branch: null, hasCommits: false, reason: 'HEAD is not attached to a branch' };
            }

            let hasCommits = false;
            try {
                const oid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
                await git.readCommit({ fs: this.fs, dir: this.dir, oid });
                hasCommits = true;
            } catch (error: any) {
                const message = String(error?.message || error);
                if (!/could not find|not found|unknown revision|does not exist|no such ref/i.test(message)) {
                    return { state: 'damaged', exists: true, healthy: false, branch, hasCommits: false, reason: 'HEAD commit cannot be read' };
                }
            }

            await git.listRemotes({ fs: this.fs, dir: this.dir });
            const indexHealth = await this.checkRepositoryIndex();
            if (indexHealth.state === 'empty' || indexHealth.state === 'invalid') {
                return {
                    state: 'damaged',
                    exists: true,
                    healthy: false,
                    branch,
                    hasCommits,
                    reason: indexHealth.reason || 'Git index cannot be read',
                };
            }
            return { state: 'healthy', exists: true, healthy: true, branch, hasCommits };
        } catch (error) {
            log.warn('GitManager', 'Repository health check failed', error);
            return { state: 'damaged', exists: true, healthy: false, branch: null, hasCommits: false, reason: 'Git metadata cannot be read' };
        }
    }

    /**
     * Inspect the index without scanning the vault worktree. A missing index
     * is valid for a newly-created repository; an existing empty or malformed
     * index is repairable metadata damage.
     */
    async checkRepositoryIndex(): Promise<RepositoryIndexHealth> {
        const fs = this.fs.promises || this.fs;
        const indexPath = this.repositoryGitPath('index');
        let stat: any;
        try {
            stat = await fs.stat(indexPath);
        } catch (error) {
            if (isTransientMissingPath(error)) {
                return { state: 'missing', exists: false, size: null };
            }
            throw error;
        }

        const size = Number.isFinite(stat?.size) ? stat.size : null;
        if (size === 0) {
            return {
                state: 'empty',
                exists: true,
                size,
                reason: 'Git index is empty (.git/index)',
            };
        }

        try {
            // listFiles parses the complete index and verifies its checksum,
            // without hashing or reading every file in the worktree.
            await git.listFiles({ fs: this.fs, dir: this.dir });
            return { state: 'healthy', exists: true, size };
        } catch (error: any) {
            log.warn('GitManager', 'Git index validation failed', error);
            return {
                state: 'invalid',
                exists: true,
                size,
                reason: error?.message || 'Git index is malformed',
            };
        }
    }

    private repositoryGitPath(filepath: string): string {
        return this.dir === '.' ? `.git/${filepath}` : `${this.dir}/.git/${filepath}`;
    }

    private async indexExists(fs: any): Promise<boolean> {
        try {
            await fs.stat(this.repositoryGitPath('index'));
            return true;
        } catch (error) {
            if (isTransientMissingPath(error)) return false;
            throw error;
        }
    }

    private async backupIndex(fs: any, prefix: string): Promise<string | null> {
        if (!(await this.indexExists(fs))) return null;
        const indexPath = this.repositoryGitPath('index');
        const backupPath = this.repositoryGitPath(`${prefix}-${Date.now()}`);
        const value = await fs.readFile(indexPath);
        await fs.writeFile(backupPath, value);
        log.info('GitManager', `Backed up Git index to ${backupPath}`);
        return backupPath;
    }

    private async removeIndexIfPresent(fs: any): Promise<void> {
        try {
            if (await this.indexExists(fs)) await fs.unlink(this.repositoryGitPath('index'));
        } catch (error) {
            if (!isTransientMissingPath(error)) throw error;
        }
    }

    /**
     * Calculate the worktree impact of an index rebuild without writing any
     * Git metadata or changing vault files.
     */
    async previewIndexRepair(): Promise<RepositoryIndexRepairPreview> {
        this.assertOperationActive();
        const fs = this.fs.promises || this.fs;
        const startedAt = Date.now();
        log.info('GitManager', 'Git index repair preview started');
        const index = await this.checkRepositoryIndex();
        const headOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
        const headCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: headOid });
        const headFiles = await this.readTreeRecursiveAt(this.fs, this.dir, headCommit.commit.tree, '', true);
        const trackedPaths = new Set(headFiles.keys());
        const worktreeFiles = await this.readRepairWorktreePaths(fs, trackedPaths);
        log.debug('GitManager', 'Git index repair preview discovered worktree paths', {
            trackedFiles: headFiles.size,
            worktreeFiles: worktreeFiles.size,
            elapsedMs: Date.now() - startedAt,
        });

        let comparedFiles = 0;
        const comparisonResults = await mapWithConcurrency(
            [...headFiles.entries()],
            MOBILE_IO_CONCURRENCY,
            async ([filepath, oid]) => {
                this.assertOperationActive();
                let comparison: 'modified' | 'deleted' | 'unchanged';
                if (!worktreeFiles.has(filepath)) {
                    comparison = 'deleted';
                } else {
                    const fullPath = this.dir === '.' ? filepath : `${this.dir}/${filepath}`;
                    const value = await fs.readFile(fullPath);
                    const localOid = (await git.hashBlob({ object: value })).oid;
                    comparison = localOid === oid ? 'unchanged' : 'modified';
                }
                comparedFiles += 1;
                if (comparedFiles % 50 === 0) {
                    log.debug('GitManager', 'Git index repair preview comparing tracked files', {
                        comparedFiles,
                        trackedFiles: headFiles.size,
                        elapsedMs: Date.now() - startedAt,
                    });
                    await this.yieldToEventLoop();
                }
                return comparison;
            },
        );
        const modifiedFiles = comparisonResults.filter((value) => value === 'modified').length;
        const deletedFiles = comparisonResults.filter((value) => value === 'deleted').length;
        const unchangedFiles = comparisonResults.filter((value) => value === 'unchanged').length;

        let untrackedFiles = 0;
        for (const filepath of worktreeFiles) {
            if (!trackedPaths.has(filepath)) untrackedFiles += 1;
        }

        const result = {
            index,
            trackedFiles: headFiles.size,
            modifiedFiles,
            deletedFiles,
            untrackedFiles,
            unchangedFiles,
        };
        log.info('GitManager', 'Git index repair preview completed', {
            ...result,
            elapsedMs: Date.now() - startedAt,
        });
        return result;
    }

    /** Return a read-only description of the newest repair backup. */
    async previewLatestIndexBackup(): Promise<RepositoryIndexBackupPreview | null> {
        this.assertOperationActive();
        const fs = this.fs.promises || this.fs;
        const gitDir = this.dir === '.' ? '.git' : `${this.dir}/.git`;
        const entries = await fs.readdir(gitDir, { encoding: 'utf8' });
        const backups = entries
            .filter((entry: string) => /^index\.obsidian-git-backup-\d+$/.test(entry))
            .sort()
            .reverse();
        if (backups.length === 0) return null;

        const filename = backups[0];
        const value = await fs.readFile(`${gitDir}/${filename}`);
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        const magic = bytes.byteLength >= 4
            ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
            : '';
        return { filename, size: bytes.byteLength, validFormat: magic === 'DIRC' };
    }

    /**
     * Rebuild the Git index from HEAD while leaving all vault files in place.
     *
     * The damaged index is backed up first. Current worktree files are added
     * temporarily so isomorphic-git can create a valid index, then every HEAD
     * path is reset to HEAD and temporary entries for new files are removed.
     * This preserves modified, deleted, and untracked files, but staged state
     * from the damaged index cannot be recovered.
     */
    async rebuildIndexFromHead(): Promise<RepositoryIndexRepairResult> {
        this.assertOperationActive();
        const fs = this.fs.promises || this.fs;
        const startedAt = Date.now();
        log.info('GitManager', 'Git index repair started');
        const indexPath = this.repositoryGitPath('index');
        const lockPath = this.repositoryGitPath('index.lock');
        const health = await this.checkRepositoryIndex();
        if (health.state === 'healthy') {
            throw new Error('The Git index is already healthy; no repair is needed.');
        }

        try {
            await fs.stat(lockPath);
            throw new Error('Git index.lock exists. Another Git operation may be running; try again after it finishes.');
        } catch (error) {
            if (error instanceof Error && error.message.includes('Another Git operation')) throw error;
            if (!isTransientMissingPath(error)) throw error;
        }

        const headOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
        const headCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: headOid });
        const headFiles = await this.readTreeRecursiveAt(this.fs, this.dir, headCommit.commit.tree, '', true);
        const worktreeFiles = await this.readRepairWorktreePaths(fs, new Set(headFiles.keys()));
        const modifiedTrackedFiles: string[] = [];
        const deletedTrackedFiles: string[] = [];
        for (const [filepath, oid] of headFiles) {
            this.assertOperationActive();
            if (!worktreeFiles.has(filepath)) {
                deletedTrackedFiles.push(filepath);
                continue;
            }
            const fullPath = this.dir === '.' ? filepath : `${this.dir}/${filepath}`;
            const value = await fs.readFile(fullPath);
            if ((await git.hashBlob({ object: value })).oid !== oid) {
                modifiedTrackedFiles.push(filepath);
            }
        }
        let backupPath: string | null = null;
        let originalIndex: Uint8Array | null = null;

        try {
            if (await this.indexExists(fs)) {
                const value = await fs.readFile(indexPath);
                originalIndex = value instanceof Uint8Array ? value : new Uint8Array(value);
                backupPath = await this.backupIndex(fs, 'index.obsidian-git-backup');
            }

            // isomorphic-git treats a missing index as an empty staging area,
            // whereas it deliberately rejects a zero-byte index.
            await this.removeIndexIfPresent(fs);

            const existingTrackedFiles = [...headFiles.keys()].filter((filepath) => worktreeFiles.has(filepath));
            if (existingTrackedFiles.length > 0) {
                log.info('GitManager', 'Adding existing tracked files while rebuilding Git index', {
                    files: existingTrackedFiles.length,
                    totalTrackedFiles: headFiles.size,
                });
                await git.add({
                    fs: this.fs,
                    dir: this.dir,
                    filepath: existingTrackedFiles,
                    parallel: true,
                    force: true,
                });
            }

            const pathsToReset = [...modifiedTrackedFiles, ...deletedTrackedFiles];
            let resetCount = 0;
            for (const filepath of pathsToReset) {
                this.assertOperationActive();
                await git.resetIndex({ fs: this.fs, dir: this.dir, filepath, ref: 'HEAD' });
                resetCount += 1;
                if (resetCount % 50 === 0) {
                    await this.yieldToEventLoop();
                }
            }

            await git.listFiles({ fs: this.fs, dir: this.dir });
            await git.statusMatrix({ fs: this.fs, dir: this.dir });
            log.info('GitManager', 'Git index repair completed', {
                trackedFiles: headFiles.size,
                worktreeFiles: worktreeFiles.size,
                modifiedFiles: modifiedTrackedFiles.length,
                deletedFiles: deletedTrackedFiles.length,
                elapsedMs: Date.now() - startedAt,
            });
            return {
                backupPath,
                trackedFiles: headFiles.size,
                worktreeFiles: worktreeFiles.size,
                stagedStateRecovered: false,
            };
        } catch (error) {
            // Do not leave a partially rebuilt index behind if a repair fails.
            await this.removeIndexIfPresent(fs);
            if (originalIndex !== null) {
                await fs.writeFile(indexPath, originalIndex);
            }
            log.error('GitManager', 'Git index rebuild failed; original index restored', error);
            throw error;
        }
    }

    private async readRepairWorktreePaths(fs: any, trackedPaths: Set<string>): Promise<Set<string>> {
        const result = new Set<string>();
        const startedAt = Date.now();
        let examined = 0;
        let missingEntries = 0;

        const hasTrackedDescendant = (directory: string): boolean => {
            const prefix = `${directory}/`;
            for (const trackedPath of trackedPaths) {
                if (trackedPath.startsWith(prefix)) return true;
            }
            return false;
        };

        const isIgnored = async (filepath: string): Promise<boolean> => {
            try {
                return await git.isIgnored({ fs: this.fs, dir: this.dir, filepath });
            } catch (error) {
                // If ignore evaluation is unavailable, retain the file so it is
                // never accidentally omitted from repair accounting.
                log.debug('GitManager', `Could not evaluate ignore rule for ${filepath}`, error);
                return false;
            }
        };

        const walk = async (relativeDir: string): Promise<void> => {
            this.assertOperationActive();
            const lookupPath = relativeDir || (this.dir === '.' ? '.' : this.dir);
            const entries = await fs.readdir(lookupPath, { encoding: 'utf8' }) as string[];
            for (const entry of entries) {
                const filepath = relativeDir ? `${relativeDir}/${entry}` : entry;
                if (isProtectedRepairPath(filepath)) continue;
                const fullPath = this.dir === '.' ? filepath : `${this.dir}/${filepath}`;
                let stat: any;
                try {
                    stat = await fs.stat(fullPath);
                } catch (error) {
                    if (isTransientMissingPath(error)) {
                        // Cloud/mobile vault indexes can briefly retain a path
                        // after its backing file has disappeared. It cannot be
                        // part of the repair if it cannot be stat'ed.
                        missingEntries += 1;
                        log.debug('GitManager', 'Skipping missing worktree entry during index repair scan', {
                            filepath,
                            missingEntries,
                        });
                        continue;
                    }
                    throw error;
                }
                examined += 1;
                if (stat.isDirectory()) {
                    // Ignored directories can be discarded as a whole. Preserve
                    // traversal when HEAD contains a tracked path below one.
                    if (!hasTrackedDescendant(filepath) && await isIgnored(filepath)) continue;
                    await walk(filepath);
                } else if (stat.isFile()) {
                    if (trackedPaths.has(filepath) || !(await isIgnored(filepath))) {
                        result.add(filepath);
                    }
                }
                if (examined % 32 === 0) {
                    log.debug('GitManager', 'Git index repair scanning worktree', {
                        examined,
                        included: result.size,
                        elapsedMs: Date.now() - startedAt,
                    });
                    await this.yieldToEventLoop();
                }
            }
        };

        await walk('');
        log.info('GitManager', 'Git index repair worktree scan completed', {
            examined,
            included: result.size,
            missingEntries,
            elapsedMs: Date.now() - startedAt,
        });
        return result;
    }

    /**
     * Restore the newest non-empty index backup created by a repair.
     * The current index is backed up first so this action remains reversible.
     */
    async restoreLatestIndexBackup(): Promise<string> {
        this.assertOperationActive();
        const fs = this.fs.promises || this.fs;
        const gitDir = this.dir === '.' ? '.git' : `${this.dir}/.git`;
        const entries = await fs.readdir(gitDir, { encoding: 'utf8' });
        const backups = entries
            .filter((entry: string) => /^index\.obsidian-git-backup-\d+$/.test(entry))
            .sort()
            .reverse();
        if (backups.length === 0) throw new Error('No Git index repair backup was found.');

        const backupPath = `${gitDir}/${backups[0]}`;
        const backup = await fs.readFile(backupPath);
        const bytes = backup instanceof Uint8Array ? backup : new Uint8Array(backup);
        if (bytes.byteLength === 0) {
            throw new Error(`The newest Git index backup is empty: ${backups[0]}`);
        }

        let currentIndex: Uint8Array | null = null;
        if (await this.indexExists(fs)) {
            const current = await fs.readFile(this.repositoryGitPath('index'));
            currentIndex = current instanceof Uint8Array ? current : new Uint8Array(current);
            await fs.writeFile(this.repositoryGitPath(`index.obsidian-git-pre-restore-${Date.now()}`), currentIndex);
        }

        try {
            await fs.writeFile(this.repositoryGitPath('index'), bytes);
            await git.listFiles({ fs: this.fs, dir: this.dir });
            log.info('GitManager', `Restored Git index backup ${backups[0]}`);
            return backups[0];
        } catch (error) {
            await this.removeIndexIfPresent(fs);
            if (currentIndex !== null) {
                await fs.writeFile(this.repositoryGitPath('index'), currentIndex);
            }
            throw error;
        }
    }

    /**
     * Build a non-destructive comparison for repairing a repository. Remote
     * objects are fetched into a temporary repository and removed afterwards;
     * the current .git directory and vault files are never replaced here.
     */
    async previewRepositoryRebuild(repoUrl: string, branchName: string): Promise<RepositoryRebuildPreview> {
        this.assertOperationActive();
        const temporaryDir = `${this.dir === '.' ? '.' : this.dir}/.git-sync-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fs = this.fs.promises || this.fs;
        let remoteOid: string | null = null;

        try {
            await fs.mkdir(temporaryDir, { recursive: true });
            await git.init({ fs: this.fs, dir: temporaryDir, defaultBranch: branchName });
            await git.addRemote({
                fs: this.fs,
                dir: temporaryDir,
                remote: 'origin',
                url: normalizeRemoteUrl(repoUrl),
            });

            try {
                await git.fetch({
                    fs: this.fs,
                    http: this.createHttpClient(),
                    dir: temporaryDir,
                    remote: 'origin',
                    ref: branchName,
                    depth: 1,
                    singleBranch: true,
                    onAuth: () => ({
                        username: this.credentials.username,
                        password: this.credentials.password,
                    }),
                });
                remoteOid = await git.resolveRef({
                    fs: this.fs,
                    dir: temporaryDir,
                    ref: `refs/remotes/origin/${branchName}`,
                });
            } catch (error) {
                if (classifyRepositoryError(error) !== 'empty-remote') throw error;
            }

            const localFiles = await this.readLocalFileFingerprints(fs);
            const remoteFiles = new Map<string, string>();
            if (remoteOid) {
                const commit = await git.readCommit({ fs: this.fs, dir: temporaryDir, oid: remoteOid });
                const tree = await this.readTreeRecursiveAt(this.fs, temporaryDir, commit.commit.tree);
                const fingerprints = await this.readTreeFingerprints(this.fs, temporaryDir, tree);
                for (const [filepath, oid] of fingerprints) remoteFiles.set(filepath, oid);
            }

            return {
                branch: branchName,
                remoteOid,
                ...compareRepositoryPaths(localFiles, remoteFiles),
            };
        } finally {
            try {
                await fs.rmdir(temporaryDir, { recursive: true });
            } catch (error) {
                log.warn('GitManager', 'Could not remove temporary repository repair data', error);
            }
        }
    }

    private async readLocalFileFingerprints(fs: any): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        const walk = async (relativeDir: string): Promise<void> => {
            this.assertOperationActive();
            const lookupPath = relativeDir || (this.dir === '.' ? '.' : this.dir);
            const entries = await fs.readdir(lookupPath, { encoding: 'utf8' }) as string[];
            const candidateEntries = entries.filter((entry) => {
                const filepath = relativeDir ? `${relativeDir}/${entry}` : entry;
                return !isProtectedRepairPath(filepath);
            });
            const classifiedEntries: Array<{
                filepath: string;
                fullPath: string;
                isDirectory: boolean;
                isFile: boolean;
            }> = await mapWithConcurrency(candidateEntries, MOBILE_IO_CONCURRENCY, async (entry) => {
                const filepath = relativeDir ? `${relativeDir}/${entry}` : entry;
                const fullPath = this.dir === '.' ? filepath : `${this.dir}/${filepath}`;
                const stat = await fs.stat(fullPath);
                return { filepath, fullPath, isDirectory: stat.isDirectory(), isFile: stat.isFile() };
            });
            const directories = classifiedEntries.filter((entry) => entry.isDirectory);
            const files = classifiedEntries.filter((entry) => entry.isFile);
            const fingerprints = await mapWithConcurrency(files, MOBILE_IO_CONCURRENCY, async ({ filepath, fullPath }) => {
                const value = await fs.readFile(fullPath);
                return [filepath, (await git.hashBlob({ object: value })).oid] as const;
            });
            for (const [filepath, oid] of fingerprints) result.set(filepath, oid);
            for (const entry of directories) await walk(entry.filepath);
        };

        await walk('');
        return result;
    }

    private async readTreeFingerprints(
        fs: any,
        dir: string,
        tree: Map<string, string>,
    ): Promise<Map<string, string>> {
        const entries = await mapWithConcurrency(
            [...tree.entries()],
            MOBILE_IO_CONCURRENCY,
            async ([filepath, blobOid]) => {
                if (isProtectedRepairPath(filepath)) return null;
                const { blob } = await git.readBlob({ fs, dir, oid: blobOid });
                return [filepath, (await git.hashBlob({ object: blob })).oid] as const;
            },
        );
        return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
    }

    /**
     * Get remote commit log (from origin/branch)
     * Falls back to GitHub API if local repo has no fetched origin refs
     */
    async getRemoteLog(branchName: string, maxCount: number = 20): Promise<GitCommit[]> {
        try {
            // Try local origin refs first (if repo exists and has fetched)
            const commits = await git.log({
                fs: this.fs,
                dir: this.dir,
                ref: `origin/${branchName}`,
                depth: maxCount
            });
            return commits.map(c => ({
                oid: c.oid,
                message: c.commit?.message || '',
                author: c.commit?.author?.name || 'Unknown',
                date: new Date((c.commit?.author?.timestamp || 0) * 1000),
                commit: c.commit
            }));
        } catch (error: any) {
            const msg = error.message || String(error);
            if (msg.includes('Could not find') || msg.includes('unknown revision')) {
                log.info('GitManager', `No fetched origin/${branchName} — using GitHub API fallback`);
            } else {
                log.warn('GitManager', `Local origin/${branchName} error, trying GitHub API fallback`, error);
            }
            // Fall back to GitHub API — works even without local repo
            return this.fetchRemoteCommitsViaApi(branchName, maxCount);
        }
    }

    /**
     * Fetch remote commits via GitHub REST API (no local repo required)
     * Static version for use when no GitManager instance exists.
     */
    static async fetchRemoteCommitsFromGitHub(
        repoUrl: string,
        password: string,
        branchName: string,
        maxCount: number = 20
    ): Promise<GitCommit[]> {
        try {
            const repository = parseGitHubRepositoryUrl(repoUrl);
            if (!repository) {
                log.warn('GitManager', 'Cannot fetch remote commits: not a GitHub repo URL');
                return [];
            }

            const { owner, repo } = repository;
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branchName)}&per_page=${maxCount}`;

            log.debug('GitManager', `Fetching commits via GitHub API: ${apiUrl}`);

            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            };

            if (password) {
                headers['Authorization'] = `Bearer ${password}`;
            }

            const response = await requestUrl({
                url: apiUrl,
                method: 'GET',
                headers,
                throw: false
            });

            if (response.status !== 200) {
                log.warn('GitManager', `GitHub API returned ${response.status}`, response.text);
                return [];
            }

            const data = JSON.parse(response.text);
            if (!Array.isArray(data)) {
                log.warn('GitManager', 'GitHub API returned non-array', data);
                return [];
            }

            log.info('GitManager', `Fetched ${data.length} commits from GitHub API for ${owner}/${repo}@${branchName}`);

            return data.map((c: any) => ({
                oid: c.sha || '',
                message: c.commit?.message || '',
                author: c.commit?.author?.name || c.author?.login || 'Unknown',
                date: new Date(c.commit?.author?.date || 0),
                commit: c.commit,
                remote: true as const
            }));
        } catch (error) {
            log.error('GitManager', 'GitHub API commit fetch failed', error);
            return [];
        }
    }

    /**
     * Fetch remote commits via GitHub REST API (instance method, delegates to static)
     */
    private async fetchRemoteCommitsViaApi(branchName: string, maxCount: number = 20): Promise<GitCommit[]> {
        return GitManager.fetchRemoteCommitsFromGitHub(
            this.credentials.repoUrl || '',
            this.credentials.password,
            branchName,
            maxCount
        );
    }

    /**
     * Parse owner/repo from a GitHub repository URL
     */
    private parseGitHubRepoUrl(): { owner: string; repo: string } | null {
        const url = this.credentials.repoUrl;
        if (!url) return null;

        // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
        let match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)(?:\.git)?$/);
        if (match) {
            return { owner: match[1], repo: match[2] };
        }

        // SSH: git@github.com:owner/repo.git
        match = url.match(/git@github\.com:([^\/]+)\/([^\/\.]+)(?:\.git)?$/);
        if (match) {
            return { owner: match[1], repo: match[2] };
        }

        return null;
    }

    /**
     * Check if local repository has any commits
     */
    async hasLocalCommits(): Promise<boolean> {
        try {
            const commits = await git.log({ fs: this.fs, dir: this.dir, ref: 'HEAD', depth: 1 });
            return commits.length > 0;
        } catch (error) {
            log.error('GitManager', 'Pending checkout validation failed', error as Error);
            return false;
        }
    }

    /**
     * Pull changes from the remote repository.
     * For empty repos (no local commits), does a shallow fetch+checkout instead of full pull.
     */
    async pull(branchName: string): Promise<void> {
        try {
            this.assertOperationActive();
            this.updateStatus('Pulling changes...');

            // Ensure remote is configured before pulling
            if (this.credentials.repoUrl) {
                await this.ensureRemote(this.credentials.repoUrl);
            }

            // A previous fetch may have completed before checkout was
            // interrupted. Resume that checkout locally instead of fetching
            // the same branch again.
            if (this.credentials.repoUrl && await this.hasPendingCheckout(this.credentials.repoUrl, branchName, 1)) {
                await this.shallowFetchAndCheckout(branchName);
                return;
            }

            // Check if local repo has any commits
            const hasCommits = await this.hasLocalCommits();

            if (!hasCommits) {
                log.info('GitManager', 'No local commits — doing shallow fetch instead of pull');
                await this.shallowFetchAndCheckout(branchName);
                return;
            }

            const progress = this.createProgress('Pulling from remote');
            const { onProgress, onMessage } = progress;

            // Download timer — git.pull internally does a fetch, which doesn't emit progress during HTTP
            const pullStartTime = Date.now();
            let pullTimer: number | null = null;
            const startPullTimer = () => {
                if (pullTimer) window.clearInterval(pullTimer);
                pullTimer = window.setInterval(() => {
                    const elapsed = ((Date.now() - pullStartTime) / 1000).toFixed(1);
                    onMessage(`Downloading updates... (${elapsed}s elapsed)`);
                }, 1000);
            };
            const stopPullTimer = () => {
                if (pullTimer) { window.clearInterval(pullTimer); pullTimer = null; }
            };

            try {
                startPullTimer();
                
                // Fetch first so an up-to-date branch can finish without the
                // expensive merge/checkout walk. isomorphic-git's pull always
                // invokes checkout, even when FETCH_HEAD equals HEAD, which is
                // especially noticeable on mobile vault adapters.
                await git.fetch({
                    fs: this.fs,
                    http: this.createHttpClient(progress),
                    dir: this.dir,
                    remote: 'origin',
                    ref: branchName,
                    singleBranch: true,
                    onAuth: () => ({
                        username: this.credentials.username,
                        password: this.credentials.password
                    }),
                    onProgress,
                    onMessage
                });

                const [localOid, fetchHead] = await Promise.all([
                    git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/heads/${branchName}` }),
                    git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'FETCH_HEAD' }),
                ]);
                if (localOid === fetchHead) {
                    onMessage('Already up to date');
                } else {
                    await git.merge({
                        fs: this.fs,
                        dir: this.dir,
                        ours: branchName,
                        theirs: fetchHead,
                        fastForward: true,
                        fastForwardOnly: true,
                        author: {
                            name: this.credentials.author.name || 'Obsidian Git',
                            email: this.credentials.author.email || 'obsidian@example.com'
                        },
                        committer: {
                            name: this.credentials.author.name || 'Obsidian Git',
                            email: this.credentials.author.email || 'obsidian@example.com'
                        },
                    });
                    await git.checkout({
                        fs: this.fs,
                        dir: this.dir,
                        ref: branchName,
                        onProgress,
                    });
                }

                stopPullTimer();
                progress.complete();
                this.updateStatus('Pull completed');
            } catch (error) {
                stopPullTimer();
                progress.fail(error);
                throw error;
            }
        } catch (error) {
            log.error('GitManager', 'Failed to pull changes', error as Error);
            this.updateStatus('Pull failed');
            throw error;
        }
    }

    /**
     * Fetch and check out a shallow repository without using git.clone.
     *
     * isomorphic-git removes the git directory when git.clone fails. An
     * explicit init + fetch + checkout sequence preserves the partial .git
     * state, allowing a later Clone Remote retry to reuse it.
     */
    private async shallowFetchAndCheckout(branchName: string): Promise<void> {
        this.assertOperationActive();
        const progress = this.createProgress('Fetching remote files');
        const { onProgress, onMessage } = progress;
        let downloadTimer: number | null = null;
        const startTime = Date.now();

        const startDownloadTimer = () => {
            downloadTimer = window.setInterval(() => {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                onMessage(`Downloading from server... (${elapsed}s elapsed)`);
            }, 1000);
        };
        const stopDownloadTimer = () => {
            if (downloadTimer !== null) window.clearInterval(downloadTimer);
            downloadTimer = null;
        };

        try {
            this.updateStatus('Preparing resumable fetch...');
            onMessage('Preparing resumable fetch...');
            await this.ensureResumableRepository(branchName);
            onMessage('Connecting to remote...');
            const resumeCheckout = this.credentials.repoUrl
                ? await this.hasPendingCheckout(this.credentials.repoUrl, branchName, 1)
                : false;

            if (resumeCheckout) {
                onMessage('Fetch already complete; resuming checkout...');
            } else {
                startDownloadTimer();
                await git.fetch({
                    fs: this.fs,
                    http: this.createHttpClient(progress),
                    dir: this.dir,
                    remote: 'origin',
                    ref: branchName,
                    depth: 1,
                    singleBranch: true,
                    onAuth: () => ({
                        username: this.credentials.username,
                        password: this.credentials.password,
                    }),
                    onProgress: (event: any) => {
                        this.assertProgressActive(progress);
                        onProgress(event);
                    },
                    onMessage: (text: string) => {
                        this.assertProgressActive(progress);
                        onMessage(text);
                    },
                });
                await this.markCheckoutPending(this.credentials.repoUrl || '', branchName, 1);
            }

            stopDownloadTimer();
            onMessage(resumeCheckout ? 'Resuming checkout...' : 'Download complete, processing objects...');
            await this.checkoutFetchedBranch(branchName, progress, onMessage);
            await this.clearPendingCheckout();
            progress.complete();
            this.updateStatus('Repository fetched');
        } catch (error: any) {
            stopDownloadTimer();
            progress.fail(error);
            const msg = error.message || String(error);
            if (msg.includes('Out Of Memory') || msg.includes('out of memory') || msg.includes('OOM') || msg.includes('allocation')) {
                log.error('GitManager', 'Memory exhausted during fetch — repo may be too large for mobile', error);
                throw new Error(
                    `Memory exhausted while downloading repository. The partial Git state was retained for a retry.\n\n` +
                    `Suggestions:\n• Try on desktop first\n• Remove large files (images, videos)\n• Use a smaller repository`,
                );
            }
            if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('Connection reset')) {
                log.error('GitManager', 'Network timeout during fetch', error);
                throw new Error(
                    `Connection timed out while downloading. The partial Git state was retained for a retry.\n\n` +
                    `Try again with a faster connection or smaller repository.`,
                );
            }
            throw error;
        }
    }

    private async ensureResumableRepository(branchName: string): Promise<void> {
        if (!(await this.isRepository())) {
            await git.init({ fs: this.fs, dir: this.dir, defaultBranch: branchName });
        }
        if (this.credentials.repoUrl) await this.ensureRemote(this.credentials.repoUrl);
    }

    private pendingCheckoutPath(): string {
        return `${this.dir}/.git/obsidian-git-sync-checkout.json`;
    }

    /**
     * A marker is written only after fetch has produced a complete local ref.
     * Validate both the ref and its commit object before skipping a retry.
     */
    private async hasPendingCheckout(repoUrl: string, branchName: string, depth: number): Promise<boolean> {
        try {
            const fs = this.fs.promises || this.fs;
            const raw = await fs.readFile(this.pendingCheckoutPath(), { encoding: 'utf8' });
            const state = JSON.parse(String(raw)) as Partial<PendingCheckoutState>;
            if (
                state.version !== 1
                || state.repoUrl !== normalizeRemoteUrl(repoUrl)
                || state.branchName !== branchName
                || state.depth !== depth
                || !state.oid
            ) return false;

            const remoteOid = await git.resolveRef({
                fs: this.fs,
                dir: this.dir,
                ref: `refs/remotes/origin/${branchName}`,
            });
            if (remoteOid !== state.oid) return false;
            await git.readCommit({ fs: this.fs, dir: this.dir, oid: state.oid });
            return true;
        } catch {
            return false;
        }
    }

    private async markCheckoutPending(repoUrl: string, branchName: string, depth: number): Promise<void> {
        const oid = await git.resolveRef({
            fs: this.fs,
            dir: this.dir,
            ref: `refs/remotes/origin/${branchName}`,
        });
        await git.readCommit({ fs: this.fs, dir: this.dir, oid });
        const state: PendingCheckoutState = {
            version: 1,
            repoUrl: normalizeRemoteUrl(repoUrl),
            branchName,
            depth,
            oid,
        };
        const fs = this.fs.promises || this.fs;
        await fs.writeFile(this.pendingCheckoutPath(), JSON.stringify(state), { encoding: 'utf8' });
    }

    private async clearPendingCheckout(): Promise<void> {
        try {
            const fs = this.fs.promises || this.fs;
            await fs.unlink(this.pendingCheckoutPath());
        } catch {
            // Missing recovery metadata is already the desired final state.
        }
    }

    private async checkoutFetchedBranch(
        branchName: string,
        progress: ProgressHandle,
        onMessage: (text: string) => void,
    ): Promise<void> {
        this.assertOperationActive();
        const remoteRef = `refs/remotes/origin/${branchName}`;
        const oid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: remoteRef });
        log.info('GitManager', `Fetched branch tip: ${oid.slice(0, 7)}`);

        await this.assertCheckoutSafe(branchName, oid);

        await git.writeRef({
            fs: this.fs,
            dir: this.dir,
            ref: `refs/heads/${branchName}`,
            value: oid,
            force: true,
        });

        onMessage('Writing files to vault...');
        let bytesWritten = 0;
        this.setWriteProgress((path, bytes) => {
            if (path === '.git' || path.startsWith('.git/')) return;
            bytesWritten += bytes;
            progress.onProgress({
                phase: 'Updating workdir',
                loaded: 0,
                total: 0,
                bytesWritten,
            });
        });
        try {
            await git.checkout({
                fs: this.fs,
                dir: this.dir,
                ref: branchName,
                force: true,
                onProgress: (event: any) => {
                    this.assertProgressActive(progress);
                    progress.onProgress({ ...event, bytesWritten });
                },
            });
        } finally {
            this.setWriteProgress(undefined);
        }

        log.info('GitManager', `Checked out ${branchName} at ${oid.slice(0, 7)}`);
    }

    private async assertCheckoutSafe(branchName: string, remoteOid: string): Promise<void> {
        const fs = this.fs.promises || this.fs;
        const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: remoteOid });
        const remoteTree = await this.readTreeRecursive(commit.commit.tree);
        const remoteFiles = await this.readTreeFingerprints(this.fs, this.dir, remoteTree);
        const localFiles = await this.readLocalFileFingerprints(fs);
        const comparison = compareRepositoryPaths(localFiles, remoteFiles);
        const conflictingPrefixes = [...localFiles.keys()].filter((localPath) =>
            [...remoteFiles.keys()].some((remotePath) =>
                remotePath.startsWith(`${localPath}/`) && !localFiles.has(remotePath),
            ),
        );
        const conflicts = [...new Set([...comparison.conflicts, ...conflictingPrefixes])].sort();
        if (conflicts.length > 0) {
            throw new Error(
                `Clone stopped because existing vault files would be overwritten (${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? ', ...' : ''}). ` +
                `Review the repository rebuild comparison before trying again.`,
            );
        }

        // A directory at a remote file path is also a path conflict, even
        // though directory entries are not included in the file comparison.
        for (const filepath of remoteFiles.keys()) {
            try {
                const stat = await fs.stat(this.dir === '.' ? filepath : `${this.dir}/${filepath}`);
                if (stat.isDirectory()) {
                    throw new Error(
                        `Clone stopped because the existing vault folder "${filepath}" would be replaced by a file. ` +
                        `Review the repository rebuild comparison before trying again.`,
                    );
                }
            } catch (error: any) {
                if (error?.message?.startsWith('Clone stopped')) throw error;
                if (!isTransientMissingPath(error)) throw error;
            }
        }
    }

    /**
     * Clone a repository with resumable progress tracking and shallow depth.
     *
     * This intentionally uses init + fetch + checkout instead of git.clone:
     * isomorphic-git deletes its partial git directory when clone throws.
     */
    async cloneRepository(repoUrl: string, branchName: string, depth: number = 1): Promise<void> {
        this.assertOperationActive();
        const progress = this.createProgress(`Cloning ${branchName}`);
        const { onProgress, onMessage } = progress;
        const startTime = Date.now();
        let cloneTimer: number | null = null;

        try {
            this.updateStatus('Preparing resumable clone...');
            log.info('GitManager', `Cloning ${repoUrl} (branch: ${branchName}, depth: ${depth})`);
            onMessage('Preparing resumable clone...');

            if (!(await this.isRepository())) {
                await git.init({ fs: this.fs, dir: this.dir, defaultBranch: branchName });
            }
            await this.ensureRemote(repoUrl);

            const resumeCheckout = await this.hasPendingCheckout(repoUrl, branchName, depth);
            if (resumeCheckout) {
                onMessage('Fetch already complete; resuming checkout...');
            } else {
                if (typeof window !== 'undefined') {
                    cloneTimer = window.setInterval(() => {
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        onMessage(`Waiting for remote response... (${elapsed}s elapsed)`);
                    }, 1000);
                }

                await git.fetch({
                    fs: this.fs,
                    http: this.createHttpClient(progress),
                    dir: this.dir,
                    remote: 'origin',
                    ref: branchName,
                    singleBranch: true,
                    depth,
                    onAuth: () => ({
                        username: this.credentials.username,
                        password: this.credentials.password
                    }),
                    onProgress: (event: any) => {
                        this.assertProgressActive(progress);
                        onProgress(event);
                    },
                    onMessage: (text: string) => {
                        this.assertProgressActive(progress);
                        onMessage(text);
                    },
                });
                await this.markCheckoutPending(repoUrl, branchName, depth);
            }

            onMessage(resumeCheckout ? 'Resuming checkout...' : 'Fetch complete; checking out files...');
            // Never overwrite pre-existing vault files during an explicit
            // clone. isomorphic-git will stop on a path conflict and retain
            // the fetched metadata for a later, user-approved repair.
            await this.checkoutFetchedBranch(branchName, progress, onMessage);
            await this.clearPendingCheckout();
            progress.complete();
            this.updateStatus('Repository cloned');
            log.info('GitManager', `Repository cloned successfully`);
        } catch (error) {
            progress.fail(error);
            throw error;
        } finally {
            if (cloneTimer !== null) window.clearInterval(cloneTimer);
        }
    }

    /**
     * Add all changes to staging
     */
    async addAll(files?: readonly string[]): Promise<BulkStageResult> {
        try {
            this.assertOperationActive();
            // Always classify the caller's paths against one status snapshot.
            // statusMatrix omits ignored untracked files, so isIgnored() is
            // also required before accepting a stale or hand-supplied path.
            const statusMatrixForStaging = await git.statusMatrix({
                fs: this.fs,
                dir: this.dir,
            }) as GitStatusMatrixRow[];
            const statusByPath = new Map<string, GitStatusMatrixRow>();
            for (const row of statusMatrixForStaging) statusByPath.set(row[0], row);
            const requestedFiles = files
                ? filterAutomaticallyStagedPaths([...new Set(files)])
                : filterAutomaticallyStagedPaths(
                    statusMatrixForStaging
                        .filter((row) => row[1] !== row[2] || row[1] !== row[3])
                        .map((row) => row[0]),
                );
            const filesToStage: string[] = [];
            const failed: Array<{ filepath: string; message: string }> = [];
            for (const filepath of requestedFiles) {
                const row = statusByPath.get(filepath);
                if ((!row || row[1] !== 1) && await this.isIgnoredPath(filepath)) {
                    failed.push({ filepath, message: `Path "${filepath}" is ignored by .gitignore` });
                    continue;
                }
                filesToStage.push(filepath);
            }
            const staged: string[] = [];

            this.updateStatus(filesToStage.length > 0
                ? `Adding ${filesToStage.length} change${filesToStage.length === 1 ? '' : 's'}...`
                : 'No changes to add');

            // isomorphic-git.add() expects a file to exist in the working tree.
            // Build one status snapshot so tracked deletions can use remove()
            // without rescanning the vault once per file.
            const stagedPaths = new Set<string>();

            // Keep going if one file cannot be staged. A single bad file must
            // not make the user lose the progress made on all the other files.
            const stageIndividually = async (file: string): Promise<void> => {
                try {
                    this.assertOperationActive();
                    await this.stagePath(file, statusByPath);
                    stagedPaths.add(file);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    failed.push({ filepath: file, message });
                    log.error('GitManager', `Failed to stage ${file}`, error as Error);
                }
            };

            const presentFiles = filesToStage.filter((file) => {
                const row = statusByPath.get(file);
                return !(row && row[1] === 1 && row[2] === 0);
            });
            const deletedFiles = filesToStage.filter((file) => {
                const row = statusByPath.get(file);
                return Boolean(row && row[1] === 1 && row[2] === 0);
            });

            // isomorphic-git supports adding an array of paths in one index
            // transaction. Use bounded batches so mobile devices get fewer
            // index writes while avoiding an unbounded in-memory workload.
            for (let start = 0; start < presentFiles.length; start += BULK_STAGE_BATCH_SIZE) {
                this.assertOperationActive();
                const batch = presentFiles.slice(start, start + BULK_STAGE_BATCH_SIZE);
                try {
                    await git.add({
                        fs: this.fs,
                        dir: this.dir,
                        filepath: batch,
                        parallel: true,
                    });
                    for (const file of batch) stagedPaths.add(file);
                } catch (error) {
                    // A path may disappear after the status snapshot. Fall
                    // back to the per-file path so one transient failure does
                    // not discard successful staging for the whole batch.
                    log.debug('GitManager', `Bulk staging batch failed; retrying ${batch.length} files individually`, error as Error);
                    for (const file of batch) await stageIndividually(file);
                }
            }

            // remove() currently accepts one filepath and therefore remains
            // per-file. Unlike add(), it does not read the missing worktree
            // file, so tracked deletions still stage without NotFoundError.
            for (const file of deletedFiles) {
                await stageIndividually(file);
            }

            // Never report success solely because git.add() returned. Older
            // isomorphic-git releases can silently skip an ignored path, so
            // confirm the resulting index state from a fresh status matrix.
            if (stagedPaths.size > 0) {
                const finalMatrix = await git.statusMatrix({
                    fs: this.fs,
                    dir: this.dir,
                }) as GitStatusMatrixRow[];
                const finalByPath = new Map(finalMatrix.map((row) => [row[0], row]));
                for (const file of [...stagedPaths]) {
                    const before = statusByPath.get(file);
                    const after = finalByPath.get(file);
                    const deletion = before?.[1] === 1 && before?.[2] === 0;
                    const stagedInIndex = deletion ? after?.[3] === 0 : after?.[3] === 2;
                    if (!stagedInIndex) {
                        stagedPaths.delete(file);
                        failed.push({ filepath: file, message: `Path "${file}" was not written to the Git index` });
                    }
                }
            }

            for (const file of filesToStage) {
                if (stagedPaths.has(file)) staged.push(file);
            }

            const result = { requested: requestedFiles.length, staged, failed };
            this.updateStatus(failed.length > 0
                ? `Staged ${staged.length}; ${failed.length} failed`
                : `Staged ${staged.length} change${staged.length === 1 ? '' : 's'}`);
            return result;
        } catch (error) {
            log.error('GitManager', 'Failed to add changes', error as Error);
            this.updateStatus('Failed to add changes');
            throw error;
        }
    }

    /**
     * Get a list of all changed files
     */
    async getChangedFiles(): Promise<string[]> {
        try {
            const statusMatrix = await git.statusMatrix({
                fs: this.fs,
                dir: this.dir
            });
            
            // Filter for files that have changes
            const changedFiles = statusMatrix
                .filter(row => row[1] !== row[2] || row[1] !== row[3])
                .map(row => row[0]);
            return filterAutomaticallyStagedPaths(changedFiles);
        } catch (error) {
            log.error('GitManager', 'Failed to get changed files', error as Error);
            throw error;
        }
    }

    /**
     * Commit changes with a message
     */
    async commit(message: string): Promise<string> {
        try {
            this.assertOperationActive();
            this.updateStatus('Committing changes...');
            log.debug('GitManager', `Committing changes with message: ${message}`);
            
            const sha = await git.commit({
                fs: this.fs,
                dir: this.dir,
                message,
                author: {
                    name: this.credentials.author.name || 'Obsidian Git Sync',
                    email: this.credentials.author.email || 'obsidian@example.com'
                }
            });
            
            this.updateStatus('Changes committed');
            log.info('GitManager', `Changes committed successfully with SHA: ${sha.slice(0, 7)}`);
            return sha;
        } catch (error) {
            log.error('GitManager', 'Failed to commit changes', error);
            this.updateStatus('Commit failed');
            throw error;
        }
    }

    /**
     * Push changes to the remote repository
     */
    async push(branchName: string, force: boolean = false): Promise<void> {
        let progress: ProgressHandle | null = null;
        try {
            this.assertOperationActive();
            this.updateStatus('Pushing changes...');
            log.debug('GitManager', `Pushing changes to remote branch: ${branchName}`);
            
            // Ensure remote is configured before pushing
            if (this.credentials.repoUrl) {
                await this.ensureRemote(this.credentials.repoUrl);
            }
            
            progress = this.createProgress('Pushing to remote');
            const { onProgress, onMessage } = progress;
            onMessage('Connecting to remote...');
            
            await git.push({
                fs: this.fs,
                http: this.createHttpClient(progress),
                dir: this.dir,
                remote: 'origin',
                ref: branchName,
                force,
                onAuth: () => {
                    log.debug('GitManager', 'Authentication requested for push operation');
                    return {
                        username: this.credentials.username,
                        password: this.credentials.password
                    };
                },
                onProgress,
                onMessage
            });
            onMessage('Confirming branch...');
            // Keep the local comparison ref in sync with a successful push so
            // the next sidebar refresh does not report a stale ahead count.
            try {
                const localOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/heads/${branchName}` });
                await git.writeRef({
                    fs: this.fs,
                    dir: this.dir,
                    ref: `refs/remotes/origin/${branchName}`,
                    value: localOid,
                    force: true,
                });
            } catch (error) {
                log.warn('GitManager', 'Push succeeded but tracking metadata could not be updated', error as Error);
            }
            progress.complete();
            this.updateStatus('Push completed');
            log.info('GitManager', `Successfully pushed changes to remote branch: ${branchName}`);
        } catch (error: any) {
            if (progress) progress.fail(error);
            log.error('GitManager', `Failed to push changes to branch ${branchName}`, error);
            this.updateStatus('Push failed');
            
            // Check for common push errors and provide helpful messages
            if (error.message?.includes('not a fast-forward') || error.message?.includes('rejected')) {
                throw new Error(
                    `Push rejected: The remote has commits that you don't have locally. ` +
                    `Pull first to get the latest changes, then push again. ` +
                    `If this is a first-time push to an empty repo, use Force Push.`
                );
            }
            if (error.message?.includes('auth') || error.message?.includes('401') || error.message?.includes('403')) {
                throw new Error(
                    `Authentication failed. Check your token/username in the plugin settings. ` +
                    `Make sure your PAT has 'Contents: Read and Write' permission.`
                );
            }
            throw error;
        }
    }

    /**
     * Get the current status of the repository
     */
    async getStatus(): Promise<{ branch: string; ahead: number; behind: number; comparison: GitComparisonState; comparisonError?: string; }> {
        try {
            log.debug('GitManager', 'Getting repository status');
            const currentBranch = await git.currentBranch({
                fs: this.fs,
                dir: this.dir,
                fullname: false
            });
            
            if (!currentBranch) {
                log.warn('GitManager', 'Not currently on any branch');
                throw new Error('Not on a branch');
            }
            
            log.debug('GitManager', `Current branch: ${currentBranch}`);
            
            const localRef = `refs/heads/${currentBranch}`;
            const remoteRef = `refs/remotes/origin/${currentBranch}`;
            let localOid: string | null = null;
            try {
                localOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: localRef });
            } catch (error) {
                return {
                    branch: currentBranch,
                    ahead: 0,
                    behind: 0,
                    comparison: 'unavailable',
                    comparisonError: error instanceof Error ? error.message : String(error),
                };
            }
            let remoteOid: string;
            try {
                remoteOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: remoteRef });
            } catch (error) {
                log.info('GitManager', `No tracking ref for ${currentBranch}`);
                if (
                    this.comparisonCache?.branch === currentBranch
                    && this.comparisonCache.localOid === localOid
                    && this.comparisonCache.remoteOid === null
                ) {
                    return this.comparisonCache.result;
                }
                const localCommits = localOid
                    ? await git.log({ fs: this.fs, dir: this.dir, ref: localRef }).catch(() => [])
                    : [];
                const result = {
                    branch: currentBranch,
                    ahead: localCommits.length,
                    behind: 0,
                    comparison: (localOid ? 'local-only' : 'unavailable') as GitComparisonState,
                    comparisonError: error instanceof Error ? error.message : String(error),
                };
                this.comparisonCache = { branch: currentBranch, localOid, remoteOid: null, result };
                return result;
            }

            if (
                this.comparisonCache?.branch === currentBranch
                && this.comparisonCache.localOid === localOid
                && this.comparisonCache.remoteOid === remoteOid
            ) {
                return this.comparisonCache.result;
            }

            // isomorphic-git log does not implement Git's dotted range syntax
            // consistently across releases. Compare the two reachable OID
            // sets instead, which also gives a real diverged state.
            const [localCommits, remoteCommits] = await Promise.all([
                git.log({ fs: this.fs, dir: this.dir, ref: localRef }),
                git.log({ fs: this.fs, dir: this.dir, ref: remoteRef }),
            ]);
            const remoteOids = new Set(remoteCommits.map((commit) => commit.oid));
            const localOids = new Set(localCommits.map((commit) => commit.oid));
            const ahead = localCommits.filter((commit) => !remoteOids.has(commit.oid)).length;
            const behind = remoteCommits.filter((commit) => !localOids.has(commit.oid)).length;
            const comparison: GitComparisonState = ahead > 0 && behind > 0
                ? 'diverged'
                : ahead > 0
                    ? 'ahead'
                    : behind > 0
                        ? 'behind'
                        : 'up-to-date';

            log.info('GitManager', `Repository status: branch=${currentBranch}, ahead=${ahead}, behind=${behind}`);
            const result = { branch: currentBranch, ahead, behind, comparison };
            this.comparisonCache = { branch: currentBranch, localOid, remoteOid, result };
            return result;
        } catch (error) {
            log.error('GitManager', 'Failed to get repository status', error);
            throw error;
        }
    }

    /**
     * Get detailed status of all files (staged, modified, untracked, etc.)
     */
    async getDetailedStatus(): Promise<GitFileStatus[]> {
        try {
            return (await this.readStatusSnapshot()).detailedStatus;
        } catch (error: any) {
            log.error('GitManager', 'Failed to get detailed status', error);
            // Check if this is the known pack index issue
            if (error.message?.includes("Cannot read properties of null") ||
                error.stack?.includes("BufferCursor.slice") ||
                error.stack?.includes("GitPackIndex")) {
                const packErr = new Error(
                    'Pack index reading failed. This is a known issue with isomorphic-git reading certain pack files. ' +
                    'Check the Obsidian console for [ObsidianFsAdapter] warnings to see which file failed.'
                );
                (packErr as any).isPackIndexError = true;
                throw packErr;
            }
            throw error;
        }
    }

    /**
     * Get status groups: staged and unstaged file lists
     * A file that is both staged AND modified appears only in staged.
     */
    async getStatusGroups(): Promise<{ staged: string[]; unstaged: string[] }> {
        try {
            const snapshot = await this.readStatusSnapshot();
            return { staged: snapshot.staged, unstaged: snapshot.unstaged };
        } catch (error: any) {
            log.error('GitManager', 'Failed to get status groups', error);
            throw error;
        }
    }

    /**
     * Read the complete working-tree status once and derive every sidebar
     * representation from the same status matrix.
     */
    async getSidebarStatusSnapshot(): Promise<GitSidebarStatusSnapshot> {
        const repositoryStatusPromise = this.getStatus().then((status) => ({
            ...status,
            repositoryStatusAvailable: true,
        })).catch((error) => {
            // Branch comparison is useful for the header but must not hide a
            // working-tree status that was read successfully. A missing remote
            // ref or damaged branch metadata is reported honestly in the UI.
            log.warn('GitManager', 'Repository comparison unavailable; continuing with file status', error);
            return {
                branch: 'local',
                ahead: 0,
                behind: 0,
                comparison: 'unavailable' as const,
                comparisonError: error instanceof Error ? error.message : String(error),
                repositoryStatusAvailable: false,
            };
        });
        const [repositoryStatus, fileStatus] = await Promise.all([
            repositoryStatusPromise,
            this.readStatusSnapshot(),
        ]);
        return { ...repositoryStatus, ...fileStatus };
    }

    private async readStatusSnapshot(): Promise<Pick<GitSidebarStatusSnapshot, 'detailedStatus' | 'staged' | 'unstaged'>> {
        let matrix: any[] | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
                break;
            } catch (error) {
                lastError = error;
                if (!isTransientMissingPath(error) || attempt === 2) throw error;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        if (!matrix) throw lastError instanceof Error ? lastError : new Error('Unable to read repository status');
        const detailedStatus: GitFileStatus[] = [];
        const staged: string[] = [];
        const unstaged: string[] = [];

        for (const row of matrix) {
            const [filepath, head, workdir, stage] = row;
            if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged

            // head: 0=absent, 1=same as HEAD, 2=different from HEAD
            // workdir: 0=absent, 1=same as HEAD, 2=different from HEAD
            // stage: 0=absent, 1=same as HEAD, 2=different from HEAD, 3=untracked
            let status: GitFileStatus['status'];
            if (head === 0 && workdir === 2 && stage === 0) status = 'untracked';
            else if (head === 0 && (stage === 2 || stage === 3)) status = 'added';
            else if (workdir === 0) status = 'deleted';
            else if (head === 1 && workdir === 2 && stage === 1) status = 'modified';
            else if (head === 1 && workdir === 1 && stage === 2) status = 'staged';
            else if (head === 1 && workdir === 2 && stage === 2) status = 'staged'; // staged + modified → show as staged
            else status = 'modified';

            detailedStatus.push({ filepath, status });

            // A tracked deletion is represented by stage=0 after it has been
            // removed from the index. Distinguish that from an untracked path
            // (head=0, stage=0), which must remain unstaged.
            const hasStagedChanges = (head === 1 && stage === 0) || (stage !== 1 && stage !== 0);
            const hasWorkdirChanges = workdir !== 1;
            if (hasStagedChanges) staged.push(filepath);
            if (hasWorkdirChanges && !hasStagedChanges) unstaged.push(filepath);
        }

        return { detailedStatus, staged, unstaged };
    }

    /**
     * Stage a single file
     */
    async stageFile(filepath: string): Promise<void> {
        try {
            this.assertOperationActive();
            await this.stagePath(filepath);
            log.debug('GitManager', `Staged file: ${filepath}`);
        } catch (error) {
            log.error('GitManager', `Failed to stage file: ${filepath}`, error);
            throw error;
        }
    }

    /**
     * Stage a path, including tracked paths that have been deleted locally.
     * isomorphic-git.add() reads the working-tree file and therefore throws
     * NotFoundError for a tracked deletion. remove() updates only the index,
     * which is exactly what staging that deletion requires.
     */
    private async stagePath(
        filepath: string,
        statusByPath?: ReadonlyMap<string, GitStatusMatrixRow>,
    ): Promise<void> {
        let row = statusByPath?.get(filepath);
        if (!row) {
            // A direct single-file stage must not scan the entire vault. The
            // index tells us whether the path is tracked; only the requested
            // worktree path needs a targeted stat so tracked deletions can use
            // remove() without asking isomorphic-git to read a missing file.
            const trackedPaths = await git.listFiles({
                fs: this.fs,
                dir: this.dir,
            });
            const tracked = trackedPaths.includes(filepath);

            if (tracked) {
                try {
                    await this.fs.stat(this.dir === '.' ? filepath : `${this.dir}/${filepath}`);
                } catch (error) {
                    if (isTransientMissingPath(error)) {
                        await git.remove({ fs: this.fs, dir: this.dir, filepath });
                        return;
                    }
                    throw error;
                }

                await git.add({ fs: this.fs, dir: this.dir, filepath });
                return;
            }

            if (await this.isIgnoredPath(filepath)) {
                throw new Error(`Path "${filepath}" is ignored by .gitignore`);
            }

            await git.add({ fs: this.fs, dir: this.dir, filepath });
            return;
        }

        if (row && row[1] === 1 && row[2] === 0) {
            await git.remove({ fs: this.fs, dir: this.dir, filepath });
            return;
        }

        if ((!row || row[1] !== 1) && await this.isIgnoredPath(filepath)) {
            throw new Error(`Path "${filepath}" is ignored by .gitignore`);
        }
        await git.add({ fs: this.fs, dir: this.dir, filepath });
    }

    /**
     * Ask isomorphic-git for ignore semantics at the staging boundary. A
     * missing .gitignore is a normal non-ignored result; other read failures
     * are logged and left to git.add() to report with its original error.
     */
    private async isIgnoredPath(filepath: string): Promise<boolean> {
        try {
            return await git.isIgnored({ fs: this.fs, dir: this.dir, filepath });
        } catch (error) {
            log.debug('GitManager', `Unable to evaluate .gitignore for ${filepath}`, error as Error);
            return false;
        }
    }

    /**
     * Unstage a single file (reset to HEAD, or remove from index for new files)
     */
    async unstageFile(filepath: string): Promise<void> {
        try {
            this.assertOperationActive();
            // Try resetIndex if available (newer isomorphic-git versions)
            // IMPORTANT: do NOT pass ref: 'HEAD' explicitly — if HEAD doesn't exist
            // (fresh repo, no commits), isomorphic-git throws when ref is explicit,
            // but gracefully skips when ref is omitted (defaults to HEAD internally).
            if ((git as any).resetIndex) {
                await (git as any).resetIndex({ fs: this.fs, dir: this.dir, filepath });
                log.debug('GitManager', `Unstaged file: ${filepath}`);
                return;
            }
            
            // Fallback: check if file exists in HEAD first
            try {
                const { blob } = await git.readBlob({
                    fs: this.fs,
                    dir: this.dir,
                    oid: 'HEAD',
                    filepath
                });
                await this.fs.promises.writeFile(this.dir + '/' + filepath, blob);
                log.debug('GitManager', `Unstaged file (HEAD fallback): ${filepath}`);
            } catch (headErr: any) {
                // File not in HEAD — it's a new file. Without resetIndex we can't
                // properly remove it from the index. Log and skip.
                log.warn('GitManager', `Cannot unstage new file ${filepath}: resetIndex not available and file not in HEAD`);
                // Re-throw with a clearer message so UI can show it
                throw new Error(`Cannot unstage new file "${filepath}". Please upgrade isomorphic-git or use git CLI.`);
            }
        } catch (error: any) {
            log.error('GitManager', `Failed to unstage file: ${filepath}`, error);
            throw error;
        }
    }

    /**
     * Unstage all staged files
     */
    async unstageAll(): Promise<BulkUnstageResult> {
        try {
            this.assertOperationActive();
            const matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            const requested: string[] = [];
            const unstaged: string[] = [];
            const failed: Array<{ filepath: string; message: string }> = [];
            
            for (const row of matrix) {
                this.assertOperationActive();
                const [filepath, head, workdir, stage] = row;
                if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
                
                const hasStagedChanges = stage !== 1 && stage !== 0;
                if (hasStagedChanges) {
                    requested.push(filepath);
                    try {
                        await this.unstageFile(filepath);
                        unstaged.push(filepath);
                    } catch (err: any) {
                        const message = err instanceof Error ? err.message : String(err);
                        failed.push({ filepath, message });
                        log.warn('GitManager', `Failed to unstage ${filepath}: ${err.message}`);
                    }
                }
            }
            
            log.debug('GitManager', `Unstaged ${unstaged.length} files, ${failed.length} failed`);
            if (failed.length > 0 && unstaged.length === 0) {
                throw new Error(`Could not unstage ${failed.length} file(s). resetIndex may not be available.`);
            }
            return { requested: requested.length, unstaged, failed };
        } catch (error: any) {
            log.error('GitManager', 'Failed to unstage all files', error);
            throw error;
        }
    }

    /**
     * Get list of files changed in a specific commit (compared to its parent).
     * 
     * For shallow clones, the commit may not exist locally. This method gracefully
     * handles that by returning an empty array and logging a warning (not error).
     */
    async getCommitFiles(oid: string): Promise<{ filepath: string; status: 'added' | 'modified' | 'deleted' }[]> {
        try {
            const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid });
            const treeOid = commit.commit.tree;
            const parentOid = commit.commit?.parent?.[0];

            let parentFiles: Map<string, string> = new Map();
            if (parentOid) {
                const parentCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: parentOid });
                parentFiles = await this.readTreeRecursive(parentCommit.commit.tree);
            }

            const currentFiles = await this.readTreeRecursive(treeOid);
            const result: { filepath: string; status: 'added' | 'modified' | 'deleted' }[] = [];

            for (const [path, oid] of currentFiles.entries()) {
                if (!parentFiles.has(path)) {
                    result.push({ filepath: path, status: 'added' });
                } else if (parentFiles.get(path) !== oid) {
                    result.push({ filepath: path, status: 'modified' });
                }
            }

            for (const [path] of parentFiles.entries()) {
                if (!currentFiles.has(path)) {
                    result.push({ filepath: path, status: 'deleted' });
                }
            }

            return result.sort((a, b) => a.filepath.localeCompare(b.filepath));
        } catch (error: any) {
            const msg = error?.message || String(error);
            // A shallow clone commonly lacks a remote commit's parent. The
            // sidebar has a GitHub fallback, so keep this expected condition
            // in the activity log without turning it into a visible notice.
            if (msg.includes('Could not find') || msg.includes('not found')) {
                log.debug('GitManager', `Commit ${oid.slice(0, 7)} not found locally; shallow-history fallback may be needed`, msg);
            } else {
                log.error('GitManager', `Failed to get commit files for ${oid.slice(0, 7)}`, error);
            }
            return [];
        }
    }

    /**
     * Fetch commit file changes from GitHub API.
     * Useful for remote commits that don't exist in a shallow local clone.
     * Returns same format as getCommitFiles() for consistency.
     */
    static async fetchCommitFilesFromGitHub(
        repoUrl: string,
        token: string | undefined,
        ref: string
    ): Promise<{ filepath: string; status: 'added' | 'modified' | 'deleted' }[] | null> {
        try {
            const repository = parseGitHubRepositoryUrl(repoUrl);
            if (!repository) {
                log.warn('GitManager', 'Cannot fetch commit files: not a GitHub URL', repoUrl);
                return null;
            }
            const { owner, repo } = repository;
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
            
            log.debug('GitManager', `Fetching commit files from GitHub API: ${apiUrl}`);
            
            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await requestUrl({ url: apiUrl, method: 'GET', headers, throw: false });
            if (response.status !== 200) {
                log.warn('GitManager', `GitHub API commit fetch returned ${response.status}`, response.text);
                return null;
            }

            const data = JSON.parse(response.text);
            if (!data.files || !Array.isArray(data.files)) {
                log.warn('GitManager', 'GitHub API commit response missing files', data);
                return null;
            }
            
            const statusMap: Record<string, 'added' | 'modified' | 'deleted'> = {
                'added': 'added',
                'modified': 'modified',
                'removed': 'deleted',
                'renamed': 'modified',
            };
            
            const files = data.files
                .map((f: any) => ({
                    filepath: f.filename || f.previous_filename || 'unknown',
                    status: statusMap[f.status] || 'modified'
                }))
                .sort((a: any, b: any) => a.filepath.localeCompare(b.filepath));
            
            log.info('GitManager', `Fetched ${files.length} files for commit ${ref.slice(0, 7)} from GitHub API`);
            return files;
        } catch (error) {
            log.warn('GitManager', `GitHub API commit file fetch failed for ${ref.slice(0, 7)}`, error);
            return null;
        }
    }

    /**
     * Recursively read a git tree and return a flat map of path -> oid
     */
    private async readTreeRecursive(treeOid: string, prefix: string = ''): Promise<Map<string, string>> {
        return this.readTreeRecursiveAt(this.fs, this.dir, treeOid, prefix);
    }

    private async readTreeRecursiveAt(
        fs: any,
        dir: string,
        treeOid: string,
        prefix: string = '',
        strict: boolean = false,
    ): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        try {
            const tree = await git.readTree({ fs, dir, oid: treeOid });
            for (const entry of tree.tree) {
                const fullPath = prefix + entry.path;
                if (entry.type === 'tree') {
                    const subMap = await this.readTreeRecursiveAt(fs, dir, entry.oid, fullPath + '/', strict);
                    for (const [subPath, subOid] of subMap.entries()) {
                        result.set(subPath, subOid);
                    }
                } else {
                    result.set(fullPath, entry.oid);
                }
            }
        } catch (e) {
            log.warn('GitManager', `Failed to read tree ${treeOid.slice(0, 7)}`, e);
            if (strict) throw e;
        }
        return result;
    }

    /**
     * Get commit log (history)
     */
    async getLog(maxCount: number = 20): Promise<GitCommit[]> {
        try {
            const commits = await git.log({ fs: this.fs, dir: this.dir, ref: 'HEAD', depth: maxCount });
            return commits.map(c => ({
                oid: c.oid,
                message: c.commit?.message || '',
                author: c.commit?.author?.name || 'Unknown',
                date: new Date((c.commit?.author?.timestamp || 0) * 1000),
                commit: c.commit
            }));
        } catch (error: any) {
            const msg = error.message || String(error);
            if (msg.includes('Could not find') || msg.includes('unknown revision') || msg.includes('Not a valid')) {
                log.info('GitManager', 'No commits in repository yet');
                return [];
            }
            log.error('GitManager', 'Failed to get commit log', error);
            throw error;
        }
    }

    /**
     * Get the current branch name
     */
    async getCurrentBranch(): Promise<string> {
        try {
            const branch = await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: false });
            return branch || 'HEAD';
        } catch (error) {
            log.error('GitManager', 'Failed to get current branch', error);
            throw error;
        }
    }

    /**
     * Detect if a directory contains a git repository (.git exists)
     */
    static async hasGitRepo(fs: any, dir: string): Promise<boolean> {
        try {
            const gitDir = dir + '/.git';
            const stat = await fs.promises.stat(gitDir);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Initialize from an existing local repo (no remote URL needed)
     * Creates an empty repo in LightningFS if one doesn't exist
     */
    async initLocal(): Promise<void> {
        try {
            this.assertOperationActive();
            // Check if .git exists in LightningFS
            const hasVirtualRepo = await GitManager.hasGitRepo(this.fs, this.dir);
            
            if (!hasVirtualRepo) {
                // Initialize an empty repo in the virtual filesystem
                await git.init({ fs: this.fs, dir: this.dir, defaultBranch: 'main' });
                log.info('GitManager', `Initialized empty local repo at ${this.dir}`);
            } else {
                // Just verify it's a valid git repo by reading the current branch
                await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: false });
                log.info('GitManager', `Initialized local repo at ${this.dir}`);
            }
        } catch (error) {
            log.error('GitManager', 'Failed to initialize local repo', error);
            throw error;
        }
    }

    /**
     * Perform a full sync operation: pull, add, commit, push
     * If repoUrl is empty, only does local commit (no push)
     */
    async sync(repoUrl: string, branchName: string, commitMessage: string): Promise<void> {
        try {
            this.assertOperationActive();
            log.info('GitManager', `Starting sync operation with repo: ${repoUrl || '(local only)'}, branch: ${branchName}`);
            
            if (!(await this.isRepository())) {
                throw new Error('No local git repository found. Initialize or clone the vault first.');
            }
            
            // Pull changes first (only if remote URL is set)
            if (repoUrl) {
                log.debug('GitManager', 'Pulling latest changes before committing');
                await this.pull(branchName);
            }
            
            // Check if there are changes to commit
            log.debug('GitManager', 'Checking for local changes');
            const changedFiles = await this.getChangedFiles();
            log.info('GitManager', `Found ${changedFiles.length} changed files`);
            
            if (changedFiles.length > 0) {
                log.debug('GitManager', `Changed files: ${changedFiles.join(', ')}`);
                
                // Add the same snapshot that was checked above. If one file
                // fails, do not commit a partial automatic sync.
                const stageResult = await this.addAll(changedFiles);
                if (stageResult.failed.length > 0) {
                    throw new Error(
                        `Could not stage ${stageResult.failed.length} of ${stageResult.requested} changed file(s).`
                    );
                }
                
                // Commit changes
                await this.commit(commitMessage);
                
                // Push changes (only if remote URL is set)
                if (repoUrl) {
                    await this.push(branchName);
                    log.info('GitManager', `Sync completed with ${changedFiles.length} files updated`);
                    new Notice(`Git sync completed: ${changedFiles.length} files updated`);
                } else {
                    log.info('GitManager', `Local commit completed: ${changedFiles.length} files`);
                    new Notice(`Local commit: ${changedFiles.length} files`);
                }
            } else {
                log.info('GitManager', 'Sync completed: No changes to commit');
                new Notice('Git sync: No changes to commit');
            }
            
            this.updateStatus('Ready');
        } catch (error) {
            log.error('GitManager', 'Sync operation failed', error);
            this.updateStatus('Sync failed');
            throw error;
        }
    }
}
