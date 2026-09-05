import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const sidebar = readFileSync(join(root, 'src/views/GitSidebarView.ts'), 'utf8');
const progress = readFileSync(join(root, 'src/ui/GitProgressModal.ts'), 'utf8');

test('T40 Activity updates retain rows and do not reload persisted history for a live entry', () => {
  const subscription = sidebar.slice(
    sidebar.indexOf('this.logUnsubscribe = log.subscribe'),
    sidebar.indexOf('// Reconcile every vault change', sidebar.indexOf('this.logUnsubscribe = log.subscribe')),
  );
  const liveUpdate = sidebar.slice(
    sidebar.indexOf('private applyLiveActivityEntries'),
    sidebar.indexOf('private activityKey', sidebar.indexOf('private applyLiveActivityEntries')),
  );

  assert.match(subscription, /this\.readModel\.setLogEntries\(log\.getEntries\(\)\)/);
  assert.match(subscription, /this\.applyLiveActivityEntries\(\)/);
  assert.doesNotMatch(subscription, /invalidateLogs\(\)|refresh\(/);
  assert.match(liveUpdate, /const entries = log\.getEntries\(\)/);
  assert.doesNotMatch(liveUpdate, /readEntries\(/);
  assert.match(sidebar, /private syncActivityRows\([\s\S]*row\.remove\(\)[\s\S]*list\.insertBefore\(row, firstRow\(\)\)/);
  assert.match(sidebar, /previousTop \+ \(scrollContainer\.scrollHeight - previousHeight\)/);
});

test('T40 Changes mutations keep keyed rows, selection state, and collapsed sections', () => {
  assert.match(sidebar, /private readonly collapsedStatusSections = new Map/);
  assert.match(sidebar, /this\.collapsedStatusSections\.set\(sectionClass, !currentlyCollapsed\)/);
  assert.match(sidebar, /private readonly changeRows = new Map<string, HTMLElement>\(\)/);
  assert.match(sidebar, /this\.changeRows\.set\(filepath, row\)/);
  assert.match(sidebar, /private patchChangedFileRow[\s\S]*list\.appendChild\(row\)/);
  assert.match(sidebar, /private patchSelectionToolbar[\s\S]*row\.toggleClass\('git-file-row-selected', selectedRow\)/);
  assert.match(sidebar, /this\.repaintStatusSnapshot\(true\)/);
});

test('T40 coalesces vault watcher bursts and ignores unchanged status activity', () => {
  const schedule = sidebar.slice(
    sidebar.indexOf('private scheduleVaultRefresh'),
    sidebar.indexOf('private isCurrentRender', sidebar.indexOf('private scheduleVaultRefresh')),
  );
  const statusRead = sidebar.slice(
    sidebar.indexOf('const snapshot = await manager.getSidebarStatusSnapshot'),
    sidebar.indexOf('} catch (error)', sidebar.indexOf('const snapshot = await manager.getSidebarStatusSnapshot')),
  );

  assert.match(schedule, /this\.vaultRefreshTimer !== null/);
  assert.match(schedule, /window\.setTimeout[\s\S]*100\)/);
  assert.match(schedule, /skipIfRepositoryReadInFlight: true/);
  assert.match(statusRead, /if \(changed\) \{[\s\S]*log\.info\('GitStatus'/);
});

test('T40 progress updates mutate persistent nodes instead of emptying subtrees', () => {
  const updateNodes = progress.slice(
    progress.indexOf('private updatePersistentNodes'),
    progress.indexOf('private stopElapsedTimer', progress.indexOf('private updatePersistentNodes')),
  );
  const footer = progress.slice(
    progress.indexOf('private updateFooter'),
    progress.indexOf('private countPair', progress.indexOf('private updateFooter')),
  );

  assert.match(progress, /private readonly statValues = new Map<string, HTMLElement>\(\)/);
  assert.match(progress, /private readonly phaseNodes = new Map<string, ProgressPhaseNodes>\(\)/);
  assert.match(progress, /window\.setInterval\(\(\) => this\.updatePersistentNodes\(\), 1000\)/);
  assert.match(updateNodes, /this\.setStatValue\(/);
  assert.match(updateNodes, /this\.updatePhaseNodes\(phase\)/);
  assert.doesNotMatch(updateNodes, /\.empty\(\)/);
  assert.doesNotMatch(footer, /\.empty\(\)/);
});
