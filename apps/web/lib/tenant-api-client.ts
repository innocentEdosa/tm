export const TENANT_API_BASE = "/tenant-api/tenant";

interface TenantFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  subdomain: string;
}

/**
 * Thin fetch wrapper for tenant-scoped API calls from Client Components. Every settings page in this
 * app repeats the same `fetch(...) + credentials:"include" + subdomain query param` boilerplate
 * inline (team/department/roles/forms/authentication settings) — this is that pattern factored out
 * once the course-authoring UI's ~20 files made copy-pasting it a 21st time not worth it. Always
 * threads `subdomain` as a query param (never a header/cookie, matching every existing settings page).
 *
 * Returns the full parsed response body rather than auto-unwrapping `{ success, data }` — most
 * endpoints are just `{ data }`, but the course list also carries a top-level `pagination`, so callers
 * type the shape they expect (e.g. `tenantFetch<{ data: Course }>(...)`) and destructure themselves.
 * Throws the server's own `message` on a non-ok response either way.
 */
export async function tenantFetch<T>(path: string, { method = "GET", body, subdomain }: TenantFetchOptions): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${TENANT_API_BASE}${path}${separator}subdomain=${encodeURIComponent(subdomain)}`;
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((json as { message?: string } | null)?.message ?? `Request to ${path} failed (${res.status})`);
  }
  return json as T;
}

/**
 * PUTs a file's raw bytes directly to a presigned upload URL (R2) — plain `fetch` has no
 * upload-progress event, so this uses `XMLHttpRequest` when a progress callback is given. Shared by
 * every place in this app that drives the "get a presigned URL, then PUT bytes to it" flow: course
 * image upload, lesson-resource file upload, and SCORM package upload.
 */
export function uploadFileToPresignedUrl(uploadUrl: string, file: File | Blob, contentType: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}
