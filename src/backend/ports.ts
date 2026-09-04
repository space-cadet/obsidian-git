import { CredentialProvider, HttpTransport } from './types';

/**
 * The backend only needs the fs surface accepted by isomorphic-git. Keeping
 * this as a port means the backend has no dependency on Obsidian's DataAdapter.
 */
export type GitFileSystem = any;

export interface GitBackendPorts {
  fs: GitFileSystem;
  transport: HttpTransport;
  credentials?: CredentialProvider;
}
