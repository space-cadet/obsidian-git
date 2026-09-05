import { CredentialProvider, HttpTransport } from './types';

/**
 * The backend only needs the fs surface accepted by isomorphic-git. Keeping
 * this as a port means the backend has no dependency on Obsidian's DataAdapter.
 */
export type GitFileSystem = any;

/** Optional host-owned diagnostics. The portable backend never imports UI logging. */
export interface GitBackendDiagnostics {
  info(message: string, data?: unknown): void;
  error(message: string, error: Error): void;
}

export interface GitBackendPorts {
  fs: GitFileSystem;
  transport: HttpTransport;
  credentials?: CredentialProvider;
  diagnostics?: GitBackendDiagnostics;
}
