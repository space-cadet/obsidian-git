const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

function transpileFile(module, filename) {
	const source = fs.readFileSync(filename, "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
		},
	});
	module._compile(outputText, filename);
}

if (!require.extensions[".ts"]) require.extensions[".ts"] = transpileFile;
if (!Module._obsidianGitTsResolverInstalled) {
	const originalResolveFilename = Module._resolveFilename;
	const originalLoad = Module._load;
	Module._resolveFilename = function (request, parent, isMain, options) {
		if (typeof request === "string" && request.startsWith(".") && !path.extname(request) && parent?.filename) {
			const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
			if (fs.existsSync(candidate)) return candidate;
		}
		return originalResolveFilename.call(this, request, parent, isMain, options);
	};
	Module._load = function (request, parent, isMain) {
		if (request === "obsidian") {
			return {
				Platform: { isMobile: false },
				requestUrl: async () => { throw new Error("Network requests are unavailable in unit tests."); },
			};
		}
		return originalLoad.call(this, request, parent, isMain);
	};
	Module._obsidianGitTsResolverInstalled = true;
}

function loadTypeScript(relativePath) {
	const filename = path.resolve(__dirname, "../..", relativePath);
	const loadedModule = new Module(filename, module);
	loadedModule.filename = filename;
	loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
	transpileFile(loadedModule, filename);
	return loadedModule.exports;
}

module.exports = { loadTypeScript };
