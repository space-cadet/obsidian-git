import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import process from "node:process";

const production = process.argv[2] === "production";
const buildInfo = readBuildInfo();
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2018",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  define: {
    __GIT_COMMIT_HASH__: JSON.stringify(buildInfo.commit),
    __GIT_BRANCH__: JSON.stringify(buildInfo.branch)
  },
  outfile: "main.js",
  logLevel: "warning"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}

function readBuildInfo() {
  try {
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim()
    };
  } catch {
    return { commit: "unknown", branch: "main" };
  }
}
