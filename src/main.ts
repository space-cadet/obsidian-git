import { App, Plugin, Notice, normalizePath, TFile } from 'obsidian';
import * as git from 'isomorphic-git';
import { Buffer } from 'buffer';

// Polyfill Buffer for browser/mobile environment
if (typeof window !== 'undefined') {
	(window as any).Buffer = Buffer;
}

// Minimal fs adapter for isomorphic-git using Obsidian Vault API
class VaultFsAdapter {
	constructor(private vault: any) {}

	// Promisify helper
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
			const normalized = normalizePath(path);
			// Obsidian creates folders automatically on file create, but let's try adapter
			try {
				await this.vault.adapter.mkdir(normalized);
			} catch (e) {
				// Folder might already exist or adapter doesn't support it
			}
		}, cb);
	}

	rmdir(path: string, cb: (err: any) => void) {
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			try {
				await this.vault.adapter.rmdir(normalized);
			} catch (e) {
				// Ignore
			}
		}, cb);
	}

	readdir(path: string, ...args: any[]) {
		const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			try {
				const result = await this.vault.adapter.list(normalized);
				// Obsidian adapter.list returns { files: string[], folders: string[] }
				const entries: string[] = [];
				if (result && typeof result === 'object') {
					if (Array.isArray(result.folders)) entries.push(...result.folders);
					if (Array.isArray(result.files)) entries.push(...result.files);
				}
				return entries;
			} catch (e) {
				return [];
			}
		}, cb);
	}

	stat(path: string, cb: (err: any, stats?: any) => void) {
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			const file = this.vault.getAbstractFileByPath(normalized);
			if (file instanceof TFile) {
				return {
					isFile: () => true,
					isDirectory: () => false,
					size: file.stat.size,
					mtimeMs: file.stat.mtime,
					ctimeMs: file.stat.ctime,
				};
			}
			// Try to see if it's a directory
			try {
				const result = await this.vault.adapter.list(normalized);
				if (result) {
					return {
						isFile: () => false,
						isDirectory: () => true,
						size: 0,
						mtimeMs: Date.now(),
						ctimeMs: Date.now(),
					};
				}
			} catch (e) {
				// Not a directory either
			}
			throw new Error(`ENOENT: ${path}`);
		}, cb);
	}

	lstat(path: string, cb: (err: any, stats?: any) => void) {
		this.stat(path, cb);
	}

	unlink(path: string, cb: (err: any) => void) {
		this.callbackify(async () => {
			const normalized = normalizePath(path);
			const file = this.vault.getAbstractFileByPath(normalized);
			if (file instanceof TFile) {
				await this.vault.delete(file);
			}
		}, cb);
	}
}

export default class IsomorphicGitTestPlugin extends Plugin {
	async onload() {
		console.log('[IsoGitTest] Plugin loaded');

		this.addCommand({
			id: 'test-isomorphic-git',
			name: 'Test isomorphic-git (mobile spike)',
			callback: async () => {
				await this.runTest();
			}
		});

		new Notice('IsoGit Test Plugin loaded. Run command "Test isomorphic-git" from palette.');
	}

	async runTest() {
		const notices: string[] = [];
		const log = (msg: string) => {
			console.log('[IsoGitTest]', msg);
			notices.push(msg);
		};

		try {
			log('Starting isomorphic-git test...');

			// Create fs adapter
			const fs = new VaultFsAdapter(this.app.vault);
			const dir = '.'; // Vault root

			// Step 1: Init repo
			log('Step 1: git.init...');
			await git.init({ fs, dir, defaultBranch: 'main' });
			log('✅ git.init succeeded');

			// Step 2: Create a test file
			log('Step 2: Creating test file...');
			const testFile = 'iso-git-test.md';
			const testContent = `# Test\n\nCreated at ${new Date().toISOString()}`;
			
			const existing = this.app.vault.getAbstractFileByPath(testFile);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, testContent);
			} else {
				await this.app.vault.create(testFile, testContent);
			}
			log('✅ Test file created');

			// Step 3: Git add
			log('Step 3: git.add...');
			await git.add({ fs, dir, filepath: testFile });
			log('✅ git.add succeeded');

			// Step 4: Git commit
			log('Step 4: git.commit...');
			await git.commit({
				fs,
				dir,
				message: 'Test commit from isomorphic-git spike',
				author: {
					name: 'Test User',
					email: 'test@example.com',
				}
			});
			log('✅ git.commit succeeded');

			// Step 5: Git log
			log('Step 5: git.log...');
			const commits = await git.log({ fs, dir, depth: 5 });
			log(`✅ git.log succeeded, found ${commits.length} commits`);

			// Step 6: Git status
			log('Step 6: git.status...');
			const status = await git.statusMatrix({ fs, dir });
			log(`✅ git.statusMatrix succeeded, ${status.length} entries`);

			// Success summary
			const summary = notices.join('\n');
			new Notice(`IsoGit Test ✅ PASSED\n${commits.length} commits found\nSee console for details`, 10000);
			console.log('=== IsoGit Test Results ===');
			console.log(summary);
			console.log('Commits:', commits);
			console.log('Status:', status);

		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			log(`❌ FAILED: ${errMsg}`);
			console.error('IsoGit Test Error:', error);
			new Notice(`IsoGit Test ❌ FAILED\n${errMsg}\nSee console for stack trace`, 10000);
		}
	}

	onunload() {
		console.log('[IsoGitTest] Plugin unloaded');
	}
}
