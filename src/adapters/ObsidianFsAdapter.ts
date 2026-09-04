import { DataAdapter, ListedFiles, Stat } from 'obsidian';

/**
 * fs adapter that delegates to Obsidian's DataAdapter.
 *
 * isomorphic-git expects a Node-style fs.promises API with Buffer support.
 * Obsidian's DataAdapter uses ArrayBuffer and has a slightly different API.
 * This adapter bridges the two.
 */
export class ObsidianFsAdapter {
    private adapter: DataAdapter;
    private dir: string;
    private writeProgress?: (path: string, bytes: number) => void;
    // readdir() validates entries on mobile because the vault index can be
    // briefly stale. Keep those validated stats for the immediately
    // following lstat() made by isomorphic-git's worktree walker so the
    // adapter bridge is not called twice for every entry.
    private readonly validatedStats = new Map<string, Stat>();

    constructor(adapter: DataAdapter, dir: string) {
        this.adapter = adapter;
        this.dir = dir;
    }

    /** Register a temporary worktree-write observer for checkout progress. */
    setWriteProgress(callback?: (path: string, bytes: number) => void): void {
        this.writeProgress = callback;
    }

    // Direct fs methods — isomorphic-git may call these directly (not just via promises)
    readFile = this.readFileImpl.bind(this);
    writeFile = this.writeFileImpl.bind(this);
    mkdir = this.mkdirImpl.bind(this);
    rmdir = this.rmdirImpl.bind(this);
    readdir = this.readdirImpl.bind(this);
    unlink = this.unlinkImpl.bind(this);
    stat = this.statImpl.bind(this);
    lstat = this.statImpl.bind(this);
    readlink = this.readlinkImpl.bind(this);
    symlink = this.symlinkImpl.bind(this);

    /** Return the fs.promises-compatible API that isomorphic-git expects */
    get promises() {
        return {
            readFile: this.readFileImpl.bind(this),
            writeFile: this.writeFileImpl.bind(this),
            mkdir: this.mkdirImpl.bind(this),
            rmdir: this.rmdirImpl.bind(this),
            readdir: this.readdirImpl.bind(this),
            unlink: this.unlinkImpl.bind(this),
            stat: this.statImpl.bind(this),
            lstat: this.statImpl.bind(this), // Obsidian doesn't expose symlinks; treat as stat
            readlink: this.readlinkImpl.bind(this),
            symlink: this.symlinkImpl.bind(this),
            setWriteProgress: this.setWriteProgress.bind(this),
        };
    }

    /** Resolve a relative path against the vault root */
    private resolve(filepath: string): string {
        // isomorphic-git passes paths like '/.git/config' or 'README.md' or './.git/...'
        // We need paths relative to the vault root (this.dir)
        if (filepath.startsWith('/')) {
            filepath = filepath.slice(1);
        }
        // Remove './' prefix that isomorphic-git may add when dir is '.'
        if (filepath.startsWith('./')) {
            filepath = filepath.slice(2);
        }
        return filepath;
    }

    /**
     * Check if we're running in Electron desktop (has Node.js fs via window.require)
     */
    private isNodeAvailable(): boolean {
        return typeof window !== 'undefined' && 
               !!(window as any).require &&
               !!(window as any).process;
    }

    /** Resolve the vault's native desktop filesystem, when Electron exposes it. */
    private nodePathFor(path: string): { fs: any; path: any; fullPath: string } | null {
        if (!this.isNodeAvailable()) return null;
        try {
            const nodeRequire = (window as any).require;
            const nodeFs = nodeRequire('fs');
            const nodePath = nodeRequire('path');
            const basePath = (this.adapter as any).getBasePath?.();
            if (!basePath) return null;
            return { fs: nodeFs, path: nodePath, fullPath: nodePath.join(basePath, path) };
        } catch {
            return null;
        }
    }

