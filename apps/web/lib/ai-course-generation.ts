import { tenantFetch, uploadFileToPresignedUrl } from "./tenant-api-client";

/**
 * Client-side counterpart of `apps/api/src/ai/course-generation-routes.ts` — the "AI-Assisted
 * Generation" modal's real backing calls (`create-course-menu.tsx`). Kept separate from
 * `course-editor-adapter.ts`'s `CourseEditorApi` since every method there is scoped to an existing
 * `courseId`; generation instead *creates* one, with its own two-step upload-then-generate shape.
 * Tenant-only (`CourseEditorApi.supportsAiGeneration` gates the UI entry point off for platform
 * course-marketplace authoring) — always called with the tenant `subdomain`, never platform.
 */
export interface GenerateCourseParams {
  subdomain: string;
  /** Plain text or lightweight HTML from the rich-text prompt editor — the backend strips markup
   * before sending it to the model, so either is fine here. */
  prompt: string;
  /** The staged "supporting document" file, if the admin picked one — uploaded to a scratch storage
   * key first, then referenced by key in the generate call. `null` for a prompt-only request. */
  documentFile: File | null;
}

export async function generateCourseFromAi({ subdomain, prompt, documentFile }: GenerateCourseParams): Promise<{ courseId: string }> {
  let documentStorageKey: string | undefined;
  let documentContentType: string | undefined;

  if (documentFile) {
    const { data: upload } = await tenantFetch<{ data: { uploadUrl: string; storageKey: string } }>("/ai/course-generation/document-upload-url", {
      method: "POST",
      subdomain,
      body: { fileName: documentFile.name, contentType: documentFile.type, sizeBytes: documentFile.size },
    });
    await uploadFileToPresignedUrl(upload.uploadUrl, documentFile, documentFile.type);
    documentStorageKey = upload.storageKey;
    documentContentType = documentFile.type;
  }

  const { data } = await tenantFetch<{ data: { courseId: string } }>("/ai/course-generation", {
    method: "POST",
    subdomain,
    body: { prompt: prompt || undefined, documentStorageKey, documentContentType },
  });
  return data;
}
