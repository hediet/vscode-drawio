/**
 * Standalone test for the path containment fix in customLibraries.
 *
 * Run with: node test-path-containment.js
 *
 * This project has no test runner, so this file validates the path
 * containment logic directly using Node's assert module.
 */
const path = require("path");
const assert = require("assert");

/**
 * Replicates the path containment check added to Config.ts.
 * Returns true if the resolved path is within wsRoot, false otherwise.
 */
function isWithinWorkspace(filePath, wsRoot) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(wsRoot + path.sep) || resolved === wsRoot;
}

const wsRoot = "/home/user/project";

// Test 1: Normal path within workspace (should pass)
const normalPath = path.join(wsRoot, "libs", "my-library.json");
assert.strictEqual(isWithinWorkspace(normalPath, wsRoot), true,
  "Normal path within workspace should be allowed");
console.log("PASS: Normal path within workspace");

// Test 2: Template-expanded path within workspace (should pass)
const templatePath = wsRoot + "/libs/shapes.xml";
assert.strictEqual(isWithinWorkspace(templatePath, wsRoot), true,
  "Template-expanded workspace path should be allowed");
console.log("PASS: Template-expanded path");

// Test 3: Absolute path outside workspace (should be blocked)
assert.strictEqual(isWithinWorkspace("/etc/passwd", wsRoot), false,
  "Absolute path outside workspace must be blocked");
console.log("PASS: Absolute path /etc/passwd blocked");

// Test 4: Relative traversal via ../ (should be blocked)
assert.strictEqual(isWithinWorkspace(wsRoot + "/../../../etc/shadow", wsRoot), false,
  "Relative traversal via ../ must be blocked");
console.log("PASS: Relative traversal ../../etc/shadow blocked");

// Test 5: Sibling directory with same prefix (should be blocked)
assert.strictEqual(isWithinWorkspace(wsRoot + "-secret/data.json", wsRoot), false,
  "Sibling directory with same prefix must be blocked");
console.log("PASS: Sibling dir with same prefix blocked");

// Test 6: Workspace root itself (edge case, should pass)
assert.strictEqual(isWithinWorkspace(wsRoot, wsRoot), true,
  "Workspace root itself should be allowed");
console.log("PASS: Workspace root itself allowed");

console.log("\nAll 6 tests passed.");
