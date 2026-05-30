import { App, Plugin, Notice, normalizePath, TFile } from 'obsidian';

// DIAGNOSTIC VERSION — progressively tests to find failure point
export default class IsoGitDiagnosticPlugin extends Plugin {
	async onload() {
		console.log('[IsoGitDiag] Plugin load starting...');
		
		new Notice('IsoGit Diagnostic: Plugin loaded', 3000);
		
		this.addCommand({
			id: 'test-isomorphic-git',
			name: 'Test isomorphic-git (mobile spike)',
			callback: async () => {
				await this.runTest();
			}
		});
		
		// Also try to auto-run on load for easier debugging
		// await this.runTest();
	}
	
	async runTest() {
		const results: string[] = [];
		const log = (msg: string) => {
			console.log('[IsoGitDiag]', msg);
			results.push(msg);
		};
		
		try {
			log('=== Test 1: Buffer polyfill ===');
			let Buffer: any;
			try {
				const bufferModule = await import('buffer');
				Buffer = bufferModule.Buffer;
				if (typeof globalThis !== 'undefined') {
					(globalThis as any).Buffer = Buffer;
				}
				log('✅ Buffer imported and polyfilled');
			} catch (e) {
				log(`❌ Buffer import failed: ${e.message}`);
				new Notice(`IsoGit ❌ Buffer failed: ${e.message}`, 10000);
				return;
			}
			
			log('=== Test 2: isomorphic-git import ===');
			let git: any;
			try {
				git = await import('isomorphic-git');
				log('✅ isomorphic-git imported');
			} catch (e) {
				log(`❌ isomorphic-git import failed: ${e.message}`);
				new Notice(`IsoGit ❌ Import failed: ${e.message}`, 10000);
				return;
			}
			
			log('=== Test 3: VaultFsAdapter ===');
			const fs = new VaultFsAdapter(this.app.vault);
			log('✅ VaultFsAdapter created');
			
			log('=== Test 4: git.init ===');
			await git.init({ fs, dir: '.', defaultBranch: 'main' });
			log('✅ git.init succeeded');
			
			log('=== Test 5: Create file ===');
			const testFile = 'iso-git-test.md';
			const content = `# Test\nCreated ${new Date().toISOString()}`;
			const existing = this.app.vault.getAbstractFileByPath(testFile);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(testFile, content);
			}
			log('✅ Test file created');
			
			log('=== Test 6: git.add ===');
			await git.add({ fs, dir: '.', filepath: testFile });
			log('✅ git.add succeeded');
			
			log('=== Test 7: git.commit ===');
			await git.commit({
				fs,
				dir: '.',
				message: 'Test commit',
				author: { name: 'Test', email: 'test@test.com' }
			});
			log('✅ git.commit succeeded');
			
			log('=== Test 8: git.log ===');
			const commits = await git.log({ fs, dir: '.', depth: 5 });
			log(`✅ git.log: ${commits.length} commits`);
			
			new Notice(`IsoGit ✅ ALL PASSED\n${commits.length} commits`, 10000);
			console.log('=== IsoGit FULL RESULTS ===', results);
			
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			log(`❌ UNEXPECTED: ${errMsg}`);
			console.error('IsoGit Error:', error);
			new Notice(`IsoGit ❌ FAILED: ${errMsg}`, 10000);
		}
	}
	
	onunload() {
		console.log('[IsoGitDiag] Plugin unloaded');
	}
}

class VaultFsAdapter {
	constructor(private vault: any) {}
	
	private callbackify<T>(fn: () => Promise<T>, cb: (err: any, result?: T) => void) {
		fn().then(result => cb(null, result)).catch(err => cb(err));
	}
	
	readFile(path: string, ...args: any[]) {
		const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
		const options = args[0] || {};
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			const file = this.vault.getAbstractFileByPath(normalized);
			if (file instanceof TFile) {
				const content = await this.vault.read(file);
				if (options.encoding === 'utf8') return content;
				return Buffer.from(content);
			}
			throw new Error(`ENOENT: ${path}`);
		}, cb);
	}
	
	writeFile(path: string, data: any, ...args: any[]) {
		const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			const content = data instanceof Buffer ? data.toString('utf8') : data;
			const existing = this.vault.getAbstractFileByPath(normalized);
			if (existing instanceof TFile) {
				await this.vault.modify(existing, content);
			} else {
				await this.vault.create(normalized, content);
			}
		}, cb);
	}
	
	mkdir(path: string, ...args: any[]) {
		const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
		this.callbackify(async () => {
			try { await this.vault.adapter.mkdir(normalizePath(path)); } catch (e) {}
		}, cb);
	}
	
	rmdir(path: string, cb: (err: any) => void) {
		this.callbackify(async () => {
			try { await this.vault.adapter.rmdir(normalizePath(path)); } catch (e) {}
		}, cb);
	}
	
	readdir(path: string, ...args: any[]) {
		const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
		this.callbackify(async () => {
			try {
				const result = await this.vault.adapter.list(normalizePath(path));
				const entries: string[] = [];
				if (result && typeof result === 'object') {
					if (Array.isArray(result.folders)) entries.push(...result.folders);
					if (Array.isArray(result.files)) entries.push(...result.files);
				}
				return entries;
			} catch (e) { return []; }
		}, cb);
	}
	
	stat(path: string, cb: (err: any, stats?: any) => void) {
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			const file = this.vault.getAbstractFileByPath(normalized);
			if (file instanceof TFile) {
				return { isFile: () => true, isDirectory: () => false, size: file.stat.size, mtimeMs: file.stat.mtime, ctimeMs: file.stat.ctime };
			}
			try {
				const result = await this.vault.adapter.list(normalized);
				if (result) return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: Date.now(), ctimeMs: Date.now() };
			} catch (e) {}
			throw new Error(`ENOENT: ${path}`);
		}, cb);
	}
	
	lstat(path: string, cb: (err: any, stats?: any) => void) {
		this.stat(path, cb);
	}
	
	readlink(path: string, cb: (err: any, result?: any) => void) {
		this.callbackify(async () => {
			throw new Error(`readlink not supported: ${path}`);
		}, cb);
	}
	
	symlink(target: string, path: string, cb: (err: any) => void) {
		this.callbackify(async () => {
			throw new Error(`symlink not supported: ${path} -> ${target}`);
		}, cb);
	}
}