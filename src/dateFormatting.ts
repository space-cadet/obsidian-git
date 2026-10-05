export function formatLogTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number): string => `0${value}`.slice(-2);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatCommitTimestamp(timestamp: number): string {
	return formatLogTimestamp(timestamp * 1000);
}

export function formatRelativeCommitTime(timestamp: number): string {
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
	if (seconds < 60) return "just now";
	if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 60 * 60 * 24) return `${Math.floor(seconds / (60 * 60))}h ago`;
	if (seconds < 60 * 60 * 24 * 30) return `${Math.floor(seconds / (60 * 60 * 24))}d ago`;
	if (seconds < 60 * 60 * 24 * 365) return `${Math.floor(seconds / (60 * 60 * 24 * 30))}mo ago`;
	return `${Math.floor(seconds / (60 * 60 * 24 * 365))}y ago`;
}
