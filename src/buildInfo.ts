declare const __GIT_COMMIT_HASH__: string;

// esbuild replaces this value at build time. The fallback keeps TypeScript
// tooling and non-bundled test imports safe.
export const GIT_COMMIT_HASH =
	typeof __GIT_COMMIT_HASH__ === 'string' ? __GIT_COMMIT_HASH__ : 'unknown';
