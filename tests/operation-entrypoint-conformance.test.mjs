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
