import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { test } from 'node:test';

const repositoryRoot = process.cwd();
const entryPointPaths = [
  'src/main.ts',
  'src/views/GitSidebarView.ts',
];
const mutatingMethods = new Set([
  'pull',
  'push',
  'commit',
  'stageFile',
  'addAll',
  'unstageFile',
  'unstageAll',
  'initializeRepo',
  'sync',
  'rebuildIndexFromHead',
  'restoreLatestIndexBackup',
]);

function isManagerMutation(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  return ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'manager'
    && mutatingMethods.has(node.expression.name.text);
}

function isRunGitMutation(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'runGitMutation';
}

function findUnwrappedMutations(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const unwrapped = [];

  function visit(node, insideMutationCallback = false) {
    if (isManagerMutation(node) && !insideMutationCallback) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      unwrapped.push(`${fileName}:${line + 1} ${node.expression.name.text}`);
    }

    if (isRunGitMutation(node)) {
      node.arguments.forEach((argument, index) => visit(argument, insideMutationCallback || index === 1));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, insideMutationCallback));
  }

  visit(sourceFile);
  return unwrapped;
}

test('all repository mutation entry points use the shared operation wrapper', () => {
  const unwrapped = [];
  for (const relativePath of entryPointPaths) {
    const fileName = join(repositoryRoot, relativePath);
    unwrapped.push(...findUnwrappedMutations(readFileSync(fileName, 'utf8'), relativePath));
  }

  assert.deepEqual(unwrapped, [], `Unwrapped repository mutations found: ${unwrapped.join(', ')}`);
});

test('plugin lifecycle owns coordinator disposal and signal cleanup', () => {
  const mainSource = readFileSync(join(repositoryRoot, 'src/main.ts'), 'utf8');

  assert.match(mainSource, /this\.operationCoordinator\.dispose\(\)/);
  assert.match(mainSource, /this\.operationCoordinator\.run\(name/);
  assert.match(mainSource, /manager\.setOperationSignal\(signal\)/);
  assert.match(mainSource, /manager\.setOperationSignal\(null\)/);
});

test('staging controls stay stationary while a mutation is in flight', () => {
  const sidebarSource = readFileSync(join(repositoryRoot, 'src/views/GitSidebarView.ts'), 'utf8');
  const styles = readFileSync(join(repositoryRoot, 'styles.css'), 'utf8');

  assert.match(sidebarSource, /this\.setMutationBusy\(true\)/);
  assert.match(sidebarSource, /control\.addClass\('git-operation-busy'\)/);
  assert.doesNotMatch(sidebarSource, /git-file-stage-busy/);
  assert.match(styles, /\.git-header-refreshing svg[\s\S]*animation: git-sync-spin/);
  assert.doesNotMatch(styles, /\.git-file-stage-busy svg/);
  assert.doesNotMatch(styles, /\.git-operation-busy svg[\s\S]*animation: git-sync-spin/);
});

test('successful pushes force-update the existing local tracking ref', () => {
  const gitManagerSource = readFileSync(join(repositoryRoot, 'src/gitManager.ts'), 'utf8');
  assert.match(
    gitManagerSource,
    /ref: `refs\/remotes\/origin\/\$\{branchName\}`,[\s\S]*value: localOid,[\s\S]*force: true,/,
  );
});

test('async sidebar reads guard log and commit-detail responses against stale renders', () => {
  const sidebarSource = readFileSync(join(repositoryRoot, 'src/views/GitSidebarView.ts'), 'utf8');

  assert.match(sidebarSource, /private async renderLogTab\(generation: number\)/);
  assert.match(sidebarSource, /await this\.plugin\.fileLogger\?\.readEntries\(500\)[\s\S]*if \(!this\.isCurrentRender\(generation\)\) return;/);
  assert.match(sidebarSource, /private async renderCommitDetail\(row: HTMLElement, oid: string, generation: number\)/);
  assert.match(sidebarSource, /if \(!this\.isCurrentRender\(generation\) \|\| !row\.isConnected\) return;/);
});

test('sidebar keeps retained activity history and commit source controls visible', () => {
  const sidebarSource = readFileSync(join(repositoryRoot, 'src/views/GitSidebarView.ts'), 'utf8');
  const styles = readFileSync(join(repositoryRoot, 'styles.css'), 'utf8');

  assert.match(sidebarSource, /const recent = \[\.\.\.entries\]\.reverse\(\);/);
  assert.doesNotMatch(sidebarSource, /reverse\(\)\.slice\(0, 50\)/);
  assert.match(
    styles,
    /\.git-sidebar-content \.git-commits-toggle-bar \{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;[\s\S]*z-index:\s*4;/,
  );
});

test('single-file staging avoids a repository-wide status scan', () => {
  const gitManagerSource = readFileSync(join(repositoryRoot, 'src/gitManager.ts'), 'utf8');
  const stagePathSource = gitManagerSource.match(
    /private async stagePath\([\s\S]*?\n    \}\n\n    \/\*\*\n     \* Ask isomorphic-git for ignore semantics/,
  )?.[0] || '';

  assert.match(stagePathSource, /git\.listFiles\(/);
  assert.match(stagePathSource, /this\.fs\.stat\(/);
  assert.doesNotMatch(stagePathSource, /git\.statusMatrix\(/);
});

test('single-file sidebar mutations repaint from the completed operation', () => {
  const sidebarSource = readFileSync(join(repositoryRoot, 'src/views/GitSidebarView.ts'), 'utf8');
  const actionStart = sidebarSource.indexOf("stageBtn.addEventListener('click'");
  const actionEnd = sidebarSource.indexOf('\n                });', actionStart);
  const actionSource = sidebarSource.slice(actionStart, actionEnd);

  assert.ok(actionStart >= 0 && actionEnd > actionStart, 'single-file action handler not found');
  assert.match(actionSource, /this\.applyFileMutationToSnapshot\(/);
  assert.match(actionSource, /this\.contentContainer\.empty\(\);[\s\S]*this\.renderStatusTab\(this\.sidebarSnapshot\);/);
  assert.doesNotMatch(actionSource, /await this\.refresh\(/);
  assert.match(sidebarSource, /private applyFileMutationToSnapshot\(filepath: string, destination: 'staged' \| 'unstaged'\)/);
});
