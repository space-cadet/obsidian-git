/**
 * Logger utility for Obsidian Git Sync plugin
 * Provides consistent logging functionality with different log levels
 */

import { Notice, normalizePath } from 'obsidian';
import { redactSensitiveData, redactSensitiveText } from './security';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: number;
  level: string;
  namespace: string;
  message: string;
  data?: any;
}

export type FileLogSink = (level: string, ...args: unknown[]) => void;

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private showNotices: boolean = true;
  private entries: LogEntry[] = [];
  private maxEntries: number = 500;
  private sensitiveValues: string[] = [];
  private recentNoticeTimes = new Map<string, number>();
  private readonly noticeCooldownMs = 5 * 60 * 1000;
  private fileLogSink: FileLogSink | null = null;

  private constructor() {}

  /**
   * Get the singleton instance of the logger
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Get recent log entries for display
   */
  public getEntries(): LogEntry[] {
    return this.entries;
  }

  /** Clear the in-memory activity log shown in the sidebar. */
  public clear(): void {
    this.entries = [];
  }

  /**
   * Export logs to a markdown file in the vault
   */
  public async exportToFile(vault: any, filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = filename || `.obsidian/plugins/obsidian-git-sync/debug-log-${timestamp}.md`;
    
    // Ensure parent directory exists
    const normalizedPath = normalizePath(path);
    const folder = normalizedPath.split('/').slice(0, -1).join('/');
    if (folder) {
      try {
        await vault.adapter.mkdir(folder);
      } catch (e: any) {
        // Directory might already exist, that's fine
        if (!e.message?.includes('already exists')) {
          throw e;
        }
      }
    }
    
    const lines: string[] = [
      '# Obsidian Git Sync — Debug Log',
      '',
      `**Generated:** ${new Date().toLocaleString()}`,
      `**Entries:** ${this.entries.length}`,
      `**Log Level:** ${LogLevel[this.logLevel]}`,
      '',
      '---',
      '',
    ];

    for (const entry of this.entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const emoji = entry.level === 'error' ? '🔴' : entry.level === 'warn' ? '⚠️' : entry.level === 'debug' ? '🔍' : 'ℹ️';
      lines.push(`### ${emoji} [${entry.level.toUpperCase()}] ${entry.namespace} — ${time}`);
      lines.push('');
      lines.push(entry.message);
      if (entry.data) {
        lines.push('');
        lines.push('```json');
        try {
          lines.push(JSON.stringify(entry.data, null, 2).slice(0, 2000));
        } catch {
          lines.push(String(entry.data).slice(0, 2000));
        }
        lines.push('```');
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    const content = lines.join('\n');
    await vault.adapter.write(path, content);
    return path;
  }

  /**
   * Set the maximum number of entries to keep in memory
   */
  public setMaxEntries(max: number): void {
    this.maxEntries = max;
  }

  /**
   * Set the minimum log level to display
   */
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Set whether to show notices for warnings and errors
   */
  public setShowNotices(show: boolean): void {
    this.showNotices = show;
  }

  /** Show a background warning/error once per message during the cooldown. */
  private showNotice(level: 'Warning' | 'Error', message: string): void {
    const key = `${level}:${message}`;
    const now = Date.now();
    const previous = this.recentNoticeTimes.get(key);
    if (previous !== undefined && now - previous < this.noticeCooldownMs) return;

    this.recentNoticeTimes.set(key, now);
    if (this.recentNoticeTimes.size > 100) {
      for (const [noticeKey, timestamp] of this.recentNoticeTimes) {
        if (now - timestamp >= this.noticeCooldownMs) this.recentNoticeTimes.delete(noticeKey);
      }
    }
    new Notice(`[${level}] ${message}`);
  }

  public setSensitiveValues(values: readonly unknown[]): void {
    this.sensitiveValues = values
      .filter((value): value is string => typeof value === 'string' && value.length >= 3);
  }

  /** Attach the plugin-owned persistent log sink without touching global console state. */
  public setFileLogSink(sink: FileLogSink | null): void {
    this.fileLogSink = sink;
  }

  /**
   * Log a debug message
   */
  public debug(context: string, message: string, data?: any): void {
    const safeMessage = redactSensitiveText(message, this.sensitiveValues);
    const safeData = redactSensitiveData(data, this.sensitiveValues);
    this.pushEntry('debug', context, safeMessage, safeData);
    if (this.logLevel <= LogLevel.DEBUG) {
      console.debug(`[Git Sync][${context}] ${safeMessage}`, safeData || '');
    }
  }

  /**
   * Log an info message
   */
  public info(context: string, message: string, data?: any): void {
    const safeMessage = redactSensitiveText(message, this.sensitiveValues);
    const safeData = redactSensitiveData(data, this.sensitiveValues);
    this.pushEntry('info', context, safeMessage, safeData);
    if (this.logLevel <= LogLevel.INFO) {
      console.info(`[Git Sync][${context}] ${safeMessage}`, safeData || '');
    }
  }

  /**
   * Log a warning message
   */
  public warn(context: string, message: string, data?: any): void {
    const safeMessage = redactSensitiveText(message, this.sensitiveValues);
    const safeData = redactSensitiveData(data, this.sensitiveValues);
    this.pushEntry('warn', context, safeMessage, safeData);
    if (this.logLevel <= LogLevel.WARN) {
      console.warn(`[Git Sync][${context}] ${safeMessage}`, safeData || '');
      if (this.showNotices) {
        this.showNotice('Warning', safeMessage);
      }
    }
  }

  /**
   * Log an error message
   */
  public error(context: string, message: string, error?: Error): void {
    const safeMessage = redactSensitiveText(message, this.sensitiveValues);
    const safeError = redactSensitiveData(error, this.sensitiveValues);
    const errorText = error ? redactSensitiveText(error.message, this.sensitiveValues) : '';
    this.pushEntry('error', context, safeMessage, safeError || errorText);
    if (this.logLevel <= LogLevel.ERROR) {
      console.error(`[Git Sync][${context}] ${safeMessage}`, safeError || '');
      if (error && typeof safeError === 'object' && safeError && 'stack' in safeError) {
        console.error(`[Git Sync][${context}] Stack trace:`, (safeError as { stack?: string }).stack || '');
      }
      if (this.showNotices) {
        this.showNotice('Error', `${safeMessage}${errorText ? `: ${errorText}` : ''}`);
      }
    }
  }

  private pushEntry(level: string, namespace: string, message: string, data?: any): void {
    const safeMessage = redactSensitiveText(message, this.sensitiveValues);
    const safeData = redactSensitiveData(data, this.sensitiveValues);
    this.entries.push({
      timestamp: Date.now(),
      level,
      namespace,
      message: safeMessage,
      data: safeData,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    const levelRank: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
      fatal: LogLevel.ERROR,
    };
    if ((levelRank[level] ?? LogLevel.INFO) >= this.logLevel) {
      this.fileLogSink?.(
        level,
        `[Git Sync][${namespace}] ${safeMessage}`,
        safeData || '',
      );
    }
  }
}

// Export a default instance for easy import
export const log = Logger.getInstance();
