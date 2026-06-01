/**
 * Logger utility for Obsidian Git Sync plugin
 * Provides consistent logging functionality with different log levels
 */

import { Notice, normalizePath } from 'obsidian';

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

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private showNotices: boolean = true;
  private entries: LogEntry[] = [];
  private maxEntries: number = 500;

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

  /**
   * Log a debug message
   */
  public debug(context: string, message: string, data?: any): void {
    this.pushEntry('debug', context, message, data);
    if (this.logLevel <= LogLevel.DEBUG) {
      console.debug(`[Git Sync][${context}] ${message}`, data || '');
    }
  }

  /**
   * Log an info message
   */
  public info(context: string, message: string, data?: any): void {
    this.pushEntry('info', context, message, data);
    if (this.logLevel <= LogLevel.INFO) {
      console.info(`[Git Sync][${context}] ${message}`, data || '');
    }
  }

  /**
   * Log a warning message
   */
  public warn(context: string, message: string, data?: any): void {
    this.pushEntry('warn', context, message, data);
    if (this.logLevel <= LogLevel.WARN) {
      console.warn(`[Git Sync][${context}] ${message}`, data || '');
      if (this.showNotices) {
        new Notice(`[Warning] ${message}`);
      }
    }
  }

  /**
   * Log an error message
   */
  public error(context: string, message: string, error?: Error): void {
    this.pushEntry('error', context, message, error?.message || error);
    if (this.logLevel <= LogLevel.ERROR) {
      console.error(`[Git Sync][${context}] ${message}`, error || '');
      if (error?.stack) {
        console.error(`[Git Sync][${context}] Stack trace:`, error.stack);
      }
      if (this.showNotices) {
        new Notice(`[Error] ${message}${error ? `: ${error.message}` : ''}`);
      }
    }
  }

  private pushEntry(level: string, namespace: string, message: string, data?: any): void {
    this.entries.push({
      timestamp: Date.now(),
      level,
      namespace,
      message,
      data
    });
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
}

// Export a default instance for easy import
export const log = Logger.getInstance();