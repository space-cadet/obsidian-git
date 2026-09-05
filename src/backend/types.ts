export type CredentialSource = 'pat' | 'github' | 'none';

export interface GitCredential {
  username: string;
  password: string;
  source: CredentialSource;
}

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitBackendConfig {
  branch: string;
  remoteUrl?: string;
  author: GitAuthor;
}

export type FileChange = 'added' | 'modified' | 'deleted' | 'untracked' | 'staged' | 'conflict';

export interface FileStatus {
  path: string;
  change: FileChange;
  staged: boolean;
  worktree: boolean;
}

export interface FileReview {
  path: string;
  head: string | null;
  worktree: string | null;
}

export type RepositoryState = 'missing' | 'empty' | 'healthy' | 'damaged';

export type RemoteComparison = 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'local-only' | 'unavailable';

export interface RepositoryStatus {
  state: RepositoryState;
  branch: string | null;
  head: string | null;
  files: FileStatus[];
  staged: string[];
  changed: string[];
  comparison: RemoteComparison;
  ahead: number;
  behind: number;
  comparisonError?: string;
}

export interface RepositoryHealth {
  state: RepositoryState;
  branch: string | null;
  head: string | null;
  index: 'missing' | 'readable' | 'invalid';
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

export interface GitignoreResult {
  content: string;
  changed: boolean;
  pattern?: string;
}

export interface CommitFile {
  path: string;
  change: 'added' | 'modified' | 'deleted';
}

export interface StageResult {
  path: string;
  staged: boolean;
}

export interface BulkResult {
  requested: string[];
  succeeded: string[];
  failed: Array<{ path: string; message: string }>;
}

export interface CommitResult {
  oid: string;
  message: string;
}

export interface RemoteResult {
  branch: string;
  oid: string | null;
  alreadyCurrent?: boolean;
}

export interface GitCommit {
  oid: string;
  message: string;
  author: string;
  date: Date;
  raw: unknown;
}

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  text: string;
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export interface CredentialProvider {
  getCredential(): Promise<GitCredential | null>;
}

export interface ProgressSink {
  message?(message: string): void;
  progress?(loaded: number, total?: number): void;
}
