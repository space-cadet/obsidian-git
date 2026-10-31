import type { DataAdapter, EventRef, Stat, Vault, Workspace } from "obsidian";
import { normalizeRepositoryFilePath, normalizeRepositoryRoot } from "./repositoryPaths";

const VERSION = 1;
const MAX_ENTRIES = 10_000;
const stores = new WeakMap<DataAdapter, StatusCacheStore>();

/**
 * Obsidian emits `create` for every existing file while initially loading a vault.
 * Registering before layout-ready would invalidate the saved hashes on every reload.
 */
export function registerStatusCacheInvalidationEvents(
	workspace: Pick<Workspace, "onLayoutReady">,
	vault: Pick<Vault, "on">,
	registerEvent: (event: EventRef) => void,
	invalidate: (path: string) => void,
): void {
	workspace.onLayoutReady(() => {
		registerEvent(vault.on("create", (file) => invalidate(file.path)));
		registerEvent(vault.on("modify", (file) => invalidate(file.path)));
		registerEvent(vault.on("delete", (file) => invalidate(file.path)));
		registerEvent(vault.on("rename", (file, oldPath) => {
			invalidate(oldPath);
			invalidate(file.path);
		}));
	});
}

interface VerifiedHash {
	ctime: number;
	mtime: number;
	size: number;
	oid: string;
}
interface SavedRepository {
	root: string;
	signature: string;
	files: Array<[string, VerifiedHash]>;
}
interface SavedCache { version: number; repositories: SavedRepository[] }

export class VerifiedHashCache {
	readonly files = new Map<string, VerifiedHash>();
	private readonly invalidated = new Set<string>();
	signature = "";
	revision = 0;
	constructor(private readonly changed: () => void) {}

	setSignature(signature: string): void {
		if (this.signature === signature) return;
		for (const path of this.files.keys()) this.invalidated.add(path);
		this.files.clear();
		this.signature = signature;
		this.revision++;
		this.changed();
	}

	get(path: string, stat: Stat, now: number): string | undefined {
		const value = this.files.get(path);
		return value && reusableStat(stat, now) && sameStat(value, stat) ? value.oid : undefined;
	}

	needsHash(path: string): boolean { return this.files.has(path) || this.invalidated.has(path); }

	put(path: string, before: Stat, after: Stat | null, oid: string, revision: number, startedAt: number): void {
		if (this.revision !== revision || !after || !sameStat(before, after) || !reusableStat(after, startedAt)) return;
		this.files.delete(path);
		this.files.set(path, { ctime: after.ctime, mtime: after.mtime, size: after.size, oid });
		this.invalidated.delete(path);
		while (this.files.size > MAX_ENTRIES) this.files.delete(this.files.keys().next().value!);
		this.changed();
	}

	invalidate(path: string): void {
		this.revision++;
		this.invalidated.add(path);
		for (const key of this.files.keys()) {
			if (path === "." || key === path || key.startsWith(`${path}/`)) {
				this.files.delete(key);
				this.invalidated.add(key);
			}
		}
		while (this.invalidated.size > MAX_ENTRIES) this.invalidated.delete(this.invalidated.values().next().value!);
		this.changed();
	}
}

function sameStat(left: Pick<Stat, "ctime" | "mtime" | "size">, right: Stat): boolean {
	return left.ctime === right.ctime && left.mtime === right.mtime && left.size === right.size;
}
function reusableStat(stat: Stat, now: number): boolean {
	return stat.type === "file" && Number.isFinite(stat.ctime) && Number.isFinite(stat.mtime) &&
		stat.ctime > 0 && stat.mtime > 0 && Number.isFinite(stat.size) && stat.size >= 0 &&
		Math.max(stat.ctime, stat.mtime) < now - 2000;
}

class StatusCacheStore {
	readonly repositories = new Map<string, VerifiedHashCache>();
	private dirty = false;
	constructor(private readonly save?: (value: SavedCache) => void) {}
	get(root: string): VerifiedHashCache {
		let cache = this.repositories.get(root);
		if (!cache) {
			cache = new VerifiedHashCache(() => { this.dirty = true; });
			this.repositories.set(root, cache);
		}
		return cache;
	}
	flush(): boolean {
		if (!this.save || !this.dirty) return true;
		const repositories: SavedRepository[] = [];
		let remaining = MAX_ENTRIES;
		for (const [root, cache] of this.repositories) {
			const files = [...cache.files].slice(-remaining);
			if (remaining > 0 && files.length) repositories.push({ root, signature: cache.signature, files });
			remaining -= files.length;
			if (remaining <= 0) break;
		}
		try {
			this.save({ version: VERSION, repositories });
			this.dirty = false;
			return true;
		} catch { return false; } // Storage failure must not prevent a status read.
	}
}

/** Obsidian's App local storage is scoped to this vault and device; no file contents are saved. */
export function configureStatusCache(adapter: DataAdapter, saved: unknown, save: (value: unknown) => void): void {
	const store = new StatusCacheStore(save);
	stores.set(adapter, store);
	if (!saved || typeof saved !== "object") return;
	const value = saved as Partial<SavedCache>;
	if (value.version !== VERSION || !Array.isArray(value.repositories)) return;
	let remaining = MAX_ENTRIES;
	for (const repository of value.repositories) {
		if (!repository || typeof repository.root !== "string" || !/^[a-f0-9]{40}$/.test(repository.signature) || !Array.isArray(repository.files)) continue;
		try {
			const cache = store.get(normalizeRepositoryRoot(repository.root));
			cache.signature = repository.signature;
			for (const entry of repository.files) {
				if (remaining <= 0) return;
				if (!Array.isArray(entry) || entry.length !== 2) continue;
				const [path, hash] = entry;
				if (!hash || !/^[a-f0-9]{40}$/.test(hash.oid) || !reusableStat({ ...hash, type: "file" }, Date.now())) continue;
				cache.files.set(normalizeRepositoryFilePath(path), { ctime: hash.ctime, mtime: hash.mtime, size: hash.size, oid: hash.oid });
				remaining--;
			}
		} catch { /* Discard malformed records and use a fresh verification. */ }
	}
}

export function getStatusHashCache(adapter: DataAdapter, root: string): VerifiedHashCache {
	let store = stores.get(adapter);
	if (!store) { store = new StatusCacheStore(); stores.set(adapter, store); }
	return store.get(normalizeRepositoryRoot(root));
}
export function flushStatusCache(adapter: DataAdapter): boolean { return stores.get(adapter)?.flush() ?? true; }

export function invalidateStatusHashCache(adapter: DataAdapter, vaultPath: string): void {
	const path = normalizeRepositoryRoot(vaultPath);
	for (const [root, cache] of stores.get(adapter)?.repositories ?? []) {
		if (root === ".") cache.invalidate(path);
		else if (path === root || root.startsWith(`${path}/`)) {
			cache.invalidate(".");
		} else if (path.startsWith(`${root}/`)) cache.invalidate(path.slice(root.length + 1));
	}
}
