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

    constructor(adapter: DataAdapter, dir: string) {
        this.adapter = adapter;
        this.dir = dir;
    }

    /** Return the fs.promises-compatible API that isomorphic-git expects */
    get promises() {
        return {
            readFile: this.readFile.bind(this),
            writeFile: this.writeFile.bind(this),
            mkdir: this.mkdir.bind(this),
            rmdir: this.rmdir.bind(this),
            readdir: this.readdir.bind(this),
            unlink: this.unlink.bind(this),
            stat: this.stat.bind(this),
            lstat: this.stat.bind(this), // Obsidian doesn't expose symlinks; treat as stat
            readlink: this.readlink.bind(this),
            symlink: this.symlink.bind(this),
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
     * readFile — isomorphic-git passes { encoding: 'utf8' } for text,
     * no encoding for binary (expects Buffer).
     */
    private async readFile(filepath: string, options?: { encoding?: string }): Promise<string | Uint8Array> {
        const path = this.resolve(filepath);
        const encoding = options?.encoding;

        if (encoding === 'utf8') {
            return this.adapter.read(path);
        }

        // Binary: return as Uint8Array (isomorphic-git accepts this)
        try {
            const arrayBuffer = await this.adapter.readBinary(path);
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                // Return empty Uint8Array instead of null/undefined
                return new Uint8Array(0);
            }
            return new Uint8Array(arrayBuffer);
        } catch (e: any) {
            const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`);
            err.code = 'ENOENT';
            throw err;
        }
    }

    /**
     * writeFile — data may be string, Uint8Array, or ArrayBuffer
     */
    private async writeFile(filepath: string, data: string | Uint8Array | ArrayBuffer): Promise<void> {
        const path = this.resolve(filepath);

        if (typeof data === 'string') {
            await this.adapter.write(path, data);
        } else if (data instanceof Uint8Array) {
            await this.adapter.writeBinary(path, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        } else if (data instanceof ArrayBuffer) {
            await this.adapter.writeBinary(path, data);
        } else {
            // Fallback: try string coercion
            await this.adapter.write(path, String(data));
        }
    }

    private async mkdir(filepath: string, _options?: { recursive?: boolean }): Promise<void> {
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

    private async rmdir(filepath: string, _options?: { recursive?: boolean }): Promise<void> {
        const path = this.resolve(filepath);
        try {
            await this.adapter.rmdir(path, true);
        } catch (err: any) {
            if (!err.message?.includes('not') && !err.message?.includes('exist')) {
                throw err;
            }
        }
    }

    private async readdir(filepath: string, _options?: { encoding?: string }): Promise<string[]> {
        const path = this.resolve(filepath);
        const listed: ListedFiles = await this.adapter.list(path);
        return [...listed.files, ...listed.folders];
    }

    private async unlink(filepath: string): Promise<void> {
        const path = this.resolve(filepath);
        try {
            await this.adapter.remove(path);
        } catch (err: any) {
            if (!err.message?.includes('not') && !err.message?.includes('exist')) {
                throw err;
            }
        }
    }

    private async stat(filepath: string): Promise<any> {
        const path = this.resolve(filepath);
        const stat: Stat | null = await this.adapter.stat(path);

        if (!stat) {
            const err: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
            err.code = 'ENOENT';
            throw err;
        }

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

    private async readlink(filepath: string): Promise<string> {
        // Obsidian doesn't expose symlinks; throw as if not a symlink
        const err: any = new Error(`EINVAL: invalid argument, readlink '${filepath}'`);
        err.code = 'EINVAL';
        throw err;
    }

    private async symlink(_target: string, _filepath: string): Promise<void> {
        // Obsidian doesn't support creating symlinks via DataAdapter
        const err: any = new Error(`EPERM: operation not permitted, symlink`);
        err.code = 'EPERM';
        throw err;
    }
}
