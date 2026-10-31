class MemoryAdapter {
	constructor() {
		this.files = new Map();
		this.folders = new Set([""]);
		this.modifiedTimes = new Map();
		this.clock = Date.now();
	}

	normalize(path) {
		const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
		return normalized === "." ? "" : normalized;
	}

	ensureFolders(path) {
		const parts = this.normalize(path).split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			this.folders.add(current);
		}
	}

	async exists(path) {
		const normalized = this.normalize(path);
		return this.files.has(normalized) || this.folders.has(normalized);
	}

	async read(path) {
		const value = this.files.get(this.normalize(path));
		if (value === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
		return typeof value === "string" ? value : new TextDecoder().decode(value);
	}

	async readBinary(path) {
		const value = this.files.get(this.normalize(path));
		if (value === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
		const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	}

	async write(path, data) {
		const normalized = this.normalize(path);
		this.ensureFolders(normalized.split("/").slice(0, -1).join("/"));
		this.files.set(normalized, data);
		this.modifiedTimes.set(normalized, this.clock += 1000);
	}

	async writeBinary(path, data) {
		const normalized = this.normalize(path);
		this.ensureFolders(normalized.split("/").slice(0, -1).join("/"));
		this.files.set(normalized, new Uint8Array(data));
		this.modifiedTimes.set(normalized, this.clock += 1000);
	}

	async remove(path) {
		const normalized = this.normalize(path);
		if (!this.files.delete(normalized)) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
	}

	async list(path) {
		const normalized = this.normalize(path);
		const prefix = normalized ? `${normalized}/` : "";
		const files = [...this.files.keys()].filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes("/"));
		const folders = [...this.folders].filter((entry) => entry && entry.startsWith(prefix) && !entry.slice(prefix.length).includes("/"));
		return { files, folders };
	}

	async mkdir(path) {
		this.ensureFolders(path);
	}

	async rmdir(path, recursive = false) {
		const normalized = this.normalize(path);
		const prefix = `${normalized}/`;
		if (!recursive && ([...this.files.keys()].some((entry) => entry.startsWith(prefix)) || [...this.folders].some((entry) => entry.startsWith(prefix)))) {
			throw Object.assign(new Error(`ENOTEMPTY ${path}`), { code: "ENOTEMPTY" });
		}
		for (const entry of [...this.files.keys()]) if (entry.startsWith(prefix)) this.files.delete(entry);
		for (const entry of [...this.folders]) if (entry === normalized || entry.startsWith(prefix)) this.folders.delete(entry);
	}

	async stat(path) {
		const normalized = this.normalize(path);
		if (this.files.has(normalized)) {
			const value = this.files.get(normalized);
			return { type: "file", ctime: 1, mtime: this.modifiedTimes.get(normalized) ?? 1, size: typeof value === "string" ? value.length : value.byteLength };
		}
		if (this.folders.has(normalized)) return { type: "folder", ctime: 1, mtime: 1, size: 0 };
		throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
	}
}

module.exports = { MemoryAdapter };
