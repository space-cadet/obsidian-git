export const PLUGIN_DATA_FORMAT = "obsidian-git-sync";
export const PLUGIN_DATA_SCHEMA_VERSION = 1 as const;
export const ACTIVITY_PAGE_SIZE = 100;
export const MAX_ACTIVITY_ENTRIES = 1000;
export const ACTIVITY_LOG_COMPACTION_THRESHOLD = MAX_ACTIVITY_ENTRIES + ACTIVITY_PAGE_SIZE;

export interface GitSyncSettings {
	repositoryPath: string;
	remoteUrl: string;
	remoteUsername: string;
	branchName: string;
	authorName: string;
	authorEmail: string;
	checkForUpdates: boolean;
	updateChannel: "stable" | "dev";
	autoUpdate: boolean;
	lastUpdateCheck: number;
	includeActivityInExports: boolean;
	backgroundRefreshDelaySeconds: number;
}

export interface ActivityEntry {
	message: string;
	timestamp: number;
	level: ActivityLevel;
}

export type ActivityLevel = "DEBUG" | "INFO" | "METRIC" | "ERROR";

export interface StoredPluginData {
	format: typeof PLUGIN_DATA_FORMAT;
	schemaVersion: typeof PLUGIN_DATA_SCHEMA_VERSION;
	settings: GitSyncSettings;
}

export interface DecodedPluginData {
	settings: Partial<GitSyncSettings>;
	activity: unknown;
	legacy: boolean;
}

export const DEFAULT_SETTINGS: GitSyncSettings = {
	repositoryPath: ".",
	remoteUrl: "",
	remoteUsername: "git",
	branchName: "main",
	authorName: "",
	authorEmail: "",
	checkForUpdates: true,
	updateChannel: "dev",
	autoUpdate: false,
	lastUpdateCheck: 0,
	includeActivityInExports: false,
	backgroundRefreshDelaySeconds: 30,
};

export function decodePluginData(
	value: unknown,
	allowLegacy: boolean,
	requireRecognizedData = false,
): DecodedPluginData {
	if (!isRecord(value)) {
		if (requireRecognizedData) throw new Error("Git Sync data must be a JSON object.");
		return { settings: {}, activity: [], legacy: false };
	}
	if ("format" in value && value.format !== PLUGIN_DATA_FORMAT) {
		throw new Error("This file belongs to a different plugin or data format.");
	}

	if (value.format === PLUGIN_DATA_FORMAT) {
		if (value.schemaVersion !== PLUGIN_DATA_SCHEMA_VERSION) {
			throw new Error(`Unsupported Git Sync data schema: ${String(value.schemaVersion)}.`);
		}
		if (!isRecord(value.settings)) throw new Error("Git Sync data is missing its settings object.");
		return { settings: value.settings as Partial<GitSyncSettings>, activity: value.activity, legacy: false };
	}

	if (!allowLegacy) throw new Error("This is not a Git Sync data file.");
	const legacyKeys = [
		"repositoryPath",
		"remoteUrl",
		"remoteUsername",
		"branchName",
		"authorName",
		"authorEmail",
		"checkForUpdates",
		"updateChannel",
		"autoUpdate",
		"lastUpdateCheck",
		"includeActivityInExports",
		"activity",
	];
	if (requireRecognizedData && !legacyKeys.some((key) => key in value)) {
		throw new Error("The selected file is not Git Sync plugin data.");
	}
	return {
		settings: value as Partial<GitSyncSettings>,
		activity: value.activity,
		legacy: true,
	};
}

export function normalizeSettings(value: Partial<GitSyncSettings>): GitSyncSettings {
	const settings = isRecord(value) ? value : {};
	const updateChannel = settings.updateChannel === "stable" ? "stable" : "dev";
	return {
		repositoryPath: nonEmptyString(settings.repositoryPath) || DEFAULT_SETTINGS.repositoryPath,
		remoteUrl: stringValue(settings.remoteUrl),
		remoteUsername: nonEmptyString(settings.remoteUsername) || DEFAULT_SETTINGS.remoteUsername,
		branchName: nonEmptyString(settings.branchName) || DEFAULT_SETTINGS.branchName,
		authorName: stringValue(settings.authorName),
		authorEmail: stringValue(settings.authorEmail),
		checkForUpdates: booleanValue(settings.checkForUpdates, DEFAULT_SETTINGS.checkForUpdates),
		updateChannel,
		autoUpdate: booleanValue(settings.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
		lastUpdateCheck: finiteNumber(settings.lastUpdateCheck, DEFAULT_SETTINGS.lastUpdateCheck),
		includeActivityInExports: booleanValue(settings.includeActivityInExports, DEFAULT_SETTINGS.includeActivityInExports),
		backgroundRefreshDelaySeconds: normalizeBackgroundRefreshDelay(settings.backgroundRefreshDelaySeconds),
	};
}

export function normalizeActivity(value: unknown): ActivityEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is Record<string, unknown> => isRecord(entry))
		.filter((entry) => typeof entry.message === "string" && Number.isFinite(entry.timestamp))
		.map((entry): ActivityEntry => ({
			message: String(entry.message),
			timestamp: Number(entry.timestamp),
			level: entry.level === "DEBUG" || entry.level === "METRIC" || entry.level === "ERROR" ? entry.level : "INFO",
		}))
		.slice(0, MAX_ACTIVITY_ENTRIES);
}

export function mergeActivity(...sources: ActivityEntry[][]): ActivityEntry[] {
	const seen = new Set<string>();
	const combined = sources.reduce<ActivityEntry[]>((all, source) => all.concat(source), []);
	return combined
		.filter((entry) => {
			const key = activityKey(entry);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((left, right) => right.timestamp - left.timestamp)
		.slice(0, MAX_ACTIVITY_ENTRIES);
}

export function serializeActivityEntry(entry: ActivityEntry): string {
	const message = entry.message.replace(/[\r\n]+/g, "\\n");
	return `${new Date(entry.timestamp).toISOString()} [${entry.level}] ${message}`;
}

export function parseActivityEntry(line: string): ActivityEntry | null {
	const match = /^(\S+)\s+\[(DEBUG|INFO|METRIC|ERROR)\]\s?(.*)$/.exec(line);
	if (!match) return null;
	const timestamp = Date.parse(match[1]);
	if (!Number.isFinite(timestamp)) return null;
	return {
		timestamp,
		level: match[2] as ActivityLevel,
		message: match[3].replace(/\\n/g, "\n"),
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBackgroundRefreshDelay(value: unknown): number {
	const delay = finiteNumber(value, DEFAULT_SETTINGS.backgroundRefreshDelaySeconds);
	return [0, 5, 15, 30, 60].indexOf(delay) >= 0 ? delay : DEFAULT_SETTINGS.backgroundRefreshDelaySeconds;
}

function activityKey(entry: ActivityEntry): string {
	return `${entry.timestamp}\u0000${entry.level}\u0000${entry.message}`;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function nonEmptyString(value: unknown): string {
	return stringValue(value).trim();
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
