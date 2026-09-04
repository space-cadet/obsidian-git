import { Setting } from 'obsidian';
import { RepositoryHealthSummary } from '../backend/obsidianAdapter';
import {
	RepositoryIndexBackupPreview,
	RepositoryIndexRepairPreview,
	RepositoryIndexRepairResult,
	RepositoryRebuildPreview,
} from '../backend/types';

interface MaintenancePlugin {
	settings: { repoUrl: string };
	checkRepositoryHealth(): Promise<RepositoryHealthSummary>;
	previewIndexRepair(): Promise<RepositoryIndexRepairPreview>;
	rebuildRepositoryIndex(): Promise<RepositoryIndexRepairResult>;
	previewLatestRepositoryIndexBackup(): Promise<RepositoryIndexBackupPreview | null>;
	restoreLatestRepositoryIndexBackup(): Promise<string>;
	previewRepositoryRebuild(): Promise<RepositoryRebuildPreview>;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setBusy(button: any, busy: boolean, label: string): void {
	button.setDisabled(busy);
	button.setButtonText(busy ? `${label}…` : label);
}

function showDryRunResult(containerEl: HTMLElement, text: string): void {
	const existing = containerEl.querySelector('.git-maintenance-result');
	existing?.remove();
	const result = containerEl.createDiv({ cls: 'git-maintenance-result' });
	result.createEl('div', { text: text, cls: 'git-maintenance-result-text' });
	result.createEl('div', { text: 'No files will be changed.', cls: 'git-maintenance-result-safe' });
}

function showOperationResult(containerEl: HTMLElement, text: string): void {
	const existing = containerEl.querySelector('.git-maintenance-result');
	existing?.remove();
	const result = containerEl.createDiv({ cls: 'git-maintenance-result' });
	result.createEl('div', { text, cls: 'git-maintenance-result-text' });
}

function healthDescription(health: RepositoryHealthSummary): string {
	if (health.state === 'missing') return 'No .git repository was found in this vault.';
	if (health.state === 'damaged') return health.reason || 'Git repository metadata needs repair.';
	return `Healthy repository on ${health.branch || 'the current branch'}${health.hasCommits ? '.' : ' with no commits yet.'}`;
}

export function renderMaintenanceSection(containerEl: HTMLElement, plugin: MaintenancePlugin): void {
	containerEl.createEl('p', {
		text: 'Inspect and repair local Git metadata. Dry runs are read-only and show what would happen before a repair is performed.',
		cls: 'setting-item-description',
	});

	const healthSetting = new Setting(containerEl)
		.setName('Repository health')
		.setDesc('Checking repository metadata…');
	let healthDescriptionEl = healthSetting.descEl;
	healthSetting.addButton((button) => button
		.setButtonText('Run health check')
		.onClick(async () => {
			setBusy(button, true, 'Run health check');
			try {
				const health = await plugin.checkRepositoryHealth();
				healthDescriptionEl.setText(healthDescription(health));
			} catch (error: any) {
				healthDescriptionEl.setText(`Health check failed: ${error?.message || String(error)}`);
			} finally {
				setBusy(button, false, 'Run health check');
			}
		}));
	healthSetting.controlEl.querySelector('button')?.setAttribute('aria-label', 'Run repository health check');

	const repairSetting = new Setting(containerEl)
		.setName('Repair Git index from HEAD')
		.setDesc('Rebuild the staging index from the current HEAD without overwriting vault files.');
	const repairContent = repairSetting.settingEl.parentElement || containerEl;
	repairSetting.addButton((button) => button
		.setButtonText('Dry run')
		.setClass('git-btn-ghost')
		.onClick(async () => {
			setBusy(button, true, 'Dry run');
			try {
				const preview = await plugin.previewIndexRepair();
				showDryRunResult(
					repairContent,
					`Tracked: ${preview.trackedFiles} · Modified: ${preview.modifiedFiles} · ` +
					`Deleted: ${preview.deletedFiles} · Untracked: ${preview.untrackedFiles} · ` +
					`Unchanged: ${preview.unchangedFiles}`,
				);
			} catch (error: any) {
				showOperationResult(repairContent, `Dry run failed: ${error?.message || String(error)}`);
			} finally {
				setBusy(button, false, 'Dry run');
			}
		}));
	repairSetting.addButton((button) => button
		.setButtonText('Repair index')
		.setCta()
		.onClick(async () => {
			if (!window.confirm('Rebuild the Git index from HEAD? Vault files will be preserved, but staged changes from the damaged index cannot be recovered.')) return;
			setBusy(button, true, 'Repair index');
			try {
				const result = await plugin.rebuildRepositoryIndex();
				showOperationResult(
					repairContent,
					`Repaired ${result.trackedFiles} tracked files and preserved ${result.worktreeFiles} vault files.`,
				);
				healthDescriptionEl.setText('Repair completed. Run a health check to verify the repository.');
			} catch (error: any) {
				showOperationResult(repairContent, `Repair failed: ${error?.message || String(error)}`);
			} finally {
				setBusy(button, false, 'Repair index');
			}
		}));
	repairContent.createEl('p', {
		text: 'Staged changes from a damaged index cannot be recovered.',
		cls: 'git-maintenance-warning',
	});

	const restoreSetting = new Setting(containerEl)
		.setName('Restore index backup')
		.setDesc('Restore the latest valid repair backup. The current index is saved first.');
	const restoreContent = restoreSetting.settingEl.parentElement || containerEl;
	restoreSetting.addButton((button) => button
		.setButtonText('Preview restore')
		.setClass('git-btn-ghost')
		.onClick(async () => {
			setBusy(button, true, 'Preview restore');
			try {
				const preview = await plugin.previewLatestRepositoryIndexBackup();
				showDryRunResult(
					restoreContent,
					preview
						? `${preview.filename} · ${formatBytes(preview.size)} · ${preview.validFormat ? 'valid index format' : 'invalid index format'}`
						: 'No repair backup was found.',
				);
			} catch (error: any) {
				showOperationResult(restoreContent, `Preview failed: ${error?.message || String(error)}`);
			} finally {
				setBusy(button, false, 'Preview restore');
			}
		}));
	restoreSetting.addButton((button) => button
		.setButtonText('Restore latest backup')
		.setCta()
		.onClick(async () => {
			if (!window.confirm('Restore the latest Git index repair backup? The current index will be saved first.')) return;
			setBusy(button, true, 'Restore latest backup');
			try {
				const filename = await plugin.restoreLatestRepositoryIndexBackup();
				showOperationResult(restoreContent, `Restored ${filename}. Run a health check to verify the repository.`);
			} catch (error: any) {
				showOperationResult(restoreContent, `Restore failed: ${error?.message || String(error)}`);
			} finally {
				setBusy(button, false, 'Restore latest backup');
			}
		}));

	const remoteSetting = new Setting(containerEl)
		.setName('Remote repository rebuild')
		.setDesc(plugin.settings.repoUrl
			? 'Compare local vault files with the configured remote without changing either side.'
			: 'Add a repository URL in General before previewing the remote comparison.');
	const remoteContent = remoteSetting.settingEl.parentElement || containerEl;
	remoteSetting.addButton((button) => button
		.setButtonText('Preview comparison')
		.setClass('git-btn-ghost')
		.onClick(async () => {
			setBusy(button, true, 'Preview comparison');
			try {
				const preview = await plugin.previewRepositoryRebuild();
				showDryRunResult(
					remoteContent,
					`Conflicts: ${preview.conflicts.length} · Remote-only: ${preview.remoteOnly.length} · ` +
					`Local-only: ${preview.localOnly.length} · Unchanged: ${preview.unchanged.length}`,
				);
			} catch (error: any) {
				showOperationResult(remoteContent, `Preview failed: ${error?.message || String(error)}`);
			} finally {
				setBusy(button, false, 'Preview comparison');
			}
		}));

	void plugin.checkRepositoryHealth()
		.then((health) => healthDescriptionEl.setText(healthDescription(health)))
		.catch((error: any) => healthDescriptionEl.setText(`Health check failed: ${error?.message || String(error)}`));
}
