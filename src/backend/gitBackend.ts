import * as git from 'isomorphic-git';
import { GitProtocolHttp } from './http';
import { GitBackendPorts } from './ports';
import { filterAutomaticallyStagedPaths } from '../security';
import {
  BulkResult,
  CommitResult,
  GitBackendConfig,
  CommitFile,
  GitCommit,
  GitCredential,
  ProgressSink,
  RemoteComparison,
  RemoteResult,
  RepositoryStatus,
  RepositoryHealth,
  StageResult,
  FileStatus,
  FileReview,
  RepositoryIndexHealth,
  RepositoryIndexRepairResult,
  RepositoryIndexRepairPreview,
  RepositoryIndexBackupPreview,
  RepositoryRebuildPreview,
  GitignoreResult,
} from './types';

type MatrixRow = [string, number, number, number];

export class PullBlockedError extends Error {
  constructor(readonly paths: string[]) {
    const displayed = paths.slice(0, 30);
    super(
      `Pull blocked: local changes would be overwritten by remote updates:\n${displayed.map((path) => `• ${path}`).join('\n')}`
      + (paths.length > displayed.length ? `\n• …and ${paths.length - displayed.length} more file(s)` : '')
      + '\n\nCommit, stash, or discard these local changes before pulling.',
    );
    this.name = 'PullBlockedError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value?.code === 'ENOENT' || /not found|unknown revision|no such file|could not find/i.test(String(value?.message || error));
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/^\.\//, '').replace(/^\/+/, '')).filter(Boolean))];
}

function isMissingPath(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value?.code === 'ENOENT' || /ENOENT|no such file or directory|not found/i.test(String(value?.message || error));
}

function asBytes(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

function asText(value: Uint8Array | ArrayBuffer | string): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(asBytes(value));
}

function protectedMaintenancePath(path: string): boolean {
  const normalized = path.replace(/^\.\//, '').replace(/^\/+/, '');
  return normalized === '.git'
    || normalized.startsWith('.git/')
    || normalized === '.git-sync-repair'
    || normalized.startsWith('.git-sync-repair-')
    || normalized.startsWith('.obsidian/plugins/obsidian-git-sync/');
}

export function compareRepositoryPaths(
  localFiles: ReadonlyMap<string, string>,
  remoteFiles: ReadonlyMap<string, string>,
): Pick<RepositoryRebuildPreview, 'localOnly' | 'remoteOnly' | 'conflicts' | 'unchanged'> {
  const localOnly: string[] = [];
  const remoteOnly: string[] = [];
  const conflicts: string[] = [];
  const unchanged: string[] = [];
  const paths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);
  for (const path of [...paths].sort()) {
    const local = localFiles.get(path);
    const remote = remoteFiles.get(path);
    if (local === undefined) remoteOnly.push(path);
    else if (remote === undefined) localOnly.push(path);
    else if (local === remote) unchanged.push(path);
    else conflicts.push(path);
  }
  return { localOnly, remoteOnly, conflicts, unchanged };
}

export class GitBackend {
  private readonly http: GitProtocolHttp;
  private operationSignal: AbortSignal | null = null;

  constructor(
    private readonly ports: GitBackendPorts,
    private readonly dir: string,
    private readonly config: GitBackendConfig,
    private readonly progress?: ProgressSink,
  ) {
    this.http = new GitProtocolHttp(
      ports.transport,
      async () => ports.credentials?.getCredential() || null,
      progress,
    );
  }

  configure(config: Partial<GitBackendConfig>): void {
    Object.assign(this.config, config);
  }

  setProgressSink(progress?: ProgressSink): void {
    this.http.setProgressSink(progress);
  }

  setOperationSignal(signal: AbortSignal | null): void {
    this.operationSignal = signal;
    this.http.setOperationSignal(signal);
  }

