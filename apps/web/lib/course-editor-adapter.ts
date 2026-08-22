import { tenantFetch, uploadFileToPresignedUrl } from "@/lib/tenant-api-client";
import type {
  Attachment,
  Course,
  ContentItem,
  ContentItemPayload,
  ContentItemTarget,
  ContentItemType,
  ContentStatus,
  CourseModule,
  Curriculum,
  TenantFile,
  VideoUploadStart,
} from "@/lib/course-api-types";

const PLATFORM_API_BASE = "/platform-api";

async function platformFetch<T>(path: string, init: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${PLATFORM_API_BASE}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((json as { message?: string } | null)?.message ?? `Request to ${path} failed (${res.status})`);
  }
  return json as T;
}

/**
 * Shared save-target for the tenant course editor UI (`information-tab.tsx`, `curriculum-shell.tsx`,
 * and everything under them) — lets Super Admin platform-course authoring reuse the exact same
 * components/forms/interactions, only swapping *where* a course is persisted (tenant `courses`/
 * `course_modules`/`content_items` vs. platform-level `platform_courses`/`platform_course_modules`/
 * `platform_course_content_items`). Consumed via `useCourseEditorApi()` (course-editor-context.tsx),
 * mirroring this codebase's existing `useSubdomain()` context idiom.
 *
 * Capability flags (`supports*`) exist because `platform_courses` is deliberately a *simpler* schema
 * than tenant `courses` in a few specific ways — no standalone (course-level, no-module) content
 * items, no per-module/per-item draft/published toggle (only the course-level draft/active/archived
 * status, spec 029 FR-002), and no real SCORM package import yet (spec 029 tasks.md T021, deferred —
 * the underlying `importPackage` isn't a pure parse-then-write function, extracting one is a real
 * refactor of shipped spec 027 code, not undertaken here). Course image and link-type lesson
 * resources *are* supported on both sides (UI-reuse follow-up) via `platform_file_attachments`'
 * `platform_course` entity type and `kind` column, mirroring tenant `file_attachments` exactly.
 * Components check the remaining flags to hide the corresponding UI affordance rather than showing a
 * control that would silently no-op or error against the platform backend.
 */
export interface CourseEditorApi {
  /** Distinguishes this adapter's React Query cache entries from the other mode's (was `subdomain`
   * for tenant queries before this adapter existed — kept as the same query-key position). */
  cacheScope: string;

  supportsCourseImage: boolean;
  supportsSubcategory: boolean;
  /** Course Authors has no platform-level equivalent (no `platform_course_authors` table/routes) —
   * scoped out deliberately, not merely unbuilt (spec 029 UI-reuse follow-up clarifying question). */
  supportsAuthors: boolean;
  /** Whether `category` is a tenant-configurable list (autocomplete + create-on-the-fly, via
   * `CategoryCombobox`) or a plain free-text field (platform courses have no category list of their
   * own — the name is resolved into the *cloning tenant's* list only at clone time, spec 029
   * research.md §5). */
  supportsCategoryList: boolean;
  supportsStandaloneContentItems: boolean;
  supportsItemStatusToggle: boolean;
  supportsResourceLinks: boolean;
  supportsScormImport: boolean;
  /** Video Lesson Upload — `false` on the platform side for the same reason `supportsScormImport` is:
   * the underlying multipart/attachment plumbing isn't platform-specific, but wiring it onto
   * `platform_file_attachments`/`platform_course_content_items` too is deliberately deferred rather
   * than bundled in here. */
  supportsVideoUpload: boolean;
  /** Course Marketplace Updates — only a tenant's own cloned course can have an available update to
   * apply/dismiss; a platform course is the marketplace source itself, never a clone of one. */
  supportsMarketplaceUpdate: boolean;
  /** Course Creation File Manager — browsing/reusing files already uploaded elsewhere in the tenant.
   * Tenant-only: there's no cross-course "platform file library" concept or backend route for it (a
   * platform course's few attachments are cloned wholesale by `clone-platform-course.ts`, not picked
   * one-by-one by a Super Admin the way a tenant admin picks among their own tenant's files). */
  supportsFileManager: boolean;
  /** AI-Assisted Course Generation — `generate_course_structure` (the AI tool this feature calls,
   * `ai/tools/courses.ts`) is `scope: "tenant"` only; there's no platform-scoped equivalent. Gates
   * `create-course-menu.tsx`'s "Generate with AI" entry point off entirely for platform
   * course-marketplace authoring, same "hide the affordance rather than let it 404" convention as
   * every other `supports*` flag here. */
  supportsAiGeneration: boolean;

