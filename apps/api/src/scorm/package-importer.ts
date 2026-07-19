import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { contentItems } from "../db/schema/course-content";
import { scormPackages, scormPackageItems } from "../db/schema/scorm";
import * as storage from "../storage/storage";
import { parseManifest } from "./manifest-parser";
import { guessContentType } from "./mime-types";

export interface ImportedSco {
  contentItemId: string;
  title: string;
  position: number;
}

/**
 * Extracts a raw SCORM `.zip`, parses its manifest, creates one content item per SCO (per Clarifications
 * — the uploaded-to content item becomes the manifest's first SCO; additional content items are created
 * for every further SCO, shifting later module siblings' positions), and uploads every extracted file to
 * R2 (research.md §4/§8). Returns an `{ error }` result — never throws for a malformed package — so the
 * caller can respond `422` without anything having been created or modified.
 */
export async function importPackage(
  tenantDb: Db,
  tenantId: string,
  contentItemId: string,
  createdByUserId: string,
  zipBuffer: Buffer,
): Promise<{ packageId: string; scos: ImportedSco[] } | { error: string }> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
    zip.getEntries(); // forces central-directory parsing now, surfacing a corrupt archive here
  } catch {
    return { error: "Uploaded file is not a valid zip archive" };
  }

  const manifestEntry = zip.getEntry("imsmanifest.xml");
  if (!manifestEntry) {
    return { error: "Package is missing imsmanifest.xml at its root" };
  }

  const manifestResult = parseManifest(manifestEntry.getData().toString("utf-8"));
  if ("error" in manifestResult) {
    return manifestResult;
  }

  for (const item of manifestResult.items) {
    if (!zip.getEntry(item.entryPointRelativePath)) {
      return { error: `Entry point "${item.entryPointRelativePath}" for item "${item.identifier}" not found in archive` };
    }
  }

  const [anchor] = await tenantDb.select().from(contentItems).where(eq(contentItems.id, contentItemId));
  if (!anchor) {
    return { error: "Content item not found" };
  }

  const [packageRow] = await tenantDb
    .insert(scormPackages)
    .values({ tenantId, title: manifestResult.title, createdByUserId })
    .returning();

  const additionalCount = manifestResult.items.length - 1;
  if (additionalCount > 0) {
    const laterSiblings = await tenantDb
      .select({ id: contentItems.id, position: contentItems.position })
      .from(contentItems)
      .where(eq(contentItems.moduleId, anchor.moduleId));
    for (const sibling of laterSiblings) {
      if (sibling.position > anchor.position) {
        await tenantDb
          .update(contentItems)
          .set({ position: sibling.position + additionalCount })
          .where(eq(contentItems.id, sibling.id));
      }
    }
  }

  const scos: ImportedSco[] = [{ contentItemId: anchor.id, title: anchor.title, position: 0 }];
  for (let i = 1; i < manifestResult.items.length; i++) {
    const item = manifestResult.items[i];
    const [created] = await tenantDb
      .insert(contentItems)
      .values({
        tenantId,
        courseId: anchor.courseId,
        moduleId: anchor.moduleId,
        type: "external_import",
        title: item.title ?? `SCO ${i + 1}`,
        description: null,
        payload: { sourceType: "scorm" },
        position: anchor.position + i,
        createdByUserId,
      })
      .returning();
    scos.push({ contentItemId: created.id, title: created.title, position: i });
  }

  for (let i = 0; i < manifestResult.items.length; i++) {
    await tenantDb.insert(scormPackageItems).values({
      tenantId,
      packageId: packageRow.id,
      contentItemId: scos[i].contentItemId,
      manifestItemIdentifier: manifestResult.items[i].identifier,
      entryPointRelativePath: manifestResult.items[i].entryPointRelativePath,
      position: i,
    });
  }

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const key = `${tenantId}/scorm/${packageRow.id}/${entry.entryName}`;
    await storage.putObject(key, entry.getData(), guessContentType(entry.entryName));
  }

  return { packageId: packageRow.id, scos };
}
