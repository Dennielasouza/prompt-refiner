import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../static/manifest.json", import.meta.url), "utf8"));

describe("manifest", () => {
  // Chrome Web Store listing limits (v2 target); checked here so a long string never blocks a release.
  it("fits the store's name and description limits", () => {
    assert.ok(manifest.name.length <= 75, `name has ${manifest.name.length} chars`);
    assert.ok(manifest.description.length <= 132, `description has ${manifest.description.length} chars`);
  });

  it("asks for no host permissions and only the four narrow permissions", () => {
    assert.equal(manifest.host_permissions, undefined);
    assert.deepEqual(manifest.permissions, ["contextMenus", "activeTab", "scripting", "storage"]);
  });
});
