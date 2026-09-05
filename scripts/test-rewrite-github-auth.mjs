import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
const accessToken = process.env.GITHUB_OAUTH_ACCESS_TOKEN;
const repository = process.env.GITHUB_TEST_REPO || 'space-cadet/git-test-small';
const branch = process.env.GITHUB_TEST_BRANCH || 'main';

if (!clientId && !accessToken) {
  console.error('GITHUB_OAUTH_CLIENT_ID or GITHUB_OAUTH_ACCESS_TOKEN is required for the live GitHub authentication test.');
  process.exitCode = 2;
} else {
  const bundleDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-live-auth-bundle-'));
  const bundlePath = join(bundleDirectory, 'backend.cjs');
  const checkoutDirectory = mkdtempSync(join(tmpdir(), 'obsidian-git-live-auth-checkout-'));

  buildSync({
    entryPoints: ['src/backend/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });

  const { GitBackend, GitHubApi, GitHubDeviceAuth, StaticCredentialProvider } = await import(bundlePath);

  const transport = {
    async request(request) {
      const response = await fetch(request.url, {
        method: request.method || 'GET',
        headers: request.headers,
        body: request.body instanceof Uint8Array ? request.body : request.body,
      });
      const buffer = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: buffer,
        text: new TextDecoder().decode(buffer),
      };
    },
  };

  try {
    const session = accessToken
      ? {
          credential: { username: 'x-access-token', password: accessToken, source: 'github' },
        }
      : await new GitHubDeviceAuth({
          clientId,
          transport,
          onUserCode: ({ userCode, verificationUri }) => {
            console.log(`Approve GitHub access at ${verificationUri} using code ${userCode}.`);
          },
        }).authenticate();

    const api = new GitHubApi(transport, session.credential.password);
    const user = await api.getAuthenticatedUser();
    const repo = await api.getRepository(`https://github.com/${repository}.git`);
    const commits = await api.listCommits(`https://github.com/${repository}.git`, branch, 5);
    assert.ok(user.login);
    assert.equal(repo.fullName.toLowerCase(), repository.toLowerCase());
    assert.ok(commits.length > 0, 'live repository should expose at least one commit');

    const backend = new GitBackend(
      {
        fs: fsPromises,
        transport,
        credentials: new StaticCredentialProvider(session.credential),
      },
      checkoutDirectory,
      {
        branch,
        remoteUrl: `https://github.com/${repository}.git`,
        author: { name: 'Rewrite Live Test', email: 'rewrite-live-test@example.test' },
      },
    );
    await backend.testRemote();
    await backend.clone();
    const status = await backend.status();
    assert.equal(status.branch, branch);
    console.log(`Authenticated GitHub user ${user.login}; read ${commits.length} commits, cloned ${repo.fullName}, and read ${status.state} status.`);
  } finally {
    rmSync(bundleDirectory, { recursive: true, force: true });
    rmSync(checkoutDirectory, { recursive: true, force: true });
  }
}
