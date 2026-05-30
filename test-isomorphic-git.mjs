#!/usr/bin/env node

/**
 * isomorphic-git Functionality Test
 * Tests core git operations using a pure in-memory filesystem
 */

import * as git from "isomorphic-git";

console.log("=== isomorphic-git Node.js Functionality Test ===");
console.log("git version:", git.version());
console.log("");

// Minimal in-memory filesystem compatible with isomorphic-git
class MemFS {
  constructor() {
    this.files = new Map();
    this.dirs = new Set(["/"]);
  }

  _path(p) {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  async mkdir(p, opts) {
    p = this._path(p);
    this.dirs.add(p);
  }

  async writeFile(p, data, opts) {
    p = this._path(p);
    if (typeof data === "string") data = new TextEncoder().encode(data);
    this.files.set(p, data);
    const dir = p.substring(0, p.lastIndexOf("/")) || "/";
    this.dirs.add(dir);
  }

  async readFile(p, opts) {
    p = this._path(p);
    const data = this.files.get(p);
    if (data === undefined) {
      const err = new Error("ENOENT: " + p);
      err.code = "ENOENT";
      throw err;
    }
    if (opts && opts.encoding === "utf8") return new TextDecoder().decode(data);
    return data;
  }

  async stat(p, opts) {
    p = this._path(p);
    if (this.dirs.has(p)) {
      return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, mode: 0o40755, size: 0 };
    }
    const data = this.files.get(p);
    if (data === undefined) {
      const err = new Error("ENOENT: " + p);
      err.code = "ENOENT";
      throw err;
    }
    return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, mode: 0o100644, size: data.length };
  }

  async lstat(p, opts) {
    return this.stat(p, opts);
  }

  async readdir(p, opts) {
    p = this._path(p);
    const entries = [];
    for (const dir of this.dirs) {
      if (dir.startsWith(p + "/") && dir !== p) {
        const rel = dir.substring(p.length + 1);
        if (!rel.includes("/")) entries.push(rel);
      }
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(p + "/") && file !== p) {
        const rel = file.substring(p.length + 1);
        if (!rel.includes("/")) entries.push(rel);
      }
    }
    return [...new Set(entries)];
  }

  async rmdir(p, opts) {
    p = this._path(p);
    this.dirs.delete(p);
  }

  async unlink(p, opts) {
    p = this._path(p);
    this.files.delete(p);
  }

  async rename(oldP, newP, opts) {
    oldP = this._path(oldP);
    newP = this._path(newP);
    const data = this.files.get(oldP);
    if (data !== undefined) {
      this.files.delete(oldP);
      this.files.set(newP, data);
    }
  }

  async readlink(p, opts) {
    const err = new Error("ENOENT");
    err.code = "ENOENT";
    throw err;
  }

  async symlink(target, p, opts) {
    // No-op for memfs
  }
}

const fs = new MemFS();
const dir = "/test-repo";
let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    console.log("  ✅", name, detail || "");
    passed++;
  } else {
    console.log("  ❌", name, detail || "");
    failed++;
  }
}

// Test 1: git.init
console.log("Test 1: git.init");
try {
  await git.init({ fs, dir, defaultBranch: "main" });
  report("git.init", true);
} catch (e) {
  report("git.init", false, e.message);
}

// Test 2: git.findRoot
console.log("");
console.log("Test 2: git.findRoot");
try {
  const root = await git.findRoot({ fs, filepath: dir });
  report("git.findRoot", root === dir, "root=" + root);
} catch (e) {
  report("git.findRoot", false, e.message);
}

// Test 3: Write a file and check status
console.log("");
console.log("Test 3: git.statusMatrix (after writing file)");
try {
  await fs.writeFile("/test-repo/hello.md", "# Hello World");
  const matrix = await git.statusMatrix({ fs, dir });
  const helloEntry = matrix.find((r) => r[0] === "hello.md");
  report(
    "statusMatrix",
    helloEntry && helloEntry[1] === 0 && helloEntry[2] === 2 && helloEntry[3] === 0,
    "hello.md HEAD:" + helloEntry?.[1] + " workdir:" + helloEntry?.[2] + " stage:" + helloEntry?.[3]
  );
} catch (e) {
  report("statusMatrix", false, e.message);
}

// Test 4: git.add
console.log("");
console.log("Test 4: git.add");
try {
  await git.add({ fs, dir, filepath: "hello.md" });
  const matrix = await git.statusMatrix({ fs, dir });
  const helloEntry = matrix.find((r) => r[0] === "hello.md");
  report(
    "git.add",
    helloEntry && helloEntry[1] === 0 && helloEntry[2] === 2 && helloEntry[3] === 2,
    "stage=" + helloEntry?.[3]
  );
} catch (e) {
  report("git.add", false, e.message);
}

// Test 5: git.commit
console.log("");
console.log("Test 5: git.commit");
try {
  const sha = await git.commit({
    fs,
    dir,
    message: "Initial commit",
    author: { name: "Test", email: "test@example.com" },
  });
  report("git.commit", sha.length === 40, "sha=" + sha.slice(0, 7));
} catch (e) {
  report("git.commit", false, e.message);
}

// Test 6: git.log
console.log("");
console.log("Test 6: git.log");
try {
  const commits = await git.log({ fs, dir });
  report("git.log", commits.length === 1, commits.length + " commits");
  if (commits.length > 0) {
    report("  commit message", commits[0].commit.message === "Initial commit");
    report("  commit author", commits[0].commit.author.name === "Test");
  }
} catch (e) {
  report("git.log", false, e.message);
}

// Test 7: git.currentBranch
console.log("");
console.log("Test 7: git.currentBranch");
try {
  const branch = await git.currentBranch({ fs, dir, fullname: false });
  report("git.currentBranch", branch === "main", "branch=" + branch);
} catch (e) {
  report("git.currentBranch", false, e.message);
}

// Test 8: Second commit
console.log("");
console.log("Test 8: Second commit");
try {
  await fs.writeFile("/test-repo/world.md", "# World");
  await git.add({ fs, dir, filepath: "world.md" });
  const sha = await git.commit({
    fs,
    dir,
    message: "Add world.md",
    author: { name: "Test", email: "test@example.com" },
  });
  const commits = await git.log({ fs, dir });
  report(
    "second commit",
    commits.length === 2 && sha.length === 40,
    commits.length + " commits"
  );
} catch (e) {
  report("second commit", false, e.message);
}

// Summary
console.log("");
console.log("=== Test Summary ===");
console.log("Passed:", passed);
console.log("Failed:", failed);
console.log(failed === 0 ? "✅ All tests passed" : "❌ Some tests failed");

process.exit(failed > 0 ? 1 : 0);
