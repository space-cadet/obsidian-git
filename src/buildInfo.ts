declare const __GIT_COMMIT_HASH__: string;
declare const __GIT_BRANCH__: string;

// esbuild replaces this value at build time. The fallback keeps TypeScript
// tooling and non-bundled test imports safe.
export const GIT_COMMIT_HASH =
	typeof __GIT_COMMIT_HASH__ === 'string' ? __GIT_COMMIT_HASH__ : 'unknown';
export const GIT_BRANCH =
	typeof __GIT_BRANCH__ === 'string' ? __GIT_BRANCH__ : 'unknown';
