import * as git from 'isomorphic-git';
import { requestUrl, RequestUrlResponse } from 'obsidian';
import { log } from './logger';

/**
 * Git HTTP client using Obsidian's requestUrl API.
 *
 * requestUrl runs at the native level (Capacitor bridge), bypassing CORS
 * restrictions entirely. This works on both desktop and mobile without
 * requiring any proxy server.
 */
class GitHttpClient {
  private credentials: GitCredentials;

  constructor(credentials: GitCredentials) {
    this.credentials = credentials;
  }

  async request(config: any) {
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
      body = await this.collectBody(config.body);
    }

    try {
      const response: RequestUrlResponse = await requestUrl({
        url: config.url,
        method: config.method || 'GET',
        headers,
        body,
        throw: false, // Don't throw on 4xx/5xx — let isomorphic-git handle Git errors
      });

      log.debug('GitHttpClient', `Response status: ${response.status}`);

      // Convert Obsidian response to isomorphic-git expected format
      return {
        url: config.url,
        method: config.method || 'GET',
        statusCode: response.status,
        statusMessage: this.getStatusMessage(response.status),
        body: this.toAsyncIterator(response.arrayBuffer),
        headers: response.headers,
      };
    } catch (error: any) {
      log.error('GitHttpClient', `Request failed: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Collect an async iterable of Uint8Arrays into a single ArrayBuffer
   */
  private async collectBody(body: AsyncIterable<Uint8Array>): Promise<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
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

  /**
   * Convert an ArrayBuffer into an async iterator of Uint8Arrays
   * (isomorphic-git expects body as an async iterable)
   */
  private toAsyncIterator(arrayBuffer: ArrayBuffer): AsyncIterable<Uint8Array> {
    return {
      [Symbol.asyncIterator]: async function* () {
        yield new Uint8Array(arrayBuffer);
      },
    };
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
import { Notice } from 'obsidian';

export interface GitFileStatus {
    filepath: string;
    status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'conflict';
}

export interface GitCommit {
    oid: string;
    message: string;
    author: string;
    date: Date;
    commit: any;
}

export interface GitCredentials {
    username: string;
    password: string;
    repoUrl?: string;
    author: {
        name: string;
        email: string;
    };
}

export class GitManager {
    private fs: any;
    private dir: string;
    private credentials: GitCredentials;
    private statusBarItem: HTMLElement | null = null;

    constructor(fs: any, dir: string, credentials: GitCredentials, statusBarItem?: HTMLElement) {
        this.fs = fs;
        this.dir = dir;
        this.credentials = credentials;
        this.statusBarItem = statusBarItem || null;
    }

    /**
     * Update the Git credentials
     */
    updateCredentials(credentials: GitCredentials): void {
        this.credentials = credentials;
        log.debug('GitManager', 'Credentials updated');
    }

    private updateStatus(message: string) {
        if (this.statusBarItem) {
            this.statusBarItem.setText(`Git: ${message}`);
        }
        log.info('GitManager', message);
    }

    /**
     * Initialize a new repository or check if one exists
     */
    /**
     * Ensure the 'origin' remote is configured with the given URL
     */
    async ensureRemote(repoUrl: string): Promise<void> {
        try {
            const remotes = await git.listRemotes({ fs: this.fs, dir: this.dir });
            const hasOrigin = remotes.some((r: any) => r.remote === 'origin');
            
            if (!hasOrigin) {
                log.info('GitManager', `Adding remote 'origin' -> ${repoUrl}`);
                await git.addRemote({ fs: this.fs, dir: this.dir, remote: 'origin', url: repoUrl });
            } else {
                // Optionally update URL if it changed
                const origin = remotes.find((r: any) => r.remote === 'origin');
                if (origin && origin.url !== repoUrl) {
                    log.info('GitManager', `Updating remote 'origin' URL: ${origin.url} -> ${repoUrl}`);
                    await git.deleteRemote({ fs: this.fs, dir: this.dir, remote: 'origin' });
                    await git.addRemote({ fs: this.fs, dir: this.dir, remote: 'origin', url: repoUrl });
                }
            }
        } catch (error) {
            log.error('GitManager', 'Failed to ensure remote', error);
            throw error;
        }
    }

    async initializeRepo(repoUrl: string, branchName: string): Promise<boolean> {
        try {
            log.debug('GitManager', `Initializing repository: ${repoUrl}, branch: ${branchName}`);
            // Check if .git directory exists
            const isRepo = await this.isRepository();
            
            if (!isRepo) {
                // Try to clone first, but if remote is empty, fall back to local init
                try {
                    this.updateStatus('Cloning repository...');
                    log.info('GitManager', `Cloning repository from ${repoUrl} (branch: ${branchName})`);
                    
                    await git.clone({
                        fs: this.fs,
                        http: new GitHttpClient(this.credentials),
                        dir: this.dir,
                        url: repoUrl,
                        ref: branchName,
                        singleBranch: true,
                        depth: 1,
                        onAuth: () => {
                            log.debug('GitManager', 'Authentication requested by remote');
                            return {
                                username: this.credentials.username,
                                password: this.credentials.password
                            };
                        }
                    });
                    
                    this.updateStatus('Repository cloned');
                    log.info('GitManager', `Repository successfully cloned to ${this.dir}`);
                    return true;
                } catch (cloneError: any) {
                    // If clone fails because remote is empty, initialize locally instead
                    log.warn('GitManager', `Clone failed, initializing locally: ${cloneError.message}`);
                    
                    this.updateStatus('Initializing local repository...');
                    log.info('GitManager', `Initializing empty repo at ${this.dir}`);
                    
                    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: branchName });
                    await this.ensureRemote(repoUrl);
                    
                    this.updateStatus('Local repository initialized');
                    log.info('GitManager', `Local repo initialized, remote configured: ${repoUrl}`);
                    return true;
                }
            }
            
            // If repository exists locally, ensure remote is configured
            if (repoUrl) {
                await this.ensureRemote(repoUrl);
            }
            
            // Validate the remote URL by attempting to list the remote refs
            this.updateStatus('Validating repository...');
            log.debug('GitManager', `Validating remote repository URL: ${repoUrl}`);
            
            await git.listServerRefs({
                http: new GitHttpClient(this.credentials),
                url: repoUrl,
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
            // Use a dummy file path — findRoot expects a file, not a directory
            // It will walk up the tree looking for .git
            await git.findRoot({ fs: this.fs, filepath: 'dummy.txt' });
            log.debug('GitManager', `Local Git repository found`);
            return true;
        } catch (error) {
            log.debug('GitManager', `No local Git repository found`);
            return false;
        }
    }

    /**
     * Pull changes from the remote repository
     */
    async pull(branchName: string): Promise<void> {
        try {
            this.updateStatus('Pulling changes...');
            
            // Ensure remote is configured before pulling
            if (this.credentials.repoUrl) {
                await this.ensureRemote(this.credentials.repoUrl);
            }
            
            await git.pull({
                fs: this.fs,
                http: new GitHttpClient(this.credentials),
                dir: this.dir,
                ref: branchName,
                singleBranch: true,
                fastForwardOnly: true,
                author: {
                    name: this.credentials.author.name || 'Obsidian Git',
                    email: this.credentials.author.email || 'obsidian@example.com'
                },
                onAuth: () => ({
                    username: this.credentials.username,
                    password: this.credentials.password
                })
            });
            
            this.updateStatus('Pull completed');
        } catch (error) {
            console.error('Failed to pull changes:', error);
            this.updateStatus('Pull failed');
            throw error;
        }
    }

    /**
     * Add all changes to staging
     */
    async addAll(): Promise<void> {
        try {
            this.updateStatus('Adding changes...');
            
            // Get all files in the directory
            const files = await this.getChangedFiles();
            
            // Add each file to staging
            for (const file of files) {
                await git.add({
                    fs: this.fs,
                    dir: this.dir,
                    filepath: file
                });
            }
            
            this.updateStatus('Changes added');
        } catch (error) {
            console.error('Failed to add changes:', error);
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
            return statusMatrix
                .filter(row => row[1] !== row[2] || row[1] !== row[3])
                .map(row => row[0]);
        } catch (error) {
            console.error('Failed to get changed files:', error);
            throw error;
        }
    }

    /**
     * Commit changes with a message
     */
    async commit(message: string): Promise<string> {
        try {
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
        try {
            this.updateStatus('Pushing changes...');
            log.debug('GitManager', `Pushing changes to remote branch: ${branchName}`);
            
            // Ensure remote is configured before pushing
            if (this.credentials.repoUrl) {
                await this.ensureRemote(this.credentials.repoUrl);
            }
            
            await git.push({
                fs: this.fs,
                http: new GitHttpClient(this.credentials),
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
                }
            });
            
            this.updateStatus('Push completed');
            log.info('GitManager', `Successfully pushed changes to remote branch: ${branchName}`);
        } catch (error: any) {
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
    async getStatus(): Promise<{ branch: string; ahead: number; behind: number; }> {
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
            
            // Get ahead/behind counts
            const [ahead, behind] = await Promise.all([
                git.log({
                    fs: this.fs,
                    dir: this.dir,
                    ref: `origin/${currentBranch}..${currentBranch}`
                }).then(commits => commits.length).catch(() => 0),
                git.log({
                    fs: this.fs,
                    dir: this.dir,
                    ref: `${currentBranch}..origin/${currentBranch}`
                }).then(commits => commits.length).catch(() => 0)
            ]);
            
            log.info('GitManager', `Repository status: branch=${currentBranch}, ahead=${ahead}, behind=${behind}`);
            
            return {
                branch: currentBranch,
                ahead,
                behind
            };
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
            const matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            const result: GitFileStatus[] = [];
            
            for (const row of matrix) {
                const [filepath, head, workdir, stage] = row;
                // head: 0=absent, 1=same as HEAD, 2=different from HEAD
                // workdir: 0=absent, 1=same as HEAD, 2=different from HEAD
                // stage: 0=absent, 1=same as HEAD, 2=different from HEAD, 3=untracked
                
                if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
                
                let status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'conflict';
                if (head === 0 && workdir === 2 && stage === 0) status = 'untracked';
                else if (head === 0 && (stage === 2 || stage === 3)) status = 'added';
                else if (workdir === 0) status = 'deleted';
                else if (head === 1 && workdir === 2 && stage === 1) status = 'modified';
                else if (head === 1 && workdir === 1 && stage === 2) status = 'staged';
                else if (head === 1 && workdir === 2 && stage === 2) status = 'staged'; // staged + modified → show as staged
                else status = 'modified';
                
                result.push({ filepath, status });
            }
            return result;
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
            const matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            const staged: string[] = [];
            const unstaged: string[] = [];
            
            for (const row of matrix) {
                const [filepath, head, workdir, stage] = row;
                if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
                
                const hasStagedChanges = stage !== 1 && stage !== 0;
                const hasWorkdirChanges = workdir !== 1;
                
                if (hasStagedChanges) {
                    staged.push(filepath);
                }
                if (hasWorkdirChanges && !hasStagedChanges) {
                    unstaged.push(filepath);
                }
            }
            
            return { staged, unstaged };
        } catch (error: any) {
            log.error('GitManager', 'Failed to get status groups', error);
            throw error;
        }
    }

    /**
     * Stage a single file
     */
    async stageFile(filepath: string): Promise<void> {
        try {
            await git.add({ fs: this.fs, dir: this.dir, filepath });
            log.debug('GitManager', `Staged file: ${filepath}`);
        } catch (error) {
            log.error('GitManager', `Failed to stage file: ${filepath}`, error);
            throw error;
        }
    }

    /**
     * Unstage a single file (reset to HEAD, or remove from index for new files)
     */
    async unstageFile(filepath: string): Promise<void> {
        try {
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
    async unstageAll(): Promise<void> {
        try {
            const matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
            let successCount = 0;
            let failCount = 0;
            
            for (const row of matrix) {
                const [filepath, head, workdir, stage] = row;
                if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
                
                const hasStagedChanges = stage !== 1 && stage !== 0;
                if (hasStagedChanges) {
                    try {
                        await this.unstageFile(filepath);
                        successCount++;
                    } catch (err: any) {
                        failCount++;
                        log.warn('GitManager', `Failed to unstage ${filepath}: ${err.message}`);
                    }
                }
            }
            
            log.debug('GitManager', `Unstaged ${successCount} files, ${failCount} failed`);
            if (failCount > 0 && successCount === 0) {
                throw new Error(`Could not unstage ${failCount} file(s). resetIndex may not be available.`);
            }
        } catch (error: any) {
            log.error('GitManager', 'Failed to unstage all files', error);
            throw error;
        }
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
        } catch (error) {
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
            log.info('GitManager', `Starting sync operation with repo: ${repoUrl || '(local only)'}, branch: ${branchName}`);
            
            // Initialize or check repository
            await this.initializeRepo(repoUrl, branchName);
            
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
                
                // Add all changes
                await this.addAll();
                
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