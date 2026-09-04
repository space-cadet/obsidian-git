import { DataAdapter, requestUrl } from 'obsidian';
import { ObsidianFsAdapter } from '../adapters/ObsidianFsAdapter';
import { GitBackend } from './gitBackend';
import { GitHubApi } from './githubApi';
import { GitHubDeviceAuth, GitHubAuthSession, StaticCredentialProvider } from './githubAuth';
import { GitCredential, GitBackendConfig, RepositoryStatus } from './types';

export interface ObsidianGitCredentials {
  username: string;
  password: string;
  repoUrl?: string;
  author: { name: string; email: string };
  source?: 'pat' | 'github' | 'none';
}

export interface GitFileStatus {
  filepath: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged' | 'conflict';
}

export interface GitSidebarStatusSnapshot {
  branch: string;
  ahead: number;
  behind: number;
  comparison: RepositoryStatus['comparison'];
  comparisonError?: string;
  repositoryStatusAvailable?: boolean;
  detailedStatus: GitFileStatus[];
  staged: string[];
  unstaged: string[];
}

export type GitComparisonState = RepositoryStatus['comparison'];

export interface GitCommit {
  oid: string;
  message: string;
  author: string;
  date: Date;
  commit: any;
  files?: Array<{ filepath: string; status: 'added' | 'modified' | 'deleted' }>;
}

export interface RepositoryHealthSummary {
  state: 'missing' | 'healthy' | 'damaged';
  exists: boolean;
  healthy: boolean;
  branch: string | null;
  hasCommits: boolean;
  reason?: string;
}

function toCredential(credentials: ObsidianGitCredentials): GitCredential {
  return {
    username: credentials.username || 'x-access-token',
    password: credentials.password,
    source: credentials.source || (credentials.password ? 'pat' : 'none'),
  };
}

function toLegacyCommit(commit: any): GitCommit {
  return {
    oid: commit.oid,
    message: commit.message,
    author: commit.author,
    date: commit.date,
    commit: commit.raw,
  };
}

function toFileStatus(status: RepositoryStatus): GitFileStatus[] {
  return status.files.map((file) => ({
    filepath: file.path,
    status: file.change === 'untracked' ? 'untracked' : file.change,
  }));
}

export class ObsidianGitBackend {
  private readonly credentials: StaticCredentialProvider;
  private readonly transport: { request(request: any): Promise<any> };
  private readonly backend: GitBackend;
  private config: GitBackendConfig;

  constructor(adapter: DataAdapter, dir: string, credentials: ObsidianGitCredentials, branch = 'main') {
    const fs = new ObsidianFsAdapter(adapter, dir);
    this.credentials = new StaticCredentialProvider(toCredential(credentials));
    this.config = {
      branch: branch || 'main',
      remoteUrl: credentials.repoUrl,
      author: credentials.author,
    };
    this.transport = {
      async request(request) {
        const body = request.body instanceof Uint8Array
          ? request.body.buffer.slice(request.body.byteOffset, request.body.byteOffset + request.body.byteLength)
          : request.body;
        const response = await requestUrl({
          url: request.url,
          method: request.method || 'GET',
          headers: request.headers,
          body,
          throw: false,
        });
        const bytes = new Uint8Array(response.arrayBuffer || new ArrayBuffer(0));
        return {
          status: response.status,
          headers: response.headers || {},
          body: bytes,
          text: response.text || new TextDecoder().decode(bytes),
        };
      },
    };
    this.backend = new GitBackend({
      fs,
      transport: this.transport,
      credentials: this.credentials,
    }, dir, this.config);
  }

  updateCredentials(credentials: ObsidianGitCredentials): void {
    this.credentials.setCredential(toCredential(credentials));
    this.configure({ remoteUrl: credentials.repoUrl, author: credentials.author });
  }

  hasRepository(): Promise<boolean> {
    return this.backend.hasRepository();
  }

  setOperationSignal(_signal: AbortSignal | null): void {
    // Cancellation belongs to the host lifecycle. The backend remains a
    // direct operation surface and does not depend on the coordinator.
  }

  async initializeRepo(repoUrl: string, branch: string): Promise<void> {
    this.configure({ remoteUrl: repoUrl || undefined, branch });
    if (await this.backend.hasRepository()) {
      await this.backend.initialize();
      return;
    }
    if (repoUrl) {
      try {
        await this.backend.clone();
        return;
      } catch (error) {
        if (!/empty|no commit|unborn|could not find.*ref/i.test(String((error as any)?.message || error))) throw error;
      }
    }
    await this.backend.initialize();
  }

  async sync(_repoUrl: string, branch: string, message: string): Promise<any> {
    this.configure({ branch, remoteUrl: _repoUrl || undefined });
    return this.backend.sync(message);
  }

  async pull(branch = this.config.branch): Promise<void> {
    this.configure({ branch });
    await this.backend.pull();
  }

  async push(branch = this.config.branch, force = false): Promise<void> {
    this.configure({ branch });
    await this.backend.push(force);
  }

  async getStatus(): Promise<Pick<GitSidebarStatusSnapshot, 'branch' | 'ahead' | 'behind' | 'comparison' | 'comparisonError'>> {
    const status = await this.backend.compareRemote();
    return {
      branch: status.branch || this.config.branch,
      ahead: status.ahead,
      behind: status.behind,
      comparison: status.comparison,
      comparisonError: status.comparisonError,
    };
  }