  async hasRepository(): Promise<boolean> {
    try {
      const stat = await this.fs.stat(`${this.dir}/.git`);
      return Boolean(stat?.isDirectory?.());
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (!(await this.hasRepository())) {
      await git.init({ fs: this.ports.fs, dir: this.dir, defaultBranch: this.config.branch });
    }
    if (this.config.remoteUrl) await this.setRemote(this.config.remoteUrl);
  }

  async health(): Promise<RepositoryHealth> {
    if (!(await this.hasRepository())) {
      return { state: 'missing', branch: null, head: null, index: 'missing', reason: 'No .git directory' };
    }

    let branch: string | null;
    try {
      branch = (await git.currentBranch({ fs: this.ports.fs, dir: this.dir, fullname: false })) || null;
    } catch (error) {
      return { state: 'damaged', branch: null, head: null, index: 'invalid', reason: errorMessage(error) };
    }
    if (!branch) return { state: 'damaged', branch: null, head: null, index: 'invalid', reason: 'HEAD is not attached to a branch' };

    let head: string | null = null;
    try {
      head = await git.resolveRef({ fs: this.ports.fs, dir: this.dir, ref: 'HEAD' });
      await git.readCommit({ fs: this.ports.fs, dir: this.dir, oid: head });
    } catch (error) {
      if (isMissing(error)) return { state: 'empty', branch, head: null, index: 'readable' };
      return { state: 'damaged', branch, head: null, index: 'invalid', reason: errorMessage(error) };
    }

    try {
      await git.listFiles({ fs: this.ports.fs, dir: this.dir });
      return { state: 'healthy', branch, head, index: 'readable' };
    } catch (error) {
      return { state: 'damaged', branch, head, index: 'invalid', reason: errorMessage(error) };
    }
  }

  async checkIndex(): Promise<RepositoryIndexHealth> {
    const fs = this.fileSystem;
    const indexPath = this.repositoryGitPath('index');
    let stat: any;
    try {
      stat = await fs.stat(indexPath);
    } catch (error) {
      if (isMissingPath(error)) return { state: 'missing', exists: false, size: null };
      throw error;
    }

    const size = Number.isFinite(stat?.size) ? stat.size : null;
    if (size === 0) return { state: 'empty', exists: true, size, reason: 'Git index is empty (.git/index)' };
    try {
      await git.listFiles({ fs: this.ports.fs, dir: this.dir });
      return { state: 'healthy', exists: true, size };
    } catch (error) {
      return { state: 'invalid', exists: true, size, reason: errorMessage(error) };
    }
  }

  async previewIndexRepair(): Promise<RepositoryIndexRepairPreview> {
    const index = await this.checkIndex();
    const head = await this.readHeadTree();
    const worktree = await this.readWorktreeFiles(false, new Set(head.keys()));
    let modifiedFiles = 0;
    let deletedFiles = 0;
    let unchangedFiles = 0;
    for (const [path, oid] of head) {
      const localOid = worktree.get(path);
      if (localOid === undefined) deletedFiles += 1;
      else if (localOid === oid) unchangedFiles += 1;
      else modifiedFiles += 1;
    }
    const tracked = new Set(head.keys());
    const untrackedFiles = [...worktree.keys()].filter((path) => !tracked.has(path)).length;
    return {
      index,
      trackedFiles: head.size,
      modifiedFiles,
      deletedFiles,
      untrackedFiles,
      unchangedFiles,
    };
  }

  async previewLatestIndexBackup(): Promise<RepositoryIndexBackupPreview | null> {
    const fs = this.fileSystem;
    let entries: string[];
    try {
      entries = await fs.readdir(this.repositoryGitPath(''), { encoding: 'utf8' });
    } catch (error) {
      if (isMissingPath(error)) return null;
      throw error;
    }
    const backups = entries
      .filter((entry: string) => /^index\.obsidian-git-backup-\d+$/.test(entry))
      .sort()
      .reverse();
    if (backups.length === 0) return null;
    const filename = backups[0];
    const bytes = asBytes(await fs.readFile(this.repositoryGitPath(filename)));
    return {
      filename,
      size: bytes.byteLength,
      validFormat: bytes.byteLength >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'DIRC',
    };
  }

  async rebuildIndexFromHead(): Promise<RepositoryIndexRepairResult> {
    const health = await this.checkIndex();
    if (health.state === 'healthy') throw new Error('The Git index is already healthy; no repair is needed.');
    const fs = this.fileSystem;
    const lockPath = this.repositoryGitPath('index.lock');
    try {
      await fs.stat(lockPath);
      throw new Error('Git index.lock exists. Another Git operation may be running; try again after it finishes.');
    } catch (error) {
      if (error instanceof Error && error.message.includes('Another Git operation')) throw error;
      if (!isMissingPath(error)) throw error;
    }

    const head = await this.readHeadTree();
    const worktree = await this.readWorktreeFiles(false, new Set(head.keys()));
    const indexPath = this.repositoryGitPath('index');
    const original = health.exists ? asBytes(await fs.readFile(indexPath)) : null;
    const backupPath = original ? await this.backupIndex(original) : null;
    try {
      await this.removeIndex();
      const existingTracked = [...head.keys()].filter((path) => worktree.has(path));
      if (existingTracked.length > 0) {
        await git.add({ fs: this.ports.fs, dir: this.dir, filepath: existingTracked, parallel: true, force: true });
      }
      for (const path of head.keys()) {
        if (worktree.has(path) && worktree.get(path) === head.get(path)) continue;
        await git.resetIndex({ fs: this.ports.fs, dir: this.dir, filepath: path, ref: 'HEAD' });
      }
      await git.listFiles({ fs: this.ports.fs, dir: this.dir });
      return { backupPath, trackedFiles: head.size, worktreeFiles: worktree.size, stagedStateRecovered: false };
    } catch (error) {
      await this.removeIndex();
      if (original) await fs.writeFile(indexPath, original);
      throw error;
    }
  }

  async restoreLatestIndexBackup(): Promise<string> {
    const preview = await this.previewLatestIndexBackup();
    if (!preview) throw new Error('No Git index repair backup was found.');
    if (!preview.validFormat || preview.size === 0) throw new Error(`The newest Git index backup is invalid: ${preview.filename}`);
    const fs = this.fileSystem;
    const backup = asBytes(await fs.readFile(this.repositoryGitPath(preview.filename)));
    const currentPath = this.repositoryGitPath('index');
    const current = await this.indexBytesOrNull();
    if (current) await fs.writeFile(this.repositoryGitPath(`index.obsidian-git-pre-restore-${Date.now()}`), current);
    try {
      await fs.writeFile(currentPath, backup);
      await git.listFiles({ fs: this.ports.fs, dir: this.dir });
      return preview.filename;
    } catch (error) {
      await this.removeIndex();
      if (current) await fs.writeFile(currentPath, current);
      throw error;
    }
  }

  async previewRepositoryRebuild(remoteUrl = this.config.remoteUrl, branch = this.config.branch): Promise<RepositoryRebuildPreview> {
    if (!remoteUrl) throw new Error('A remote repository URL is required before comparing a rebuild.');
    const fs = this.fileSystem;
    const temporaryDir = `${this.dir === '.' ? '.' : this.dir}/.git-sync-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      await git.clone({ fs: this.ports.fs, http: this.http, dir: temporaryDir, url: remoteUrl, ref: branch, singleBranch: true, depth: 1, onAuth: () => this.auth() });
      const remoteOid = await this.resolveRefOrNullAt(temporaryDir, `refs/heads/${branch}`);
      const remoteFiles = remoteOid ? await this.readCommitTreeAt(temporaryDir, remoteOid) : new Map<string, string>();
    const localFiles = await this.readWorktreeFiles(true);
      return { branch, remoteOid, ...compareRepositoryPaths(localFiles, remoteFiles) };
    } finally {
      try { await fs.rmdir(temporaryDir, { recursive: true }); } catch (error) { if (!isMissingPath(error)) throw error; }
    }
  }

  async readGitignore(): Promise<string> {
    try {
      return asText(await this.fileSystem.readFile(this.repositoryPath('.gitignore')));
    } catch (error) {
      if (isMissingPath(error)) return '';
      throw error;
    }
  }

  async writeGitignore(content: string): Promise<GitignoreResult> {
    await this.fileSystem.writeFile(this.repositoryPath('.gitignore'), content);
    return { content, changed: true };
  }

  async addIgnorePattern(pattern: string): Promise<GitignoreResult> {
    const normalized = pattern.trim();
    if (!normalized || normalized.startsWith('#')) throw new Error('Enter a non-empty ignore pattern');
    const current = await this.readGitignore();
    const lines = current.split(/\r?\n/);
    if (lines.some((line) => line.trim() === normalized)) return { content: current, changed: false, pattern: normalized };
    const prefix = current && !current.endsWith('\n') ? `${current}\n` : current;
    const content = `${prefix}${normalized}\n`;
    await this.fileSystem.writeFile(this.repositoryPath('.gitignore'), content);
    return { content, changed: true, pattern: normalized };
  }

  async setRemote(url: string): Promise<void> {
    this.throwIfAborted();
    const remotes = await git.listRemotes({ fs: this.ports.fs, dir: this.dir });
    const origin = remotes.find((remote) => remote.remote === 'origin');
    if (!origin) {
      await git.addRemote({ fs: this.ports.fs, dir: this.dir, remote: 'origin', url });
    } else if (origin.url !== url) {
      await git.deleteRemote({ fs: this.ports.fs, dir: this.dir, remote: 'origin' });
      await git.addRemote({ fs: this.ports.fs, dir: this.dir, remote: 'origin', url });
    }
  }

  async clone(): Promise<void> {
    if (!this.config.remoteUrl) throw new Error('A remote repository URL is required to clone');
    if (await this.hasRepository()) throw new Error('A local Git repository already exists');
    await git.init({ fs: this.ports.fs, dir: this.dir, defaultBranch: this.config.branch });
    await this.setRemote(this.config.remoteUrl);
    try {
      await git.fetch({
        fs: this.ports.fs,
        http: this.http,
        dir: this.dir,
        remote: 'origin',
        ref: this.config.branch,
        singleBranch: true,
        depth: 1,
        onAuth: () => this.auth(),
      });
    } catch (error) {
      if (/empty|no commit|unborn|could not find.*ref/i.test(errorMessage(error))) return;
      throw error;
    }
    const remoteOid = await git.resolveRef({
      fs: this.ports.fs,
      dir: this.dir,
      ref: `refs/remotes/origin/${this.config.branch}`,
    });
    await this.assertCheckoutSafe(remoteOid);
    await git.writeRef({
      fs: this.ports.fs,
      dir: this.dir,
      ref: `refs/heads/${this.config.branch}`,
      value: remoteOid,
      force: true,
    });
    await git.checkout({ fs: this.ports.fs, dir: this.dir, ref: this.config.branch });
  }

  async testRemote(): Promise<void> {
    this.requireRemote();
    const remoteUrl = this.config.remoteUrl as string;
    await git.listServerRefs({
      http: this.http,
      url: remoteUrl,
      prefix: `refs/heads/${this.config.branch}`,
      onAuth: () => this.auth(),
    });
  }

  /**
   * One local status read. Remote comparison is deliberately opt-in so the
   * first useful file state does not wait for history traversal or network IO.
   */
  async status(options: { compareRemote?: boolean } = {}): Promise<RepositoryStatus> {
    if (!(await this.hasRepository())) return this.emptyStatus('missing');

    let branch: string | null = null;
    try {
      branch = (await git.currentBranch({ fs: this.ports.fs, dir: this.dir, fullname: false })) || null;
    } catch (error) {
      return this.emptyStatus('damaged', errorMessage(error));
    }

    if (!branch) return this.emptyStatus('damaged', 'HEAD is not attached to a branch');

    let head: string | null = null;
    try { head = await git.resolveRef({ fs: this.ports.fs, dir: this.dir, ref: 'HEAD' }); } catch (error) {
      if (!isMissing(error)) return this.emptyStatus('damaged', errorMessage(error), branch);
    }

    let files: FileStatus[] = [];
    try {
      const matrix = await git.statusMatrix({ fs: this.ports.fs, dir: this.dir }) as MatrixRow[];
      files = [];
      const matrixStates: Record<string, number> = {};
      for (const [path, headState, worktreeState, stageState] of matrix) {
        const state = `${headState}/${worktreeState}/${stageState}`;
        matrixStates[state] = (matrixStates[state] || 0) + 1;
        const staged = stageState !== headState;
        const worktree = worktreeState !== stageState;
        if (!staged && !worktree) continue;
        const change = worktreeState === 0 && headState !== 0
          ? 'deleted'
          : headState === 0 && staged
            ? 'added'
            : headState === 0
            ? 'untracked'
            : staged && !worktree
              ? 'staged'
              : worktreeState === 2
                ? 'modified'
                : 'conflict';
        files.push({ path, change, staged, worktree });
      }
      this.ports.diagnostics?.info('Working-tree status matrix read', {
        branch,
        matrixEntries: matrix.length,
        changedFiles: files.length,
        stagedFiles: files.filter((file) => file.staged).length,
        worktreeFiles: files.filter((file) => file.worktree).length,
        untrackedFiles: files.filter((file) => file.change === 'untracked').length,
        matrixStates,
      });
    } catch (error) {
      this.ports.diagnostics?.error(
        'Working-tree status matrix failed',
        error instanceof Error ? error : new Error(errorMessage(error)),
      );
      return this.emptyStatus('damaged', errorMessage(error), branch, head);
    }

    const result: RepositoryStatus = {
      state: head ? 'healthy' : 'empty',
      branch,
      head,
      files,
      staged: files.filter((file) => file.staged).map((file) => file.path),
      changed: files.filter((file) => file.worktree || file.staged).map((file) => file.path),
      comparison: head ? 'unavailable' : 'local-only',
      ahead: 0,
      behind: 0,
    };

    if (options.compareRemote) return this.withRemoteComparison(result);
    return result;
  }

  async compareRemote(): Promise<RepositoryStatus> {
    if (!(await this.hasRepository())) return this.emptyStatus('missing');
    let branch: string | null = null;
    try { branch = (await git.currentBranch({ fs: this.ports.fs, dir: this.dir, fullname: false })) || null; }
    catch (error) { return this.emptyStatus('damaged', errorMessage(error)); }
    if (!branch) return this.emptyStatus('damaged', 'HEAD is not attached to a branch');
    let head: string | null = null;
    try { head = await git.resolveRef({ fs: this.ports.fs, dir: this.dir, ref: 'HEAD' }); }
    catch (error) { if (!isMissing(error)) return this.emptyStatus('damaged', errorMessage(error), branch); }
    const result: RepositoryStatus = {
      state: head ? 'healthy' : 'empty',
      branch,
      head,
      files: [],
      staged: [],
      changed: [],
      comparison: head ? 'unavailable' : 'local-only',
      ahead: 0,
      behind: 0,
    };
    return this.withRemoteComparison(result);
  }

  async stage(path: string): Promise<StageResult> {
    this.assertPath(path);
    this.throwIfAborted();

    // Do not call git.status({ filepath }) here. That looks targeted, but
    // isomorphic-git still resolves the HEAD tree, reads the index, and may
    // hash the worktree file before git.add() repeats those reads. On mobile
    // DataAdapters this duplicate path is especially expensive.
    const tracked = new Set(await git.listFiles({ fs: this.ports.fs, dir: this.dir }));
    const worktreePath = this.repositoryPath(path);
    let present = true;
    try {
      await this.fileSystem.lstat(worktreePath);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      present = false;
    }

    if (!present && tracked.has(path)) {
      await git.remove({ fs: this.ports.fs, dir: this.dir, filepath: path });
    } else if (!present) {
      throw new Error(`Path "${path}" is not present in the worktree`);
    } else {
      if (!tracked.has(path) && await this.isIgnored(path)) {
        throw new Error(`Path "${path}" is ignored by .gitignore`);
      }
      await git.add({ fs: this.ports.fs, dir: this.dir, filepath: path });
    }
    return { path, staged: true };
  }

  async stageAll(paths: readonly string[]): Promise<BulkResult> {
    const requested = uniquePaths(paths);
    const succeeded: string[] = [];
    const failed: Array<{ path: string; message: string }> = [];

    // Read the index once to classify the requested paths. This does not
    // enumerate the worktree or resolve the HEAD tree. Present files can then
    // be written in one index transaction, while tracked deletions use
    // remove().
    const tracked = new Set(await git.listFiles({ fs: this.ports.fs, dir: this.dir }));
    const states = await Promise.all(requested.map(async (path) => {
      try {
        this.assertPath(path);
        let present = true;
        try {
          await this.fileSystem.lstat(this.repositoryPath(path));
        } catch (error) {
          if (!isMissingPath(error)) throw error;
          present = false;
        }
        if (!present) return { path, state: tracked.has(path) ? 'deleted' : 'absent', error: null };
        if (!tracked.has(path) && await this.isIgnored(path)) return { path, state: 'ignored', error: null };
        return { path, state: 'present', error: null };
      } catch (error) {
        return { path, state: null, error };
      }
    }));
    const present = states.filter(({ state }) => state === 'present').map(({ path }) => path);
    const deleted = states.filter(({ state }) => state === 'deleted').map(({ path }) => path);
    for (const { path, state, error } of states.filter(({ state, error }) => error || state === 'ignored' || state === 'absent' || state === '*absent')) {
      failed.push({ path, message: error ? errorMessage(error) : state === 'ignored' ? `Path "${path}" is ignored by .gitignore` : `Path "${path}" is not present in the worktree` });
    }

    const batchSize = 32;
    for (let index = 0; index < present.length; index += batchSize) {
      this.throwIfAborted();
      const batch = present.slice(index, index + batchSize);
      try {
        await git.add({ fs: this.ports.fs, dir: this.dir, filepath: batch, parallel: true });
        succeeded.push(...batch);
      } catch {
        // Keep partial-result semantics if one path disappears or the host
        // cannot complete the batch. The fallback is still direct per-path
        // work and does not perform another full status read.
        for (const path of batch) {
          try {
            this.throwIfAborted();
            await this.stage(path);
            succeeded.push(path);
          } catch (error) {
            failed.push({ path, message: errorMessage(error) });
          }
        }
      }
    }

    for (const path of deleted) {
      try {
        await this.stage(path);
        succeeded.push(path);
      } catch (error) {
        failed.push({ path, message: errorMessage(error) });
      }
    }
    return { requested, succeeded: uniquePaths(succeeded), failed };
  }

  async unstage(path: string): Promise<StageResult> {
    this.assertPath(path);
    this.throwIfAborted();
    const head = await this.resolveRefOrNull('HEAD');
    await git.resetIndex({
      fs: this.ports.fs,
      dir: this.dir,
      filepath: path,
      ...(head ? { ref: 'HEAD' } : {}),
    });
    return { path, staged: false };
  }

  async unstageAll(paths: readonly string[]): Promise<BulkResult> {
    const requested = uniquePaths(paths);
    const succeeded: string[] = [];
    const failed: Array<{ path: string; message: string }> = [];
    for (const path of requested) {
      try {
        await this.unstage(path);
        succeeded.push(path);
      } catch (error) {
        failed.push({ path, message: errorMessage(error) });
      }
    }
    return { requested, succeeded, failed };
  }

  /** Restore one tracked worktree path to its committed HEAD version. */
  async discard(path: string): Promise<void> {
    this.assertPath(path);
    const tracked = new Set(await git.listFiles({ fs: this.ports.fs, dir: this.dir }));
    if (!tracked.has(path)) throw new Error(`Cannot restore untracked file "${path}" from HEAD`);
    await git.checkout({
      fs: this.ports.fs,
      dir: this.dir,
      ref: 'HEAD',
      filepaths: [path],
      force: true,
      noUpdateHead: true,
    });
  }

  /** Read the current and committed text for a read-only review UI. */
  async review(path: string): Promise<FileReview> {
    this.assertPath(path);
    let head: string | null = null;
    try {
      const oid = await git.resolveRef({ fs: this.ports.fs, dir: this.dir, ref: 'HEAD' });
      const result: any = await git.readBlob({ fs: this.ports.fs, dir: this.dir, oid, filepath: path });
      head = this.reviewText(result.blob);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    let worktree: string | null = null;
    try { worktree = this.reviewText(await this.fileSystem.readFile(this.repositoryPath(path))); }
    catch (error) { if (!isMissingPath(error)) throw error; }
    return { path, head, worktree };
  }

  async commit(message: string): Promise<CommitResult> {
    const trimmed = message.trim();
    if (!trimmed) throw new Error('A commit message is required');
    const author = this.config.author;
    const oid = await git.commit({
      fs: this.ports.fs,
      dir: this.dir,
      message: trimmed,
      author,
      committer: author,
    });
    return { oid, message: trimmed };
  }

  async pull(): Promise<RemoteResult> {
    this.requireRemote();
    await this.setRemote(this.config.remoteUrl as string);
    this.throwIfAborted();
    const branch = this.config.branch;
    this.progress?.message?.('Fetching remote changes…');
    await git.fetch({
      fs: this.ports.fs,
      http: this.http,
      dir: this.dir,
      remote: 'origin',
      ref: branch,
      singleBranch: true,
      onAuth: () => this.auth(),
    });
    const fetched = await this.resolveRefOrNull(`refs/remotes/origin/${branch}`)
      || await this.resolveRefOrNull('FETCH_HEAD');
    if (!fetched) throw new Error(`Pull failed: fetched remote ${branch}, but no remote-tracking ref was written`);
    const local = await this.resolveRefOrNull(`refs/heads/${branch}`);
    if (!local) {
      this.progress?.message?.('Checking whether the remote files are safe to apply…');
      await this.assertCheckoutSafe(fetched);
      this.progress?.message?.('Updating local branch…');
      await git.writeRef({ fs: this.ports.fs, dir: this.dir, ref: `refs/heads/${branch}`, value: fetched, force: true });
      this.progress?.message?.('Checking out remote files…');
      await git.checkout({ fs: this.ports.fs, dir: this.dir, ref: branch });
      return { branch, oid: fetched };
    }
    if (local === fetched) return { branch, oid: local, alreadyCurrent: true };
    this.progress?.message?.('Checking local changes before merge…');
    const blockedPaths = await this.findPullOverwritePaths(local, fetched);
    if (blockedPaths.length > 0) throw new PullBlockedError(blockedPaths);
    this.progress?.message?.('Applying remote changes…');
    await git.merge({
      fs: this.ports.fs,
      dir: this.dir,
      ours: branch,
      theirs: fetched,
      fastForward: true,
      fastForwardOnly: true,
      author: this.config.author,
      committer: this.config.author,
    });
    this.progress?.message?.('Checking out updated files…');
    await git.checkout({ fs: this.ports.fs, dir: this.dir, ref: branch });
    return { branch, oid: fetched };
  }

  async push(force = false): Promise<RemoteResult> {
    this.requireRemote();
    await this.setRemote(this.config.remoteUrl as string);
    this.throwIfAborted();
    this.progress?.message?.('Uploading local changes…');
    await git.push({
      fs: this.ports.fs,
      http: this.http,
      dir: this.dir,
      remote: 'origin',
      ref: this.config.branch,
      force,
      onAuth: () => this.auth(),
    });
    this.progress?.message?.('Confirming remote branch…');
    const oid = await this.resolveRefOrNull(`refs/heads/${this.config.branch}`);
    if (oid) {
      await git.writeRef({
        fs: this.ports.fs,
        dir: this.dir,
        ref: `refs/remotes/origin/${this.config.branch}`,
        value: oid,
        force: true,
      });
    }
    return { branch: this.config.branch, oid };
  }

  async sync(message: string): Promise<{ committed: CommitResult | null; pulled: RemoteResult | null; pushed: RemoteResult | null }> {
    const pulled = this.config.remoteUrl ? await this.pull() : null;
    this.throwIfAborted();
    const status = await this.status();
    const stageResult = await this.stageAll(filterAutomaticallyStagedPaths(status.changed));
    if (stageResult.failed.length > 0) throw new Error(`Could not stage ${stageResult.failed.length} file(s)`);
    const committed = stageResult.succeeded.length > 0 ? await this.commit(message) : null;
    const pushed = committed && this.config.remoteUrl ? await this.push() : null;
    return { committed, pulled, pushed };
  }

  async history(limit = 25): Promise<GitCommit[]> {
    let commits: any[];
    try {
      commits = await git.log({ fs: this.ports.fs, dir: this.dir, ref: 'HEAD', depth: limit });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return commits.map((entry: any) => ({
      oid: entry.oid,
      message: entry.commit?.message || '',
      author: entry.commit?.author?.name || 'Unknown',
      date: new Date((entry.commit?.author?.timestamp || 0) * 1000),
      raw: entry.commit,
    }));
  }

  /** Read the attached branch ref without scanning the worktree. */
  async currentBranch(): Promise<string | null> {
    try {
      return (await git.currentBranch({ fs: this.ports.fs, dir: this.dir, fullname: false })) || null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async remoteHistory(branch = this.config.branch, limit = 25): Promise<GitCommit[]> {
    let commits: any[];
    try {
      commits = await git.log({ fs: this.ports.fs, dir: this.dir, ref: `refs/remotes/origin/${branch}`, depth: limit });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return commits.map((entry: any) => ({
      oid: entry.oid,
      message: entry.commit?.message || '',
      author: entry.commit?.author?.name || 'Unknown',
      date: new Date((entry.commit?.author?.timestamp || 0) * 1000),
      raw: entry.commit,
    }));
  }

  async commitFiles(oid: string): Promise<CommitFile[]> {
    const entry: any = await git.readCommit({ fs: this.ports.fs, dir: this.dir, oid });
    const current = await this.readTree(entry.commit.tree);
    const parent = entry.commit.parent?.[0] ? await this.readCommitTree(entry.commit.parent[0]) : new Map<string, string>();
    const paths = new Set([...current.keys(), ...parent.keys()]);
    const files: CommitFile[] = [];
    for (const path of [...paths].sort()) {
      const before = parent.get(path);
      const after = current.get(path);
      if (before === undefined && after !== undefined) files.push({ path, change: 'added' });
      else if (before !== undefined && after === undefined) files.push({ path, change: 'deleted' });
      else if (before !== after) files.push({ path, change: 'modified' });
    }
    return files;
  }

  private get fs(): any {
    return this.ports.fs.promises || this.ports.fs;
  }

  private get fileSystem(): any {
    return this.ports.fs.promises || this.ports.fs;
  }

  private repositoryPath(filepath: string): string {
    return this.dir === '.' ? filepath : `${this.dir}/${filepath}`;
  }

  private repositoryGitPath(filepath: string): string {
    return this.repositoryPath(`.git/${filepath}`);
  }

  private async indexBytesOrNull(): Promise<Uint8Array | null> {
    try { return asBytes(await this.fileSystem.readFile(this.repositoryGitPath('index'))); }
    catch (error) { if (isMissingPath(error)) return null; throw error; }
  }

  private async backupIndex(value: Uint8Array): Promise<string> {
    const filename = `index.obsidian-git-backup-${Date.now()}`;
    await this.fileSystem.writeFile(this.repositoryGitPath(filename), value);
    return filename;
  }

  private async removeIndex(): Promise<void> {
    try { await this.fileSystem.unlink(this.repositoryGitPath('index')); }
    catch (error) { if (!isMissingPath(error)) throw error; }
  }

  private async readHeadTree(): Promise<Map<string, string>> {
    const oid = await git.resolveRef({ fs: this.ports.fs, dir: this.dir, ref: 'HEAD' });
    const commit: any = await git.readCommit({ fs: this.ports.fs, dir: this.dir, oid });
    return this.readTree(commit.commit.tree);
  }

  private async assertCheckoutSafe(remoteOid: string): Promise<void> {
    const commit: any = await git.readCommit({ fs: this.ports.fs, dir: this.dir, oid: remoteOid });
    const remoteFiles = await this.readTree(commit.commit.tree);
    const localFiles = await this.readWorktreeFiles(true);
    const comparison = compareRepositoryPaths(localFiles, remoteFiles);
    if (comparison.conflicts.length > 0) {
      const paths = comparison.conflicts.slice(0, 3).join(', ');
      throw new Error(`Clone stopped because existing vault files would be overwritten (${paths}${comparison.conflicts.length > 3 ? ', ...' : ''})`);
    }
    for (const path of remoteFiles.keys()) {
      try {
        const stat = await this.fileSystem.stat(this.repositoryPath(path));
        if (stat.isDirectory?.()) throw new Error(`Clone stopped because the existing vault folder "${path}" would be replaced by a file`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Clone stopped')) throw error;
        if (!isMissingPath(error)) throw error;
      }
    }
  }

  private async readWorktreeFiles(includeIgnored = false, trackedPaths: ReadonlySet<string> = new Set()): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const walk = async (relativeDir: string): Promise<void> => {
      const lookupPath = relativeDir ? this.repositoryPath(relativeDir) : this.dir;
      const entries = await this.fileSystem.readdir(lookupPath, { encoding: 'utf8' }) as string[];
      for (const entry of entries) {
        const path = relativeDir ? `${relativeDir}/${entry}` : entry;
        if (protectedMaintenancePath(path)) continue;
        const fullPath = this.repositoryPath(path);
        let stat: any;
        try { stat = await this.fileSystem.stat(fullPath); }
        catch (error) { if (isMissingPath(error)) continue; throw error; }
        if (stat.isDirectory?.()) {
          if (!includeIgnored && !(await this.hasTrackedDescendant(path, trackedPaths)) && await this.isIgnored(path)) continue;
          await walk(path);
        } else if (stat.isFile?.() && (includeIgnored || trackedPaths.has(path) || !(await this.isIgnored(path)))) {
          const value = await this.fileSystem.readFile(fullPath);
          result.set(path, (await git.hashBlob({ object: value })).oid);
        }
      }
    };
    await walk('');
    return result;
  }

  private hasTrackedDescendant(path: string, trackedPaths: ReadonlySet<string>): boolean {
    const prefix = `${path}/`;
    for (const trackedPath of trackedPaths) if (trackedPath.startsWith(prefix)) return true;
    return false;
  }

  private async isIgnored(path: string): Promise<boolean> {
    try { return await git.isIgnored({ fs: this.ports.fs, dir: this.dir, filepath: path }); }
    catch { return false; }
  }

  private async resolveRefOrNullAt(dir: string, ref: string): Promise<string | null> {
    try { return await git.resolveRef({ fs: this.ports.fs, dir, ref }); } catch { return null; }
  }

  private async readCommitTreeAt(dir: string, oid: string): Promise<Map<string, string>> {
    const commit: any = await git.readCommit({ fs: this.ports.fs, dir, oid });
    return this.readTreeAt(dir, commit.commit.tree);
  }

  private async readTreeAt(dir: string, treeOid: string, prefix = ''): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const tree: any = await git.readTree({ fs: this.ports.fs, dir, oid: treeOid });
    for (const entry of tree.tree) {
      const path = `${prefix}${entry.path}`;
      if (entry.type === 'tree') {
        for (const [nested, nestedOid] of await this.readTreeAt(dir, entry.oid, `${path}/`)) result.set(nested, nestedOid);
      } else result.set(path, entry.oid);
    }
    return result;
  }

  private async auth(): Promise<GitCredential> {
    const credential = await this.ports.credentials?.getCredential();
    if (!credential?.password) throw new Error('Authentication is required for this remote operation');
    return credential;
  }

  private async pathStatus(path: string): Promise<string> {
    return git.status({ fs: this.ports.fs, dir: this.dir, filepath: path });
  }

  private async resolveRefOrNull(ref: string): Promise<string | null> {
    try { return await git.resolveRef({ fs: this.ports.fs, dir: this.dir, ref }); } catch { return null; }
  }

  private async withRemoteComparison(status: RepositoryStatus): Promise<RepositoryStatus> {
    if (!status.head || !this.config.remoteUrl) return { ...status, comparison: 'local-only' };
    const remote = await this.resolveRefOrNull(`refs/remotes/origin/${status.branch}`);
    if (!remote) return { ...status, comparison: 'unavailable', comparisonError: 'No local remote-tracking ref' };
    if (remote === status.head) return { ...status, comparison: 'up-to-date' };
    const localCommits = await git.log({ fs: this.ports.fs, dir: this.dir, ref: `refs/heads/${status.branch}` });
    const remoteCommits = await git.log({ fs: this.ports.fs, dir: this.dir, ref: `refs/remotes/origin/${status.branch}` });
    const localOids = new Set(localCommits.map((entry) => entry.oid));
    const remoteOids = new Set(remoteCommits.map((entry) => entry.oid));
    const ahead = localCommits.filter((entry) => !remoteOids.has(entry.oid)).length;
    const behind = remoteCommits.filter((entry) => !localOids.has(entry.oid)).length;
    const comparison: RemoteComparison = ahead && behind ? 'diverged' : ahead ? 'ahead' : 'behind';
    return { ...status, comparison, ahead, behind };
  }

  private async readCommitTree(oid: string): Promise<Map<string, string>> {
    const commit: any = await git.readCommit({ fs: this.ports.fs, dir: this.dir, oid });
    return this.readTree(commit.commit.tree);
  }

  private async findPullOverwritePaths(localOid: string, remoteOid: string): Promise<string[]> {
    const [status, localTree, remoteTree] = await Promise.all([
      this.status(),
      this.readCommitTree(localOid),
      this.readCommitTree(remoteOid),
    ]);
    return status.files
      .filter((file) => file.worktree || file.staged)
      .map((file) => file.path)
      .filter((path) => localTree.get(path) !== remoteTree.get(path));
  }

  private async readTree(treeOid: string, prefix = ''): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const tree: any = await git.readTree({ fs: this.ports.fs, dir: this.dir, oid: treeOid });
    for (const entry of tree.tree) {
      const path = `${prefix}${entry.path}`;
      if (entry.type === 'tree') {
        for (const [nested, oid] of await this.readTree(entry.oid, `${path}/`)) result.set(nested, oid);
      } else {
        result.set(path, entry.oid);
      }
    }
    return result;
  }

  private emptyStatus(state: RepositoryStatus['state'], comparisonError?: string, branch: string | null = null, head: string | null = null): RepositoryStatus {
    return {
      state,
      branch,
      head,
      files: [],
      staged: [],
      changed: [],
      comparison: state === 'missing' || state === 'empty' ? 'local-only' : 'unavailable',
      ahead: 0,
      behind: 0,
      ...(comparisonError ? { comparisonError } : {}),
    };
  }

  private requireRemote(): void {
    if (!this.config.remoteUrl) throw new Error('A remote repository URL is not configured');
  }

  private throwIfAborted(): void {
    if (this.operationSignal?.aborted) {
      const error = new Error('Git operation cancelled');
      error.name = 'AbortError';
      throw error;
    }
  }

  private assertPath(path: string): void {
    if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Invalid repository path: ${path}`);
  }

  private reviewText(value: Uint8Array | ArrayBuffer | string): string {
    const bytes = asBytes(value);
    if (bytes.byteLength > 512 * 1024) return `[File is ${bytes.byteLength.toLocaleString()} bytes; review is limited to the first 512 KiB.]\n${new TextDecoder().decode(bytes.slice(0, 512 * 1024))}`;
    if (bytes.includes(0)) return `[Binary file: ${bytes.byteLength.toLocaleString()} bytes]`;
    return new TextDecoder().decode(bytes);
  }
}
