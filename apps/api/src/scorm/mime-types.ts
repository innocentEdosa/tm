const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  js: "application/javascript",
  css: "text/css",
  json: "application/json",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** File-extension→MIME lookup for extracted SCORM package assets (research.md §7) — no catalog table,
 * derived at request time. */
export function guessContentType(relativePath: string): string {
  const extension = relativePath.split(".").pop()?.toLowerCase();
  return (extension && MIME_TYPES_BY_EXTENSION[extension]) || "application/octet-stream";
}
