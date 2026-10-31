const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

function loadTypeScript(relativePath) {
	const filename = path.resolve(__dirname, "../..", relativePath);
	const source = fs.readFileSync(filename, "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
		},
	});
	const loadedModule = new Module(filename, module);
	loadedModule.filename = filename;
	loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
	loadedModule._compile(outputText, filename);
	return loadedModule.exports;
}

module.exports = { loadTypeScript };
