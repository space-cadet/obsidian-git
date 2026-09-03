import { App, Platform } from 'obsidian';
import { redactSensitiveData, redactSensitiveText } from './security';

const ORIGINAL_CONSOLE = {
	debug: console.debug,
	log: console.log,
	error: console.error,
	warn: console.warn,
	info: console.info,
};

/**
 * Persistent diagnostic logger modelled on the sibling plugin's debug logger.
 * It is intentionally buffered so normal logging does not add a vault write to
 * every Git or updater operation.
 */
export class FileLogger {
	private buffer: string[] = [];
	private flushTimer: number | null = null;
	private memoryTimer: number | null = null;
	private flushInProgress: Promise<void> | null = null;
	private flushQueued = false;
	private readonly pluginDir: string;
	private readonly logPath: string;
	private maxSize: number;
	private readonly app: App;
	private initialized = false;
	private stopped = false;
	private bytesWrittenSinceCheck = 0;
	private sensitiveValues: string[] = [];
	private originalOnError: OnErrorEventHandler | null = null;
	private originalOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;
	private static readonly CHECK_INTERVAL = 100 * 1024;

	constructor(app: App, pluginId: string, maxSizeBytes = 5 * 1024 * 1024) {
		this.app = app;
		this.pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
		this.logPath = `${this.pluginDir}/debug.log`;
		this.maxSize = maxSizeBytes;
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		this.stopped = false;

		try {
			await this.app.vault.adapter.mkdir(this.pluginDir);
		} catch {
			// The plugin directory normally already exists.
		}

		(window as any).__obsidianGitLogger = this;
		this.originalOnError = window.onerror;
		this.originalOnUnhandledRejection = window.onunhandledrejection;
		this.wrapConsole();
		this.setupErrorHandlers();

		this.writeDirect('info', '=== Obsidian Git Sync debug log started ===');
		this.writeDirect('info', `Platform: ${Platform.isMobile ? 'mobile' : 'desktop'}`);
		this.writeDirect('info', `Obsidian version: ${(window as any).app?.version || 'unknown'}`);

		// Do not make startup wait while an old, oversized diagnostic file is read.
		window.setTimeout(() => {
			this.truncateIfNeeded().catch(() => undefined);
		}, 5000);

		this.logMemorySnapshot();
		this.memoryTimer = window.setInterval(() => this.logMemorySnapshot(), 10000);
	}

	setMaxSize(bytes: number): void {
		this.maxSize = bytes;
	}

	setSensitiveValues(values: readonly unknown[]): void {
		this.sensitiveValues = values.filter(
			(value): value is string => typeof value === 'string' && value.length >= 3,
		);
	}

	log(level: string, ...args: unknown[]): void {
		this.buffer.push(this.formatLine(level, ...args));
		if (level === 'error' || level === 'fatal') {
			this.flushNow();
		} else {
			this.scheduleFlush();
		}
	}

	writeDirect(level: string, ...args: unknown[]): void {
		this.buffer.push(this.formatLine(level, ...args));
		this.flushNow();
	}

	flushNow(): void {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		void this.flush();
	}

	async clear(): Promise<void> {
		this.buffer = [];
		await this.flush();
		try {
			await (this.app.vault.adapter as any).write(this.logPath, '');
		} catch {
			// Clearing diagnostics is best effort.
		}
	}

	stop(): void {
		if (this.memoryTimer !== null) {
			window.clearInterval(this.memoryTimer);
			this.memoryTimer = null;
		}
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.stopped = true;
		console.log = ORIGINAL_CONSOLE.log;
		console.debug = ORIGINAL_CONSOLE.debug;
		console.error = ORIGINAL_CONSOLE.error;
		console.warn = ORIGINAL_CONSOLE.warn;
		console.info = ORIGINAL_CONSOLE.info;
		if (window.onerror === this.handleWindowError) window.onerror = this.originalOnError;
		if (window.onunhandledrejection === this.handleUnhandledRejection) {
			window.onunhandledrejection = this.originalOnUnhandledRejection;
		}
		this.flushNow();
	}

	private readonly handleWindowError: OnErrorEventHandler = (message, source, lineno, colno, error) => {
		this.writeDirect('fatal', `window.onerror: ${message} at ${source}:${lineno}:${colno}`, error?.stack || '');
		return this.originalOnError ? this.originalOnError.call(window, message, source, lineno, colno, error) : false;
	};