    /**
     * readFile — isomorphic-git may pass either { encoding: 'utf8' } or the
     * Node-compatible 'utf8' string for text; no encoding means binary.
     *
     * CRITICAL: Obsidian's readBinary() returns null for .git/objects/pack/*.idx files.
     * We use Node.js fs via window.require (Electron desktop) as a fallback.
     */
    private async readFileImpl(filepath: string, options?: { encoding?: string } | string): Promise<string | Uint8Array> {
        const path = this.resolve(filepath);
        const encoding = typeof options === 'string' ? options : options?.encoding;

        if (encoding === 'utf8') {
            const nodeFile = this.nodePathFor(path);
            if (nodeFile) {
                try {
                    return await nodeFile.fs.promises.readFile(nodeFile.fullPath, { encoding: 'utf8' });
                } catch {
                    // Fall back to the DataAdapter below.
                }
            }
            return this.adapter.read(path);
        }

        // Desktop's native filesystem is substantially faster for the many
        // small files in a vault and reliably exposes .git metadata. Obsidian's
        // adapter remains the fallback for mobile and virtual vault adapters.
        const nodeFile = this.nodePathFor(path);
        if (nodeFile) {
            try {
                const buffer = await nodeFile.fs.promises.readFile(nodeFile.fullPath);
                return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            } catch {
                // Continue with the Obsidian adapter below.
            }
        }

        // Try 1: Obsidian's readBinary
        try {
            const arrayBuffer = await this.adapter.readBinary(path);
            if (arrayBuffer != null) {
                return new Uint8Array(arrayBuffer);
            }
        } catch (e: any) {
            // Obsidian readBinary failed, try fallback below
        }

        // All methods failed
        const err: any = new Error(`ENOENT: cannot read '${path}'`);
        err.code = 'ENOENT';
        throw err;
    }

