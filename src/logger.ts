export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3
}

export class Logger {
	private static instance: Logger;
	private level: LogLevel = LogLevel.INFO;

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	setLogLevel(level: LogLevel) {
		this.level = level;
	}

	debug(context: string, message: string, ...args: any[]) {
		if (this.level <= LogLevel.DEBUG) console.log(`[${context}] ${message}`, ...args);
	}

	info(context: string, message: string, ...args: any[]) {
		if (this.level <= LogLevel.INFO) console.log(`[${context}] ${message}`, ...args);
	}

	warn(context: string, message: string, ...args: any[]) {
		if (this.level <= LogLevel.WARN) console.warn(`[${context}] ${message}`, ...args);
	}

	error(context: string, message: string, error?: any) {
		if (this.level <= LogLevel.ERROR) console.error(`[${context}] ${message}`, error || '');
	}
}

export const log = Logger.getInstance();
