const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./support/load-typescript.cjs");

const { ChangeSelection } = loadTypeScript("src/ChangeSelection.ts");

const changes = [
	{ path: "a.md" },
	{ path: "b.md" },
	{ path: "c.md" },
	{ path: "d.md" },
	{ path: "e.md" },
];

function selectedPaths(selection, candidates = changes) {
	return candidates.filter((change) => selection.isSelected(change.path)).map((change) => change.path);
}

test("click selection toggles paths and Shift selects the inclusive visible range", () => {
	const selection = new ChangeSelection();
	selection.handleClick("uncommitted", "a.md", false, changes);
	selection.handleClick("uncommitted", "c.md", true, changes);

	assert.deepEqual(selectedPaths(selection), ["a.md", "b.md", "c.md"]);
	selection.handleClick("uncommitted", "b.md", false, changes);
	assert.deepEqual(selectedPaths(selection), ["a.md", "c.md"]);
});

test("range anchors are independent by section and a missing anchor selects only the target", () => {
	const selection = new ChangeSelection();
	selection.handleClick("uncommitted", "a.md", false, changes);
	selection.handleClick("staged", "d.md", true, changes);
	assert.deepEqual(selectedPaths(selection), ["a.md", "d.md"]);

	selection.handleClick("staged", "e.md", false, changes);
	selection.handleClick("staged", "b.md", true, changes);

	assert.deepEqual(selectedPaths(selection), ["a.md", "b.md", "c.md", "d.md", "e.md"]);
});

test("long-press range selection adds the anchor and dragged range", () => {
	const selection = new ChangeSelection();
	selection.beginRange("uncommitted", "b.md");
	selection.selectRange("b.md", "d.md", changes);

	assert.deepEqual(selectedPaths(selection), ["b.md", "c.md", "d.md"]);
});

test("folder selection helpers count, clear visible paths, and prune removed paths", () => {
	const selection = new ChangeSelection();
	selection.setSelected(["a.md", "c.md", "removed.md"], true);
	assert.equal(selection.countSelected(changes), 2);

	selection.clearPaths(["a.md"]);
	selection.retainAvailablePaths(new Set(changes.map((change) => change.path)));
	assert.deepEqual(selectedPaths(selection), ["c.md"]);

	selection.clear();
	assert.deepEqual(selectedPaths(selection), []);
});