  /** Creates a minimal draft (title + placeholder metadata), the "Create a course" popover's
   * "Create manually"/SCORM-quick-create flows — the rest of the course is filled in on the editor
   * that opens next. */
  createDraftCourse(input: { title: string }): Promise<{ id: string }>;
  fetchCourse(courseId: string): Promise<Course>;
  updateCourseDetails(
    courseId: string,
    body: {
      title: string;
      description: string;
      category: string;
      subcategory?: string;
      deliveryMode: string;
      duration: { value: number; unit: string };
    },
  ): Promise<Course>;
  updateObjectives(courseId: string, body: { learningObjectives: string[]; requirements: string[] }): Promise<Course>;
  /** Only called when `supportsCourseImage` is true. */
  uploadCourseImage?(courseId: string, file: File): Promise<void>;
  /** Only called when `supportsMarketplaceUpdate` is true. */
  applyMarketplaceUpdate?(courseId: string): Promise<Course>;
  /** Only called when `supportsMarketplaceUpdate` is true. */
  dismissMarketplaceUpdate?(courseId: string): Promise<Course>;

  fetchCurriculum(courseId: string): Promise<Curriculum>;
  createModule(courseId: string, input: { title: string; description: string }): Promise<CourseModule>;
  updateModule(moduleId: string, input: { title?: string; description?: string }): Promise<CourseModule>;
  deleteModule(moduleId: string): Promise<void>;
  /** Reorders the course's top-level outline. For tenant, this may interleave modules and standalone
   * lessons; for platform (no standalone items), it's always exactly the module order. */
  reorderOutline(courseId: string, orderedIds: string[]): Promise<void>;
  /** Only called when `supportsItemStatusToggle` is true. */
  setModuleStatus?(moduleId: string, status: ContentStatus): Promise<CourseModule>;

  createContentItem(
    target: ContentItemTarget,
    body: { type: ContentItemType; title: string; description?: string | null; payload: ContentItemPayload },
  ): Promise<ContentItem>;
  updateContentItem(
    contentItemId: string,
    body: { title?: string; description?: string | null; payload?: ContentItemPayload },
  ): Promise<ContentItem>;
  deleteContentItem(contentItemId: string): Promise<void>;
  reorderModuleContentItems(moduleId: string, contentItemIds: string[]): Promise<void>;
  /** `moduleId: null` means "move to standalone" — only ever called when `supportsStandaloneContentItems`. */
  moveContentItem(contentItemId: string, moduleId: string | null): Promise<void>;
  /** Only called when `supportsItemStatusToggle` is true. */
  setContentItemStatus?(contentItemId: string, status: ContentStatus): Promise<ContentItem>;

  fetchAttachments(contentItemId: string): Promise<Attachment[]>;
  createAttachmentUploadUrl(contentItemId: string, meta: { fileName: string; contentType: string; sizeBytes: number }): Promise<{ id: string; uploadUrl: string }>;
  confirmAttachment(contentItemId: string, attachmentId: string): Promise<void>;
  /** Only called when `supportsResourceLinks` is true. */
  createAttachmentLink?(contentItemId: string, body: { fileName: string; url: string }): Promise<void>;
  deleteAttachment(contentItemId: string, attachmentId: string): Promise<void>;

