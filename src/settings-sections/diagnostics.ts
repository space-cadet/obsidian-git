import { App, Platform, Setting } from 'obsidian';

export type DiagnosticLogLevel = 'off' | 'error' | 'info' | 'debug';

interface DiagnosticsSettings {
	debugLogLevel: DiagnosticLogLevel;
	debugLogRetention: number;
	debugLogMaxSizeMB: number;
}

interface DiagnosticsPlugin {
	app: App;
	manifest: { id: string };
	settings: DiagnosticsSettings;
	saveSettings(): Promise<void>;
	setDiagnosticLogLevel(level: DiagnosticLogLevel): void;
	setDiagnosticLogMaxSize(maxSizeMB: number): void;
}

interface DiskUsageBreakdown {
	total: number;
	runtime: number;
	logs: number;
	backups: number;
	temporary: number;
	settings: number;
	other: number;
}

/** Calculate plugin storage using desktop-only Node filesystem APIs. */
async function calculatePluginDiskUsage(
	pluginDir: string,
): Promise<DiskUsageBreakdown | null> {
	if (!Platform.isDesktop) return null;

	try {
		// Keep Node modules behind the desktop guard so mobile never evaluates them.
		const [fs, path] = await Promise.all([import('fs'), import('path')]);

		const walk = async (
			dir: string,
		): Promise<{ size: number; files: Map<string, number> }> => {
			let total = 0;
			const files = new Map<string, number>();
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					const sub = await walk(fullPath);
					total += sub.size;
					for (const [filePath, size] of sub.files) files.set(filePath, size);
				} else {
					const stat = await fs.promises.stat(fullPath);
					total += stat.size;
					files.set(fullPath, stat.size);
				}
			}
			return { size: total, files };
		};

		const { size: total, files } = await walk(pluginDir);
		const breakdown: DiskUsageBreakdown = {
			total,
			runtime: 0,
			logs: 0,
			backups: 0,
			temporary: 0,
			settings: 0,
			other: 0,
		};

		for (const [filePath, size] of files) {
			const basename = path.basename(filePath);
			const relative = path.relative(pluginDir, filePath);
			if (relative.startsWith(`.backup${path.sep}`) || basename.endsWith('.backup') || basename.endsWith('.bak')) {
				breakdown.backups += size;
			} else if (relative.startsWith('.update-tmp-')) {
				breakdown.temporary += size;
			} else if (/^(main\.js|manifest\.json|styles\.css)$/.test(basename)) {
				breakdown.runtime += size;
			} else if (/\.log$/i.test(basename)) {
				breakdown.logs += size;
			} else if (basename === 'data.json' || basename.endsWith('.json')) {
				breakdown.settings += size;
			} else {
				breakdown.other += size;
			}
		}

		return breakdown;
	} catch {
		return null;
	}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
	const value = bytes / Math.pow(1024, exponent);
	return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function renderDiagnosticsSection(
	containerEl: HTMLElement,
	plugin: DiagnosticsPlugin,
): void {
	new Setting(containerEl)
		.setName('Debug log level')
		.setDesc('Choose how much runtime information the plugin records.')
		.addDropdown((dropdown) =>
			dropdown
				.addOption('off', 'Off')
				.addOption('error', 'Errors only')
				.addOption('info', 'Info')
				.addOption('debug', 'Debug')
				.setValue(plugin.settings.debugLogLevel)
				.onChange(async (value) => {
					plugin.settings.debugLogLevel = value as DiagnosticLogLevel;
					plugin.setDiagnosticLogLevel(plugin.settings.debugLogLevel);
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName('Debug log max size (MB)')
		.setDesc(
			'Maximum size for the debug log file. When exceeded, the file is truncated to keep the most recent entries.',
		)
		.addText((text) => {
			text.setPlaceholder('5').setValue(String(plugin.settings.debugLogMaxSizeMB));
			text.inputEl.addEventListener('blur', async () => {
				const value = Number.parseFloat(text.getValue());
				plugin.settings.debugLogMaxSizeMB = Number.isFinite(value) && value > 0 ? value : 5;
				plugin.setDiagnosticLogMaxSize(plugin.settings.debugLogMaxSizeMB);
				await plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName('Debug log retention')
		.setDesc('Approximate number of log lines to retain before rotation.')
		.addText((text) => {
			text.setPlaceholder('200').setValue(String(plugin.settings.debugLogRetention));
			text.inputEl.addEventListener('blur', async () => {
				const value = Number.parseInt(text.getValue(), 10);
				plugin.settings.debugLogRetention = Number.isFinite(value) && value > 0 ? value : 200;
				await plugin.saveSettings();
			});
		});

	const metricsEl = containerEl.createDiv({ cls: 'git-settings-metrics' });
	const createMetric = (label: string, value: string) => {
		const wrapper = metricsEl.createDiv({ cls: 'git-settings-metric' });
		wrapper.createEl('div', { text: label, cls: 'git-settings-metric-label' });
		return wrapper.createEl('div', { text: value, cls: 'git-settings-metric-value' });
	};

	const heapUsedEl = createMetric('JS Heap Used', '—');
	const heapTotalEl = createMetric('JS Heap Total', '—');
	const heapLimitEl = createMetric('JS Heap Limit', '—');
	const domNodesEl = createMetric('DOM Nodes', '—');
	const diskTotalEl = createMetric('Plugin Storage', '—');
	const diskBreakdownEl = createMetric('Storage Breakdown', '—');

	const refreshMetrics = async () => {
		const mem = (performance as any).memory;
		if (mem) {
			heapUsedEl.textContent = `${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)} MB`;
			heapTotalEl.textContent = `${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)} MB`;
			heapLimitEl.textContent = `${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(1)} MB`;
		} else {
			heapUsedEl.textContent = 'N/A';
			heapTotalEl.textContent = 'N/A';
			heapLimitEl.textContent = 'N/A';
		}

		domNodesEl.textContent = String(document.getElementsByTagName('*').length);

		try {
			const pluginDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
			const usage = await calculatePluginDiskUsage(pluginDir);
			if (!usage) {
				diskTotalEl.textContent = 'N/A';
				diskBreakdownEl.textContent = 'File system unavailable';
				return;
			}

			diskTotalEl.textContent = formatBytes(usage.total);
			const parts: string[] = [];
			if (usage.runtime > 0) parts.push(`${formatBytes(usage.runtime)} runtime`);
			if (usage.logs > 0) parts.push(`${formatBytes(usage.logs)} logs`);
			if (usage.backups > 0) parts.push(`${formatBytes(usage.backups)} backups`);
			if (usage.temporary > 0) parts.push(`${formatBytes(usage.temporary)} temporary`);
			if (usage.settings > 0) parts.push(`${formatBytes(usage.settings)} settings`);
			if (usage.other > 0) parts.push(`${formatBytes(usage.other)} other`);
			diskBreakdownEl.textContent = parts.join(', ') || 'Empty';
		} catch {
			diskTotalEl.textContent = 'Error';
			diskBreakdownEl.textContent = 'Could not read storage';
		}
	};

	new Setting(containerEl)
		.setName('Refresh metrics')
		.setDesc('Update the diagnostic numbers above.')
		.addButton((button) =>
			button
				.setButtonText('Refresh')
				.setIcon('refresh-cw')
				.onClick(() => {
					button.setDisabled(true);
					refreshMetrics().finally(() => button.setDisabled(false));
				}),
		);

	void refreshMetrics();
}