  async getSidebarStatusSnapshot(): Promise<GitSidebarStatusSnapshot> {
    const status = await this.backend.status();
    const staged = status.staged;
    const unstaged = status.files.filter((file) => file.worktree && !file.staged).map((file) => file.path);
    return {
      branch: status.branch || this.config.branch,
      ahead: status.ahead,
      behind: status.behind,
      comparison: status.comparison,
      comparisonError: status.comparisonError,
      repositoryStatusAvailable: status.state !== 'damaged',
      detailedStatus: toFileStatus(status),
      staged,
      unstaged,
    };
  }

  async getCurrentBranch(): Promise<string> {
    return (await this.backend.status()).branch || this.config.branch;
  }

  async getLog(limit = 25): Promise<GitCommit[]> {
    return (await this.backend.history(limit)).map(toLegacyCommit);
  }

  async getRemoteLog(branch = this.config.branch, limit = 25): Promise<GitCommit[]> {
    return (await this.backend.remoteHistory(branch, limit)).map(toLegacyCommit);
  }

  async stageFile(path: string): Promise<void> {
    await this.backend.stage(path);
  }

  async addAll(paths?: readonly string[]): Promise<{ requested: number; staged: string[]; failed: Array<{ filepath: string; message: string }> }> {
    const status = paths ? null : await this.backend.status();
    const requested = paths ? [...paths] : status?.changed || [];
    const result = await this.backend.stageAll(requested);
    return { requested: result.requested.length, staged: result.succeeded, failed: result.failed.map((failure) => ({ filepath: failure.path, message: failure.message })) };
  }

  async unstageFile(path: string): Promise<void> {
    await this.backend.unstage(path);
  }

  async unstageAll(): Promise<{ requested: number; unstaged: string[]; failed: Array<{ filepath: string; message: string }> }> {
    const status = await this.backend.status();
    const result = await this.backend.unstageAll(status.staged);
    return { requested: result.requested.length, unstaged: result.succeeded, failed: result.failed.map((failure) => ({ filepath: failure.path, message: failure.message })) };
  }

  async commit(message: string): Promise<string> {
    return (await this.backend.commit(message)).oid;
  }

  async getCommitFiles(oid: string): Promise<Array<{ filepath: string; status: 'added' | 'modified' | 'deleted' }>> {
    return (await this.backend.commitFiles(oid)).map((file) => ({ filepath: file.path, status: file.change }));
  }

  async checkRepositoryHealth(): Promise<RepositoryHealthSummary> {
    const health = await this.backend.health();
    return {
      state: health.state === 'missing' ? 'missing' : health.state === 'damaged' ? 'damaged' : 'healthy',
      exists: health.state !== 'missing',
      healthy: health.state === 'healthy' || health.state === 'empty',
      branch: health.branch,
      hasCommits: Boolean(health.head),
      reason: health.reason,
    };
  }

  previewIndexRepair(): ReturnType<GitBackend['previewIndexRepair']> { return this.backend.previewIndexRepair(); }
  previewLatestIndexBackup(): ReturnType<GitBackend['previewLatestIndexBackup']> { return this.backend.previewLatestIndexBackup(); }
  previewRepositoryRebuild(repoUrl: string, branch: string): ReturnType<GitBackend['previewRepositoryRebuild']> { return this.backend.previewRepositoryRebuild(repoUrl, branch); }
  rebuildIndexFromHead(): ReturnType<GitBackend['rebuildIndexFromHead']> { return this.backend.rebuildIndexFromHead(); }
  restoreLatestIndexBackup(): ReturnType<GitBackend['restoreLatestIndexBackup']> { return this.backend.restoreLatestIndexBackup(); }
  readGitignore(): Promise<string> { return this.backend.readGitignore(); }
  writeGitignore(content: string): ReturnType<GitBackend['writeGitignore']> { return this.backend.writeGitignore(content); }
  addIgnorePattern(pattern: string): ReturnType<GitBackend['addIgnorePattern']> { return this.backend.addIgnorePattern(pattern); }

  async testRemote(): Promise<void> { await this.backend.testRemote(); }

  authenticateWithGitHub(clientId: string, onUserCode?: (session: { userCode: string; verificationUri: string }) => void): Promise<GitHubAuthSession> {
    return new GitHubDeviceAuth({
      clientId,
      transport: this.transport,
      onUserCode: (code) => onUserCode?.({ userCode: code.userCode, verificationUri: code.verificationUri }),
    }).authenticate();
  }

  async fetchRemoteCommits(repoUrl: string, branch: string, limit = 25): Promise<GitCommit[]> {
    const credential = await this.credentials.getCredential();
    if (!credential?.password) return [];
    const api = new GitHubApi(this.backendTransport(), credential.password);
    return (await api.listCommits(repoUrl, branch, limit)).map((commit) => ({
      oid: commit.oid,
      message: commit.message,
      author: commit.author,
      date: new Date(commit.date),
      commit,
    }));
  }

  async fetchRemoteCommitFiles(repoUrl: string, oid: string): Promise<Array<{ filepath: string; status: 'added' | 'modified' | 'deleted' }>> {
    const credential = await this.credentials.getCredential();
    if (!credential?.password) return [];
    const api = new GitHubApi(this.backendTransport(), credential.password);
    return (await api.getCommitFiles(repoUrl, oid)).map((file) => ({ filepath: file.path, status: file.change }));
  }

  configure(config: Partial<GitBackendConfig>): void {
    Object.assign(this.config, config);
    this.backend.configure(config);
  }

  private backendTransport() {
    return this.transport;
  }
}