  /** Only called when `supportsFileManager` is true. Every `kind:"file"`, `status:"ready"` attachment
   * belonging to the tenant, deduped by underlying storage object (a file already reused across
   * several lessons appears once, not once per reference) — shared by the Course Creation File
   * Manager's picker list and the course-image picker's gallery (filtered to images client-side). */
  fetchTenantFiles?(): Promise<TenantFile[]>;
  /** Only called when `supportsFileManager` is true. Attaches an existing tenant file (by its
   * attachment id, as returned from `fetchTenantFiles`) to another content item — no re-upload, no
   * new storage object, just a new row referencing the same underlying file. */
  reuseAttachment?(contentItemId: string, sourceAttachmentId: string): Promise<Attachment>;
  /** Only called when `supportsFileManager` is true. Attaches an existing tenant image (by its
   * attachment id, as returned from `fetchTenantFiles`) as this course's image — no re-upload, no new
   * storage object, same "delete any prior image first" behavior as `uploadCourseImage`. */
  reuseCourseImage?(courseId: string, sourceAttachmentId: string): Promise<void>;

  /** Only called when `supportsScormImport` is true. */
  getScormUploadUrl?(contentItemId: string, sizeBytes: number): Promise<{ uploadUrl: string; storageKey: string }>;
  importScormPackage?(contentItemId: string, storageKey: string): Promise<void>;

  /** Only called when `supportsVideoUpload` is true. Starts (or restarts — a retry auto-cleans up any
   * stale prior attempt server-side) a video upload for a `type: "video"` content item; the server
   * decides single-PUT vs. multipart purely from `meta.sizeBytes`. */
  startVideoUpload?(contentItemId: string, meta: { fileName: string; contentType: string; sizeBytes: number }): Promise<VideoUploadStart>;
  /** Only called when `supportsVideoUpload` is true, and only for a `strategy: "multipart"` upload —
   * presigns a small batch of part numbers at a time (never the whole upload up front). */
  getVideoPartUploadUrls?(attachmentId: string, partNumbers: number[]): Promise<Record<number, string>>;
  /** Only called when `supportsVideoUpload` is true. Finishes EITHER strategy — `parts` is required
   * (and only meaningful) for a multipart upload. Also what makes the lesson's payload actually start
   * pointing at this video, and cleans up any video it replaces. */
  completeVideoUpload?(attachmentId: string, parts?: { partNumber: number; eTag: string }[]): Promise<{ attachment: Attachment }>;
  /** Only called when `supportsVideoUpload` is true. Cancels a still-`pending` upload (aborting its
   * multipart session, if any, and deleting the attachment row) — the content item itself is left
   * untouched, ready for a different file to be picked. */
  abortVideoUpload?(attachmentId: string): Promise<void>;
}

export { uploadFileToPresignedUrl };

/** The tenant implementation — thin wrapper over the existing `tenantFetch` calls this adapter
 * replaces inline in `course-details-panel.tsx`/`course-objectives-panel.tsx`/`curriculum-tab.tsx`/
 * `content-item-forms/*.tsx`. Behavior is unchanged from before this adapter existed. */