    /**
     * writeFile — data may be string, Uint8Array, or ArrayBuffer
     */
    private async writeFileImpl(filepath: string, data: string | Uint8Array | ArrayBuffer): Promise<void> {
        const path = this.resolve(filepath);

        const nodeFile = this.nodePathFor(path);
        if (nodeFile) {
            try {
                if (typeof data === 'string') {
                    await nodeFile.fs.promises.writeFile(nodeFile.fullPath, data, 'utf8');
                    this.writeProgress?.(path, new TextEncoder().encode(data).byteLength);
                    return;
                }
                const bytes = data instanceof Uint8Array
                    ? data
                    : data instanceof ArrayBuffer
                        ? new Uint8Array(data)
                        : new TextEncoder().encode(String(data));
                await nodeFile.fs.promises.writeFile(nodeFile.fullPath, bytes);
                this.writeProgress?.(path, bytes.byteLength);
                return;
            } catch {
                // Fall back to the DataAdapter below.
            }
        }

        if (typeof data === 'string') {
            await this.adapter.write(path, data);
            this.writeProgress?.(path, new TextEncoder().encode(data).byteLength);
        } else if (data instanceof Uint8Array) {
            await this.adapter.writeBinary(path, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
            this.writeProgress?.(path, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
            await this.adapter.writeBinary(path, data);
            this.writeProgress?.(path, data.byteLength);
        } else {
            // Fallback: try string coercion
            const text = String(data);
            await this.adapter.write(path, text);
            this.writeProgress?.(path, new TextEncoder().encode(text).byteLength);
        }
    }

    private async mkdirImpl(filepath: string, _options?: { recursive?: boolean }): Promise<void> {
        const path = this.resolve(filepath);
        try {
            await this.adapter.mkdir(path);
        } catch (err: any) {
            // If already exists, that's fine
            if (!err.message?.includes('already') && !err.message?.includes('exist')) {
                throw err;
            }
        }
    }

    private async rmdirImpl(filepath: string, _options?: { recursive?: boolean }): Promise<void> {
        const path = this.resolve(filepath);
        try {
            await this.adapter.rmdir(path, true);
        } catch (err: any) {
            if (!err.message?.includes('not') && !err.message?.includes('exist')) {
                throw err;
            }
        }
    }

    private async readdirImpl(filepath: string, _options?: { encoding?: string }): Promise<string[]> {
        const path = this.resolve(filepath);

        const nodeDirectory = this.nodePathFor(path);
        if (nodeDirectory) {
            try {
                return await nodeDirectory.fs.promises.readdir(nodeDirectory.fullPath, { encoding: 'utf8' });
            } catch {
                // Fall back to Obsidian's vault index below.
            }
        }

        const listed: ListedFiles = await this.adapter.list(path);
        
        // Obsidian's list() may return paths relative to the vault root,
        // not relative to the queried directory. If so, strip the directory prefix.
        const stripDirPrefix = (name: string): string => {
            const normalizedName = name.startsWith('./') ? name.slice(2) : name;
            if (path !== '.' && normalizedName.startsWith(path + '/')) {
                return normalizedName.slice(path.length + 1);
            }
            return normalizedName;
        };
        
        // Mobile vault indexes can briefly return a path that has already been
        // removed (for example, a trashed file). isomorphic-git aborts the
        // entire status scan when that happens, so discard only entries that
        // no longer exist and let other adapter errors propagate.
        const entries = [...listed.files, ...listed.folders];
        const existingEntries = await Promise.all(entries.map(async (entry) => {
            const relativePath = stripDirPrefix(entry);
            const candidatePath = path === '.' ? relativePath : `${path}/${relativePath}`;
            try {
                const stat = await this.adapter.stat(candidatePath);
                return stat ? { relativePath, candidatePath, stat } : null;
            } catch (error: any) {
                if (error?.code === 'ENOENT' || /no such file|not found/i.test(error?.message || '')) {
                    return null;
                }
                throw error;
            }
        }));

        for (const entry of existingEntries) {
            if (entry) this.validatedStats.set(entry.candidatePath, entry.stat);
        }
        return existingEntries
            .filter((entry): entry is { relativePath: string; candidatePath: string; stat: Stat } => entry !== null)
            .map((entry) => entry.relativePath);
    }

    private async unlinkImpl(filepath: string): Promise<void> {
        const path = this.resolve(filepath);
        try {
            await this.adapter.remove(path);
        } catch (err: any) {
            if (!err.message?.includes('not') && !err.message?.includes('exist')) {
                throw err;
            }
        }
    }

    private async statImpl(filepath: string): Promise<any> {
        const path = this.resolve(filepath);

        const nodeFile = this.nodePathFor(path);
        if (nodeFile) {
            try {
                return await nodeFile.fs.promises.stat(nodeFile.fullPath);
            } catch {
                // Fall back to Obsidian's adapter below.
            }
        }

        const validated = this.validatedStats.get(path);
        if (validated) {
            this.validatedStats.delete(path);
            return this.toNodeStat(validated);
        }

        const stat: Stat | null = await this.adapter.stat(path);

        if (!stat) {
            const err: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
            err.code = 'ENOENT';
            throw err;
        }

        return this.toNodeStat(stat);
    }

    private toNodeStat(stat: Stat): any {
        // Map Obsidian Stat to Node-like stat object
        return {
            isFile: () => stat.type === 'file',
            isDirectory: () => stat.type === 'folder',
            isSymbolicLink: () => false,
            size: stat.size,
            mtimeMs: stat.mtime,
            ctimeMs: stat.ctime,
            mode: stat.type === 'file' ? 0o644 : 0o755,
            uid: 0,
            gid: 0,
            ino: 0,
        };
    }

    private async readlinkImpl(filepath: string): Promise<string> {
        // Obsidian doesn't expose symlinks; throw as if not a symlink
        const err: any = new Error(`EINVAL: invalid argument, readlink '${filepath}'`);
        err.code = 'EINVAL';
        throw err;
    }

    private async symlinkImpl(_target: string, _filepath: string): Promise<void> {
        // Obsidian doesn't support creating symlinks via DataAdapter
        const err: any = new Error(`EPERM: operation not permitted, symlink`);
        err.code = 'EPERM';
        throw err;
    }
}
