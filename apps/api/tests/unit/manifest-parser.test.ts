import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/scorm/manifest-parser";

const SINGLE_ITEM_MANIFEST = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="MANIFEST-1" version="1">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Test Course</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>SCO 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="sco1/index.html">
      <file href="sco1/index.html"/>
    </resource>
  </resources>
</manifest>`;

const MULTI_ITEM_MANIFEST = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="MANIFEST-1" version="1">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Multi SCO Course</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>SCO 1</title></item>
      <item identifier="ITEM-2" identifierref="RES-2"><title>SCO 2</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" href="sco1/index.html"><file href="sco1/index.html"/></resource>
    <resource identifier="RES-2" href="sco2/index.html"><file href="sco2/index.html"/></resource>
  </resources>
</manifest>`;

const UNRESOLVABLE_RESOURCE_MANIFEST = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="MANIFEST-1" version="1">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Broken Course</title>
      <item identifier="ITEM-1" identifierref="RES-MISSING"><title>SCO 1</title></item>
    </organization>
  </organizations>
  <resources></resources>
</manifest>`;

describe("parseManifest (research.md §2)", () => {
  it("parses a single-item manifest", () => {
    const result = parseManifest(SINGLE_ITEM_MANIFEST);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.title).toBe("Test Course");
    expect(result.items).toEqual([{ identifier: "ITEM-1", title: "SCO 1", entryPointRelativePath: "sco1/index.html" }]);
  });

  it("parses a multi-item manifest, preserving order", () => {
    const result = parseManifest(MULTI_ITEM_MANIFEST);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.items.map((i) => i.identifier)).toEqual(["ITEM-1", "ITEM-2"]);
    expect(result.items.map((i) => i.entryPointRelativePath)).toEqual(["sco1/index.html", "sco2/index.html"]);
  });

  it("returns an error for a manifest with no root <manifest> element", () => {
    const result = parseManifest("<not-a-manifest></not-a-manifest>");
    expect("error" in result).toBe(true);
  });

  it("returns an error for an item whose identifierref doesn't resolve to any resource", () => {
    const result = parseManifest(UNRESOLVABLE_RESOURCE_MANIFEST);
    expect("error" in result).toBe(true);
  });
});