export function tenantCourseEditorApi(subdomain: string): CourseEditorApi {
  return {
    cacheScope: subdomain,
    supportsCourseImage: true,
    supportsSubcategory: true,
    supportsAuthors: true,
    supportsCategoryList: true,
    supportsStandaloneContentItems: true,
    supportsItemStatusToggle: true,
    supportsResourceLinks: true,
    supportsScormImport: true,
    supportsVideoUpload: true,
    supportsMarketplaceUpdate: true,
    supportsFileManager: true,
    supportsAiGeneration: true,

    async createDraftCourse(input) {
      const { data } = await tenantFetch<{ data: { id: string } }>("/courses", {
        method: "POST",
        subdomain,
        body: { title: input.title, category: "Uncategorized", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      return data;
    },
    async fetchCourse(courseId) {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}`, { subdomain });
      return data;
    },
    async updateCourseDetails(courseId, body) {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}`, { method: "PATCH", subdomain, body });
      return data;
    },
    async updateObjectives(courseId, body) {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}/objectives`, { method: "PATCH", subdomain, body });
      return data;
    },
    async uploadCourseImage(courseId, file) {
      const { data: attachment } = await tenantFetch<{ data: { id: string; uploadUrl: string } }>(`/courses/${courseId}/image`, {
        method: "POST",
        subdomain,
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await uploadFileToPresignedUrl(attachment.uploadUrl, file, file.type);
      await tenantFetch(`/attachments/${attachment.id}/confirm`, { method: "POST", subdomain });
    },
    async reuseCourseImage(courseId, sourceAttachmentId) {
      await tenantFetch(`/courses/${courseId}/image/reuse`, { method: "POST", subdomain, body: { sourceAttachmentId } });
    },
    async applyMarketplaceUpdate(courseId) {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}/marketplace-update/apply`, { method: "POST", subdomain });
      return data;
    },
    async dismissMarketplaceUpdate(courseId) {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}/marketplace-update/dismiss`, { method: "POST", subdomain });
      return data;
    },

    async fetchCurriculum(courseId) {
      const { data } = await tenantFetch<{ data: Curriculum }>(`/courses/${courseId}/curriculum`, { subdomain });
      return data;
    },
    async createModule(courseId, input) {
      const { data } = await tenantFetch<{ data: CourseModule }>(`/courses/${courseId}/modules`, { method: "POST", subdomain, body: input });
      return data;
    },
    async updateModule(moduleId, input) {
      const { data } = await tenantFetch<{ data: CourseModule }>(`/modules/${moduleId}`, { method: "PATCH", subdomain, body: input });
      return data;
    },
    async deleteModule(moduleId) {
      await tenantFetch(`/modules/${moduleId}`, { method: "DELETE", subdomain });
    },
    async reorderOutline(courseId, orderedIds) {
      await tenantFetch(`/courses/${courseId}/outline/reorder`, { method: "POST", subdomain, body: { orderedIds } });
    },
    async setModuleStatus(moduleId, status) {
      const { data } = await tenantFetch<{ data: CourseModule }>(`/modules/${moduleId}`, { method: "PATCH", subdomain, body: { status } });
      return data;
    },

    async createContentItem(target, body) {
      const path = "moduleId" in target ? `/modules/${target.moduleId}/content-items` : `/courses/${target.courseId}/content-items`;
      const { data } = await tenantFetch<{ data: ContentItem }>(path, { method: "POST", subdomain, body });
      return data;
    },
    async updateContentItem(contentItemId, body) {
      const { data } = await tenantFetch<{ data: ContentItem }>(`/content-items/${contentItemId}`, { method: "PATCH", subdomain, body });
      return data;
    },
    async deleteContentItem(contentItemId) {
      await tenantFetch(`/content-items/${contentItemId}`, { method: "DELETE", subdomain });
    },
    async reorderModuleContentItems(moduleId, contentItemIds) {
      await tenantFetch(`/modules/${moduleId}/content-items/reorder`, { method: "POST", subdomain, body: { contentItemIds } });
    },
    async moveContentItem(contentItemId, moduleId) {
      await tenantFetch(`/content-items/${contentItemId}`, { method: "PATCH", subdomain, body: { moduleId } });
    },
    async setContentItemStatus(contentItemId, status) {
      const { data } = await tenantFetch<{ data: ContentItem }>(`/content-items/${contentItemId}`, { method: "PATCH", subdomain, body: { status } });
      return data;
    },

    async fetchAttachments(contentItemId) {
      const { data } = await tenantFetch<{ data: Attachment[] }>(`/content-items/${contentItemId}/attachments`, { subdomain });
      return data;
    },
    async createAttachmentUploadUrl(contentItemId, meta) {
      const { data } = await tenantFetch<{ data: { id: string; uploadUrl: string } }>(`/content-items/${contentItemId}/attachments`, {
        method: "POST",
        subdomain,
        body: meta,
      });
      return data;
    },
    async confirmAttachment(_contentItemId, attachmentId) {
      await tenantFetch(`/attachments/${attachmentId}/confirm`, { method: "POST", subdomain });
    },
    async createAttachmentLink(contentItemId, body) {
      await tenantFetch(`/content-items/${contentItemId}/attachments`, { method: "POST", subdomain, body: { kind: "link", ...body } });
    },
    async deleteAttachment(_contentItemId, attachmentId) {
      await tenantFetch(`/attachments/${attachmentId}`, { method: "DELETE", subdomain });
    },

    async fetchTenantFiles() {
      const { data } = await tenantFetch<{ data: TenantFile[] }>("/files", { subdomain });
      return data;
    },
    async reuseAttachment(contentItemId, sourceAttachmentId) {
      const { data } = await tenantFetch<{ data: Attachment }>(`/content-items/${contentItemId}/attachments/reuse`, {
        method: "POST",
        subdomain,
        body: { sourceAttachmentId },
      });
      return data;
    },

    async getScormUploadUrl(contentItemId, sizeBytes) {
      const { data } = await tenantFetch<{ data: { uploadUrl: string; storageKey: string } }>(`/content-items/${contentItemId}/scorm/upload-url`, {
        method: "POST",
        subdomain,
        body: { sizeBytes },
      });
      return data;
    },
    async importScormPackage(contentItemId, storageKey) {
      await tenantFetch(`/content-items/${contentItemId}/scorm/import`, { method: "POST", subdomain, body: { storageKey } });
    },

    async startVideoUpload(contentItemId, meta) {
      const { data } = await tenantFetch<{ data: VideoUploadStart }>(`/content-items/${contentItemId}/video/upload`, {
        method: "POST",
        subdomain,
        body: meta,
      });
      return data;
    },
    async getVideoPartUploadUrls(attachmentId, partNumbers) {
      const { data } = await tenantFetch<{ data: { urls: Record<number, string> } }>(`/attachments/${attachmentId}/video/parts`, {
        method: "POST",
        subdomain,
        body: { partNumbers },
      });
      return data.urls;
    },
    async completeVideoUpload(attachmentId, parts) {
      const { data } = await tenantFetch<{ data: { attachment: Attachment } }>(`/attachments/${attachmentId}/video/complete`, {
        method: "POST",
        subdomain,
        body: { parts },
      });
      return data;
    },
    async abortVideoUpload(attachmentId) {
      await tenantFetch(`/attachments/${attachmentId}/video/abort`, { method: "POST", subdomain });
    },
  };
}

/** The platform (Super Admin) implementation — same shape, backed by `platform_courses`/
 * `platform_course_modules`/`platform_course_content_items`/`platform_file_attachments` via
 * `/platform-api` (the same-origin rewrite proxy every Super Admin client fetch must go through). No
 * `subdomain` — platform routes are gated by `requireSuperAdminSession`, not tenant RLS. */
/** Raw shape `platform-course-content-routes.ts`/`platform-course-curriculum.ts` actually return —
 * no `status` (platform modules/items have no draft/published concept, only the course-level
 * draft/active/archived status) and no resolved `createdBy`/`updatedBy` name (just a raw super admin
 * id). Normalized into the shared `CourseModule`/`ContentItem` shape below. */
interface RawPlatformModule {
  id: string;
  title: string;
  description: string | null;
  contentItems?: RawPlatformContentItem[];
  createdAt: string;
  updatedAt: string;
}
interface RawPlatformContentItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function normalizeModule(m: RawPlatformModule): CourseModule {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    status: "published",
    contentItems: m.contentItems?.map(normalizeContentItem),
    createdBy: null,
    createdAt: m.createdAt,
    updatedBy: null,
    updatedAt: m.updatedAt,
  };
}
function normalizeContentItem(c: RawPlatformContentItem): ContentItem {
  return {
    id: c.id,
    type: c.type as ContentItemType,
    title: c.title,
    description: c.description,
    payload: c.payload,
    status: "published",
    createdBy: null,
    createdAt: c.createdAt,
    updatedBy: null,
    updatedAt: c.updatedAt,
  };
}

/** Raw shape `platform-course-routes.ts`'s `toResponseRows()` actually returns — `categoryName` is a
 * plain string (no tenant category list to resolve an id/object against), and there's no
 * `subcategory`/`moduleCount` at all (spec 029's schema predates spec 028's `subcategory` addition
 * to tenant `courses`, and the "field parity" follow-up deliberately didn't add it — see
 * course-editor-adapter.ts's own doc comment; `moduleCount` has no platform equivalent endpoint).
 * `courseImageUrl` *is* present (UI-reuse follow-up). Normalized into the shared `Course` shape
 * below. */
interface RawPlatformCourse {
  id: string;
  title: string;
  description: string | null;
  categoryName: string;
  deliveryMode: string;
  duration: { value: number; unit: string };
  provider: string | null;
  cost: number | null;
  courseImageUrl: string | null;
  status: string;
  learningObjectives: string[];
  requirements: string[];
  createdAt: string;
  updatedAt: string;
}

function normalizePlatformCourse(c: RawPlatformCourse): Course {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    category: { id: c.categoryName, name: c.categoryName },
    deliveryMode: c.deliveryMode as Course["deliveryMode"],
    duration: c.duration as Course["duration"],
    provider: c.provider,
    cost: c.cost,
    subcategory: null,
    learningObjectives: c.learningObjectives,
    requirements: c.requirements,
    courseImageUrl: c.courseImageUrl,
    moduleCount: 0,
    // A platform course is the marketplace source itself, never a clone of one — "update available"
    // is a tenant-clone concept only (course-api-types.ts).
    updateAvailable: false,
    // Course Assignment Deadlines is a tenant-course-assignment concept only — platform courses have
    // no `course_assignments` rows/audience of their own (a Super Admin author isn't "assigned" one).
    myStartsAt: null,
    myCompletionDeadline: null,
    status: c.status as Course["status"],
    createdBy: null,
    createdAt: c.createdAt,
    updatedBy: null,
    updatedAt: c.updatedAt,
  };
}

export function platformCourseEditorApi(): CourseEditorApi {
  return {
    cacheScope: "platform",
    supportsCourseImage: true,
    supportsSubcategory: false,
    supportsAuthors: false,
    supportsCategoryList: false,
    supportsStandaloneContentItems: false,
    supportsItemStatusToggle: false,
    supportsResourceLinks: true,
    supportsScormImport: false,
    supportsVideoUpload: false,
    supportsMarketplaceUpdate: false,
    supportsFileManager: false,
    supportsAiGeneration: false,

    async createDraftCourse(input) {
      const { data } = await platformFetch<{ data: { id: string } }>("/admin/platform-courses", {
        method: "POST",
        body: { title: input.title, categoryName: "Uncategorized", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      return data;
    },
    async fetchCourse(courseId) {
      const { data } = await platformFetch<{ data: RawPlatformCourse }>(`/admin/platform-courses/${courseId}`);
      return normalizePlatformCourse(data);
    },
    async updateCourseDetails(courseId, body) {
      const { data } = await platformFetch<{ data: RawPlatformCourse }>(`/admin/platform-courses/${courseId}`, {
        method: "PATCH",
        body: { title: body.title, description: body.description, categoryName: body.category, deliveryMode: body.deliveryMode, duration: body.duration },
      });
      return normalizePlatformCourse(data);
    },
    async updateObjectives(courseId, body) {
      const { data } = await platformFetch<{ data: RawPlatformCourse }>(`/admin/platform-courses/${courseId}/objectives`, { method: "PATCH", body });
      return normalizePlatformCourse(data);
    },
    async uploadCourseImage(courseId, file) {
      const { data: attachment } = await platformFetch<{ data: { id: string; uploadUrl: string } }>(`/admin/platform-courses/${courseId}/image`, {
        method: "POST",
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await uploadFileToPresignedUrl(attachment.uploadUrl, file, file.type);
      await platformFetch(`/admin/platform-file-attachments/${attachment.id}/confirm`, { method: "POST" });
    },

    async fetchCurriculum(courseId) {
      const { data } = await platformFetch<{ data: { modules: RawPlatformModule[] } }>(`/admin/platform-courses/${courseId}`);
      const modules = data.modules.map(normalizeModule);
      return { modules, standaloneContentItems: [], outlineOrder: modules.map((m) => m.id) };
    },
    async createModule(courseId, input) {
      const { data } = await platformFetch<{ data: RawPlatformModule }>(`/admin/platform-courses/${courseId}/modules`, { method: "POST", body: input });
      return normalizeModule(data);
    },
    async updateModule(moduleId, input) {
      const { data } = await platformFetch<{ data: RawPlatformModule }>(`/admin/platform-course-modules/${moduleId}`, { method: "PATCH", body: input });
      return normalizeModule(data);
    },
    async deleteModule(moduleId) {
      await platformFetch(`/admin/platform-course-modules/${moduleId}`, { method: "DELETE" });
    },
    async reorderOutline(courseId, orderedIds) {
      // No standalone items on the platform side — the "outline" is always exactly the module order.
      await platformFetch(`/admin/platform-courses/${courseId}/modules/reorder`, { method: "PUT", body: { moduleIds: orderedIds } });
    },

    async createContentItem(target, body) {
      if (!("moduleId" in target)) {
        throw new Error("Platform courses have no standalone content items");
      }
      const { data } = await platformFetch<{ data: RawPlatformContentItem }>(`/admin/platform-course-modules/${target.moduleId}/content-items`, {
        method: "POST",
        body,
      });
      return normalizeContentItem(data);
    },
    async updateContentItem(contentItemId, body) {
      const { data } = await platformFetch<{ data: RawPlatformContentItem }>(`/admin/platform-course-content-items/${contentItemId}`, { method: "PATCH", body });
      return normalizeContentItem(data);
    },
    async deleteContentItem(contentItemId) {
      await platformFetch(`/admin/platform-course-content-items/${contentItemId}`, { method: "DELETE" });
    },
    async reorderModuleContentItems(moduleId, contentItemIds) {
      await platformFetch(`/admin/platform-course-modules/${moduleId}/content-items/reorder`, { method: "PUT", body: { contentItemIds } });
    },
    async moveContentItem(contentItemId, moduleId) {
      if (moduleId === null) {
        throw new Error("Platform courses have no standalone content items");
      }
      await platformFetch(`/admin/platform-course-content-items/${contentItemId}`, { method: "PATCH", body: { platformCourseModuleId: moduleId } });
    },

    async fetchAttachments(contentItemId) {
      const { data } = await platformFetch<{
        data: {
          id: string;
          kind: "file" | "link";
          fileName: string;
          contentType: string | null;
          sizeBytes: number | null;
          url: string | null;
          status: "pending" | "ready";
          createdAt: string;
        }[];
      }>(`/admin/platform-course-content-items/${contentItemId}/attachments`);
      return data.map((row) => ({ ...row, createdBy: null }));
    },
    async createAttachmentUploadUrl(contentItemId, meta) {
      const { data } = await platformFetch<{ data: { id: string; uploadUrl: string } }>(`/admin/platform-course-content-items/${contentItemId}/attachments`, {
        method: "POST",
        body: meta,
      });
      return data;
    },
    // Confirm/download-url/delete are generic (entity-agnostic) on the platform side — shared by a
    // course image and a content-item attachment alike, mirroring tenant-attachment-routes.ts.
    async confirmAttachment(_contentItemId, attachmentId) {
      await platformFetch(`/admin/platform-file-attachments/${attachmentId}/confirm`, { method: "POST" });
    },
    async createAttachmentLink(contentItemId, body) {
      await platformFetch(`/admin/platform-course-content-items/${contentItemId}/attachments`, { method: "POST", body: { kind: "link", ...body } });
    },
    async deleteAttachment(_contentItemId, attachmentId) {
      await platformFetch(`/admin/platform-file-attachments/${attachmentId}`, { method: "DELETE" });
    },
  };
}
