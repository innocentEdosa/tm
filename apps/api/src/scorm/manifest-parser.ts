import { XMLParser } from "fast-xml-parser";

export interface ParsedManifestItem {
  identifier: string;
  title: string | null;
  entryPointRelativePath: string;
}

export interface ParsedManifest {
  title: string | null;
  items: ParsedManifestItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (_name, jpath) =>
    typeof jpath === "string" &&
    ["manifest.organizations.organization", "manifest.organizations.organization.item", "manifest.resources.resource"].includes(jpath),
});

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return null;
}

/**
 * Parses `imsmanifest.xml` with `fast-xml-parser` (research.md §2), extracting the
 * `<organizations>/<organization>/<item>` tree flattened to only launchable items (those with a real
 * `identifierref` resolving to a `<resource>`) and resolving each to its entry-point file (spec FR-002).
 * Returns an `{ error }` result rather than throwing, for a missing/malformed manifest or an
 * unresolvable resource reference — the caller (`package-importer.ts`) is responsible for surfacing this
 * as a `422`, never letting a partially-processed package through.
 */
export function parseManifest(xml: string): ParsedManifest | { error: string } {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return { error: "imsmanifest.xml is not valid XML" };
  }

  const manifest = (parsed as Record<string, unknown>)?.manifest as Record<string, unknown> | undefined;
  if (!manifest) {
    return { error: "imsmanifest.xml has no root <manifest> element" };
  }

  const organizations = manifest.organizations as Record<string, unknown> | undefined;
  const organizationList = (organizations?.organization as Record<string, unknown>[] | undefined) ?? [];
  const organization = organizationList[0];
  if (!organization) {
    return { error: "imsmanifest.xml has no <organizations>/<organization>" };
  }

  const resourceList = ((manifest.resources as Record<string, unknown> | undefined)?.resource as Record<string, unknown>[] | undefined) ?? [];
  const resourceHrefByIdentifier = new Map<string, string>();
  for (const resource of resourceList) {
    const identifier = resource["@_identifier"] as string | undefined;
    const href = resource["@_href"] as string | undefined;
    if (identifier && href) {
      resourceHrefByIdentifier.set(identifier, href);
    }
  }

  const rawItems = (organization.item as Record<string, unknown>[] | undefined) ?? [];
  const items: ParsedManifestItem[] = [];
  for (const rawItem of rawItems) {
    const identifierRef = rawItem["@_identifierref"] as string | undefined;
    if (!identifierRef) {
      // A structural-only grouping item (no <resource>) — not itself launchable (spec Assumptions).
      continue;
    }
    const identifier = rawItem["@_identifier"] as string | undefined;
    if (!identifier) {
      return { error: "imsmanifest.xml has an <item> with no identifier" };
    }
    const entryPointRelativePath = resourceHrefByIdentifier.get(identifierRef);
    if (!entryPointRelativePath) {
      return { error: `imsmanifest.xml <item identifier="${identifier}"> references a resource "${identifierRef}" with no matching <resource>` };
    }
    items.push({ identifier, title: textOf(rawItem.title), entryPointRelativePath });
  }

  if (items.length === 0) {
    return { error: "imsmanifest.xml has no launchable <item> (every item is either missing or unresolvable)" };
  }

  return { title: textOf(organization.title), items };
}
