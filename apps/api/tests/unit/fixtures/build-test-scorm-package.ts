import AdmZip from "adm-zip";

export interface TestScormPackageOptions {
  /** Number of SCOs in the manifest — defaults to 1. */
  itemCount?: number;
  /** Omits imsmanifest.xml entirely, for testing the "missing manifest" rejection path. */
  omitManifest?: boolean;
  /** Adds an extra manifest item whose identifierref doesn't resolve to any <resource>. */
  unresolvableResource?: boolean;
}

/**
 * Constructs a minimal, valid SCORM 1.2 `.zip` package in memory (research.md §1, spec 027's own
 * testing decision — no committed binary fixture). Each SCO gets its own `scoN/index.html` entry point
 * referencing one relative asset (`scoN/style.css`), so tests can also exercise relative-path resolution
 * through the file-proxy route.
 */
export function buildTestScormPackage(options: TestScormPackageOptions = {}): Buffer {
  const { itemCount = 1, omitManifest = false, unresolvableResource = false } = options;

  const zip = new AdmZip();

  if (!omitManifest) {
    const items: string[] = [];
    const resources: string[] = [];

    for (let i = 1; i <= itemCount; i++) {
      items.push(`      <item identifier="ITEM-${i}" identifierref="RES-${i}"><title>SCO ${i}</title></item>`);
      resources.push(
        `    <resource identifier="RES-${i}" type="webcontent" adlcp:scormtype="sco" href="sco${i}/index.html">\n` +
          `      <file href="sco${i}/index.html"/>\n` +
          `      <file href="sco${i}/style.css"/>\n` +
          `    </resource>`,
      );
      zip.addFile(`sco${i}/index.html`, Buffer.from(`<html><head><link rel="stylesheet" href="style.css"></head><body>SCO ${i}</body></html>`));
      zip.addFile(`sco${i}/style.css`, Buffer.from(`body { color: black; }`));
    }

    if (unresolvableResource) {
      items.push(`      <item identifier="ITEM-BAD" identifierref="RES-MISSING"><title>Missing</title></item>`);
    }

    const manifest = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="MANIFEST-1" version="1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Test Course</title>
${items.join("\n")}
    </organization>
  </organizations>
  <resources>
${resources.join("\n")}
  </resources>
</manifest>`;

    zip.addFile("imsmanifest.xml", Buffer.from(manifest));
  }

  return zip.toBuffer();
}