	private readonly handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
		this.writeDirect(
			'fatal',
			'Unhandled rejection:',
			event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason),
		);
		this.originalOnUnhandledRejection?.call(window, event);
	};

	private wrapConsole(): void {
		console.debug = (...args: unknown[]) => {
			ORIGINAL_CONSOLE.debug.apply(console, args);
			this.log('debug', ...args);
		};
		console.log = (...args: unknown[]) => {
			ORIGINAL_CONSOLE.log.apply(console, args);
			this.log('log', ...args);
		};
		console.error = (...args: unknown[]) => {
			ORIGINAL_CONSOLE.error.apply(console, args);
			this.log('error', ...args);
		};
		console.warn = (...args: unknown[]) => {
			ORIGINAL_CONSOLE.warn.apply(console, args);
			this.log('warn', ...args);
		};
		console.info = (...args: unknown[]) => {
			ORIGINAL_CONSOLE.info.apply(console, args);
			this.log('info', ...args);
		};
	}

	private setupErrorHandlers(): void {
		window.onerror = this.handleWindowError;
		window.onunhandledrejection = this.handleUnhandledRejection;
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) return;
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, 250);
	}

	private logMemorySnapshot(): void {
		const mem = (performance as any).memory;
		const domNodes = typeof document === 'undefined' ? 0 : document.getElementsByTagName('*').length;
		if (mem) {
			this.log(
				'metric',
				`Memory — used: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)} MB, total: ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)} MB, limit: ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(1)} MB, DOM nodes: ${domNodes}`,
			);
		} else {
			this.log('metric', `Memory — N/A, DOM nodes: ${domNodes}`);
		}
	}

	private formatLine(level: string, ...args: unknown[]): string {
		const message = args.map((value) => {
			const safeValue = redactSensitiveData(value, this.sensitiveValues);
			if (safeValue instanceof Error) return safeValue.stack || safeValue.message;
			if (typeof safeValue === 'object' && safeValue !== null) {
				try {
					return JSON.stringify(safeValue);
				} catch {
					return String(safeValue);
				}
			}
			return redactSensitiveText(String(safeValue), this.sensitiveValues);
		}).join(' ');
		return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;
	}

	private async truncateIfNeeded(): Promise<void> {
		try {
			await Promise.race([
				this.truncateIfNeededCore(),
				new Promise((_, reject) => window.setTimeout(() => reject(new Error('debug log truncate timeout')), 2000)),
			]);
		} catch {
			try {
				await (this.app.vault.adapter as any).write(this.logPath, '');
			} catch {
				// Best effort recovery from an unreadable oversized log.
			}
		}
	}

	private async truncateIfNeededCore(): Promise<void> {
		const adapter = this.app.vault.adapter as any;
		let existing = '';
		try {
			existing = await adapter.read(this.logPath);
		} catch {
			return;
		}
		if (existing.length <= this.maxSize) return;
		const truncated = existing.slice(-Math.floor(this.maxSize / 2));
		await adapter.write(this.logPath, `...[truncated at ${new Date().toISOString()}]...\n${truncated}`);
	}

	private async flush(): Promise<void> {
		if (this.flushInProgress) {
			this.flushQueued = true;
			return this.flushInProgress;
		}
		if (this.buffer.length === 0) return;

		const content = this.buffer.join('');
		this.buffer = [];
		this.bytesWrittenSinceCheck += content.length;
		this.flushInProgress = (async () => {
			try {
				const adapter = this.app.vault.adapter as any;
				if (typeof adapter.append === 'function') {
					await adapter.append(this.logPath, content);
				} else {
					let existing = '';
					try {
						existing = await adapter.read(this.logPath);
					} catch {
						// The log may not exist yet.
					}
					await adapter.write(this.logPath, existing + content);
				}
				if (this.bytesWrittenSinceCheck > FileLogger.CHECK_INTERVAL) {
					this.bytesWrittenSinceCheck = 0;
					void this.truncateIfNeeded();
				}
			} catch (error) {
				// Never use console here because it would recurse through the wrapper.
				ORIGINAL_CONSOLE.error('[FileLogger] flush failed:', error);
			}
		})().finally(() => {
			this.flushInProgress = null;
			if (this.flushQueued || this.buffer.length > 0) {
				this.flushQueued = false;
				void this.flush();
			}
		});
		return this.flushInProgress;
	}
}
