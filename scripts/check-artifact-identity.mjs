import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const expectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
const bundle = readFileSync('main.js', 'utf8');
const commitMatch = bundle.match(/GIT_COMMIT_HASH\s*=\s*true \? "([0-9a-f]+)"/);
const branchMatch = bundle.match(/GIT_BRANCH\s*=\s*true \? "([^"]+)"/);

if (!commitMatch || !branchMatch) {
	throw new Error('main.js does not contain the generated build identity.');
}
if (commitMatch[1] !== expectedCommit) {
	throw new Error(`main.js commit identity ${commitMatch[1]} does not match checkout ${expectedCommit}.`);
}
if (branchMatch[1] !== expectedBranch) {
	throw new Error(`main.js branch identity ${branchMatch[1]} does not match checkout ${expectedBranch}.`);
}

console.log(`Artifact identity OK: ${expectedBranch}@${expectedCommit}`);
