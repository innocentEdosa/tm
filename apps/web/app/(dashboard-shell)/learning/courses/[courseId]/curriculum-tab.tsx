"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight as ChevronRightIcon, FileText, Folder, MoreHorizontal, Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, Input, Button, Modal, Popover, PopoverMenuItem, Badge } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import {
  buildCourseOutline,
  type Curriculum,
  type CourseModule,
  type ContentItem,
  type ContentItemTarget,
  type ContentItemType,
  type ContentStatus,
} from "@/lib/course-api-types";
import { CONTENT_STATUS_LABEL, CONTENT_STATUS_DOT, CONTENT_STATUS_BADGE_VARIANT } from "@/lib/course-status-display";
import ContentItemTypePicker, { AiContentComingSoonModal, ContentItemTypeMenuItems, TYPE_ICON } from "./content-item-type-picker";
import VideoForm from "./content-item-forms/video-form";
import ArticleForm from "./content-item-forms/article-form";
import LiveClassForm from "./content-item-forms/live-class-form";
import TestAssignmentForm from "./content-item-forms/test-assignment-form";
import ExternalImportForm from "./content-item-forms/external-import-form";

const STATUS_LABEL = CONTENT_STATUS_LABEL;
const STATUS_DOT = CONTENT_STATUS_DOT;
const STATUS_BADGE_VARIANT = CONTENT_STATUS_BADGE_VARIANT;

/** Prefix for a module's empty-content-list droppable zone id, distinguishing it from real item/module
 * ids in the shared `onDragEnd` resolver below. */
const MODULE_DROPZONE_PREFIX = "module-dropzone:";

function targetModuleId(target: ContentItemTarget): string | null {
  return "moduleId" in target ? target.moduleId : null;
}

/** A single, course-wide "at most one lesson form open at a time" value — opening a new add or edit
 * request anywhere in the outline (a different module, the same module, or standalone) replaces
 * whatever was open before, so starting one always closes any other lesson's create/edit form. Each
 * "add" gets a fresh `sessionId` (see `openAddLessonForm`) so it always mounts a brand-new form —
 * without it, re-picking the same type (or switching between `test`/`assignment`, which share one
 * form component) would reuse the previous, still-mounted form instance and carry over its unsaved
 * title/body/etc. instead of starting blank. The real `ContentItem` shape carries no `moduleId` of its
 * own (module membership is implied by nesting in the curriculum response, not a field on the item),
 * so "edit" always carries its container's `target` explicitly alongside the item. */
type LessonForm =
  | { kind: "add"; type: ContentItemType; target: ContentItemTarget; createdId: string | null; sessionId: number }
  | { kind: "edit"; item: ContentItem; target: ContentItemTarget };

interface ModuleLessonForm {
  addingType: ContentItemType | null;
  addingCreatedId: string | null;
  addingSessionId: number | null;
  editingItem: ContentItem | null;
}

const NO_MODULE_LESSON_FORM: ModuleLessonForm = { addingType: null, addingCreatedId: null, addingSessionId: null, editingItem: null };

/** Narrows the course-wide `LessonForm` down to what a single module (or, when `moduleId` is `null`,
 * the standalone/top-level lesson list) should render. Since `lessonForm` is one shared value, at
 * most one of these narrowed views is ever non-empty at a time. */
function lessonFormFor(lessonForm: LessonForm | null, moduleId: string | null): ModuleLessonForm {
  if (!lessonForm) return NO_MODULE_LESSON_FORM;
  if (targetModuleId(lessonForm.target) !== moduleId) return NO_MODULE_LESSON_FORM;
  if (lessonForm.kind === "add") {
    return { addingType: lessonForm.type, addingCreatedId: lessonForm.createdId, addingSessionId: lessonForm.sessionId, editingItem: null };
  }
  return { addingType: null, addingCreatedId: null, addingSessionId: null, editingItem: lessonForm.item };
}

function StatusBadge({ status }: { status: ContentStatus }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]}>
      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function SortableContentItem({
  item,
  readOnly,
  showStatusToggle,
  onToggleStatus,
  onEdit,
  onDelete,
}: {
  item: ContentItem;
  readOnly: boolean;
  showStatusToggle: boolean;
  onToggleStatus: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`surface-card mb-2 flex items-center justify-between rounded-lg! px-3! py-2! ${isDragging ? "opacity-40" : ""}`}
    >
      <div {...(readOnly ? {} : { ...attributes, ...listeners })} className={`flex items-center ${readOnly ? "" : "cursor-grab"}`}>
        <span className="mr-2 flex shrink-0 items-center justify-center text-secondary" aria-hidden="true">
          {TYPE_ICON[item.type]}
        </span>
        {item.title}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={item.status} />
        {!readOnly && (
          <Popover
            width={170}
            trigger={
              <button type="button" aria-label="Lesson actions" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            {(close) => (
              <>
                <button
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                  onClick={() => {
                    close();
                    onEdit();
                  }}
                >
                  Edit
                </button>
                {showStatusToggle && (
                  <button
                    type="button"
                    className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                    onClick={() => {
                      close();
                      onToggleStatus();
                    }}
                  >
                    {item.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                )}
                <button
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </Popover>
        )}
      </div>
    </li>
  );
}

/** Routes an existing content item to the form component matching its `type`, in "edit" mode — one
 * place mapping type → form component, shared by both `ModuleContentItems` (module-scoped lessons)
 * and `CurriculumTab` itself (standalone lessons). */
function ContentItemEditForm({ courseId, target, item, onClose }: { courseId: string; target: ContentItemTarget; item: ContentItem; onClose: () => void }) {
  if (item.type === "video") return <VideoForm courseId={courseId} target={target} onClose={onClose} editingItem={item} />;
  if (item.type === "article") return <ArticleForm courseId={courseId} target={target} onClose={onClose} editingItem={item} />;
  if (item.type === "live_class") return <LiveClassForm courseId={courseId} target={target} onClose={onClose} editingItem={item} />;
  if (item.type === "test" || item.type === "assignment") return <TestAssignmentForm courseId={courseId} type={item.type} target={target} onClose={onClose} editingItem={item} />;
  return <ExternalImportForm courseId={courseId} target={target} onClose={onClose} editingItem={item} />;
}

/** A module's empty-content droppable landing zone — without it, there's nothing under the pointer
 * to register a drop when dragging a lesson into a module that doesn't have any content items yet. */
function ModuleDropZone({ moduleId }: { moduleId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${MODULE_DROPZONE_PREFIX}${moduleId}` });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-dashed px-3 py-4 text-center text-xs ${isOver ? "border-primary bg-slate-50 text-primary" : "border-border text-muted"}`}
    >
      Drag a lesson here
    </div>
  );
}

function ModuleContentItems({
  courseId,
  moduleId,
  contentItems: allContentItems,
  readOnly,
  showStatusToggle,
  addingType,
  addingCreatedId,
  addingSessionId,
  editingItem,
  onToggleItemStatus,
  onDeleteItem,
  onEditContent,
  onContentCreated,
  onContentFormClose,
}: {
  courseId: string;
  moduleId: string;
  contentItems: ContentItem[];
  readOnly: boolean;
  showStatusToggle: boolean;
  addingType: ContentItemType | null;
  addingCreatedId: string | null;
  addingSessionId: number | null;
  editingItem: ContentItem | null;
  onToggleItemStatus: (item: ContentItem) => void;
  onDeleteItem: (item: ContentItem) => void;
  onEditContent: (item: ContentItem, target: ContentItemTarget) => void;
  onContentCreated: (id: string) => void;
  onContentFormClose: () => void;
}) {
  // Hides the lesson currently being added (once autosave has assigned it an id) or edited from the
  // plain row list below, while its own form is shown in its place — a freshly autosaved draft, or
  // one being edited, shouldn't render twice: once as a normal row, once as the open form.
  const contentItems = allContentItems.filter((c) => c.id !== addingCreatedId && c.id !== editingItem?.id);
  const target: ContentItemTarget = { moduleId };

  return (
    <div className="ml-4 mt-2">
      <SortableContext items={contentItems.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {contentItems.length === 0 && addingType === null && editingItem === null ? (
          <ModuleDropZone moduleId={moduleId} />
        ) : (
          <ul>
            {contentItems.map((item) => (
              <SortableContentItem
                key={item.id}
                item={item}
                readOnly={readOnly}
                showStatusToggle={showStatusToggle}
                onToggleStatus={() => onToggleItemStatus(item)}
                onEdit={() => onEditContent(item, target)}
                onDelete={() => onDeleteItem(item)}
              />
            ))}
          </ul>
        )}
      </SortableContext>

      {!readOnly && addingType === "video" && <VideoForm key={addingSessionId} courseId={courseId} target={target} onClose={onContentFormClose} onCreated={onContentCreated} />}
      {!readOnly && addingType === "article" && <ArticleForm key={addingSessionId} courseId={courseId} target={target} onClose={onContentFormClose} onCreated={onContentCreated} />}
      {!readOnly && addingType === "live_class" && (
        <LiveClassForm key={addingSessionId} courseId={courseId} target={target} onClose={onContentFormClose} onCreated={onContentCreated} />
      )}
      {!readOnly && (addingType === "test" || addingType === "assignment") && (
        <TestAssignmentForm key={addingSessionId} courseId={courseId} type={addingType} target={target} onClose={onContentFormClose} onCreated={onContentCreated} />
      )}
      {!readOnly && addingType === "external_import" && (
        <ExternalImportForm key={addingSessionId} courseId={courseId} target={target} onClose={onContentFormClose} onCreated={onContentCreated} />
      )}

      {!readOnly && editingItem && <ContentItemEditForm key={editingItem.id} courseId={courseId} target={target} item={editingItem} onClose={onContentFormClose} />}
    </div>
  );
}

function SortableModule({
  courseId,
  moduleId,
  title,
  status,
  contentItems,
  readOnly,
  showStatusToggle,
  collapsed,
  onToggleCollapse,
  onRename,
  onEdit,
  onToggleStatus,
  onDelete,
  lessonForm,
  onPickContentType,
  onToggleItemStatus,
  onDeleteItem,
  onEditContent,
  onContentCreated,
  onContentFormClose,
}: {
  courseId: string;
  moduleId: string;
  title: string;
  status: ContentStatus;
  contentItems: ContentItem[];
  readOnly: boolean;
  showStatusToggle: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRename: (title: string) => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  lessonForm: ModuleLessonForm;
  onPickContentType: (type: ContentItemType) => void;
  onToggleItemStatus: (item: ContentItem) => void;
  onDeleteItem: (item: ContentItem) => void;
  onEditContent: (item: ContentItem, target: ContentItemTarget) => void;
  onContentCreated: (id: string) => void;
  onContentFormClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: moduleId });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`mb-4 ${isDragging ? "opacity-40" : ""}`}>
      {/* `!` forces these to win over `.surface-card`'s own `p-8`/`rounded-2xl` — that class is plain
          unlayered CSS (globals.css has no `@layer components`), so per CSS cascade-layers rules it
          always beats a Tailwind utility layer class regardless of className order; a trailing-bang
          important modifier is Tailwind v4's answer to exactly this. */}
      <Card className="rounded-lg! px-4! py-3!">
        <div className="flex items-center justify-between">
          <div {...(readOnly || editingTitle ? {} : { ...attributes, ...listeners })} className={`flex items-center gap-2 ${readOnly || editingTitle ? "" : "cursor-grab"}`}>
            <Folder className="h-4 w-4 shrink-0 text-secondary" />
            {editingTitle ? (
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  onRename(titleDraft);
                  setEditingTitle(false);
                }}
                autoFocus
              />
            ) : (
              <p className="flex items-baseline gap-1.5 font-semibold" onDoubleClick={() => !readOnly && setEditingTitle(true)}>
                {title}
                <span className="text-xs font-normal text-muted">
                  ({contentItems.length} lesson{contentItems.length === 1 ? "" : "s"})
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!readOnly && (
              <ContentItemTypePicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onPick={(type) => {
                  onPickContentType(type);
                  setPickerOpen(false);
                }}
                trigger={
                  <button type="button" className="flex cursor-pointer items-center gap-1 text-sm font-medium text-primary hover:underline">
                    <Plus className="h-4 w-4" />
                    Add Content
                  </button>
                }
              />
            )}
            <StatusBadge status={status} />
            {!readOnly && (
              <Popover
                width={180}
                trigger={
                  <button type="button" aria-label="Module actions" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                }
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                      onClick={() => {
                        close();
                        onEdit();
                      }}
                    >
                      Edit module
                    </button>
                    {showStatusToggle && (
                      <button
                        type="button"
                        className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                        onClick={() => {
                          close();
                          onToggleStatus();
                        }}
                      >
                        {status === "published" ? "Unpublish module" : "Publish module"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                      onClick={() => {
                        close();
                        onDelete();
                      }}
                    >
                      Delete module
                    </button>
                  </>
                )}
              </Popover>
            )}
            <button
              type="button"
              aria-label={collapsed ? "Expand module" : "Collapse module"}
              className="cursor-pointer rounded p-1 text-secondary hover:bg-slate-100"
              onClick={onToggleCollapse}
            >
              {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <ModuleContentItems
            courseId={courseId}
            moduleId={moduleId}
            contentItems={contentItems}
            readOnly={readOnly}
            showStatusToggle={showStatusToggle}
            addingType={lessonForm.addingType}
            addingCreatedId={lessonForm.addingCreatedId}
            addingSessionId={lessonForm.addingSessionId}
            editingItem={lessonForm.editingItem}
            onToggleItemStatus={onToggleItemStatus}
            onDeleteItem={onDeleteItem}
            onEditContent={onEditContent}
            onContentCreated={onContentCreated}
            onContentFormClose={onContentFormClose}
          />
        )}
      </Card>
    </li>
  );
}

/** Creates a new module (`module` is `null`) or edits an existing one's title/description
 * (`module` is set) — one modal for both, matching the create-vs-edit pattern used elsewhere in
 * this feature (e.g. the course details form doubling as both setup and edit-in-place). */
function ModuleFormModal({
  open,
  module,
  onSubmit,
  onClose,
}: {
  open: boolean;
  module: CourseModule | null;
  onSubmit: (input: { title: string; description: string }) => Promise<{ error: string } | void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(module?.title ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(module?.title ?? "");
    setDescription(module?.description ?? "");
    setError(null);
  }, [open, module]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const result = await onSubmit({ title, description });
    setSubmitting(false);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={module ? "Edit Module" : "New Module"}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <p className="banner-error">{error}</p>}
        <Input label="Title" placeholder="Module Name" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        <div>
          <label className="field-label" htmlFor="module-form-description">
            Description
          </label>
          <textarea
            id="module-form-description"
            className="field-input"
            rows={3}
            placeholder="Content"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {module ? "Save Changes" : "Create Module"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The "Lesson" row inside the top-level "Add Content" menu — a cascading submenu, not an in-place
 * swap: this row stays put and its own type list flies out beside it in a portal (escaping the
 * parent popover panel's `overflow-hidden`, which would otherwise clip anything positioned outside
 * its own bounds), so the first popover never disappears until a type (or AI) is actually picked.
 */
function LessonSubmenuItem({
  active,
  onToggle,
  onPick,
  onAiPick,
  close,
}: {
  active: boolean;
  onToggle: () => void;
  onPick: (type: ContentItemType) => void;
  onAiPick: () => void;
  close: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const width = 260;

  useEffect(() => {
    if (!active || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setPosition({ top: rect.top, left: rect.left - width - 8 });
  }, [active]);

  return (
    <div ref={rowRef}>
      <PopoverMenuItem icon={<FileText className="h-4 w-4" />} title="Lesson" onClick={onToggle} />
      {active &&
        position &&
        createPortal(
          <div
            data-popover
            style={{ top: position.top, left: position.left, width }}
            className="fixed z-50 divide-y divide-border overflow-hidden rounded-lg border border-border bg-white shadow-card-md"
          >
            <ContentItemTypeMenuItems close={close} onPick={onPick} onAiPick={onAiPick} />
          </div>,
          document.body,
        )}
    </div>
  );
}

type DropDestination = { type: "outline"; index: number } | { type: "module"; moduleId: string; index: number };
type ItemContainer = { type: "module"; moduleId: string } | { type: "standalone" };

/**
 * The "Course Outline" curriculum panel — a single unified, `@dnd-kit`-backed drag-and-drop list:
 * modules and standalone lessons interleaved in one order (no separate "Lessons" grouping), a
 * top-level "Add Content" menu (Module / Lesson), a Collapse All / Expand All toggle, and
 * per-module/per-lesson draft/published status (independent of the course's own status). New items
 * default to appearing in creation order (appended to the end); a single `DndContext` spans the
 * whole outline plus every module's nested content list, so a lesson can be dragged into a reorder
 * within its own list, into a different module, or out to the top level.
 *
 * Reorders (module order, and content-item order within one module) are applied optimistically to
 * the React Query cache before the mutation settles, so a drag feels instant — the mock UI this
 * replaced was itself instant/synchronous, and refetch-then-re-render would otherwise show a visible
 * revert-then-reorder flicker. A cross-container move (into a different module, or to/from
 * standalone) isn't optimistically patched — that's a rarer interaction, and correctly patching every
 * array involved (source module, target module or standalone list, and outlineOrder) is enough
 * additional risk that a brief refetch-driven update is the better trade here.
 */
export default function CurriculumTab({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const api = useCourseEditorApi();
  const queryClient = useQueryClient();

  const curriculumQuery = useQuery({
    queryKey: ["course-curriculum", courseId, api.cacheScope],
    queryFn: () => api.fetchCurriculum(courseId),
  });
  const curriculum = curriculumQuery.data;

  const [confirmDeleteModuleId, setConfirmDeleteModuleId] = useState<string | null>(null);
  const [confirmDeleteLessonId, setConfirmDeleteLessonId] = useState<string | null>(null);
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(new Set());
  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  /** The module currently open for editing in `ModuleFormModal`, or `null` when the modal is
   * creating a brand-new module instead. */
  const [editingModule, setEditingModule] = useState<CourseModule | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuStep, setAddMenuStep] = useState<"root" | "lesson">("root");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  /** At most one lesson's add/edit form is ever open across the whole outline — a module-scoped add,
   * a standalone add, or an edit of any lesson anywhere. Opening a new one (`openAddLessonForm`/
   * `openEditLessonForm`) always replaces whatever was open before, so starting a create or edit
   * elsewhere closes it. */
  const [lessonForm, setLessonForm] = useState<LessonForm | null>(null);
  /** The currently-dragged module or lesson id, driving the floating `DragOverlay` preview below —
   * without it (and the small pointer-activation distance on the sensor), a plain `useSortable` drag
   * transforms the real DOM node in place with no lift/shadow and can misfire on an ordinary click,
   * which reads as "jumpy" rather than a smooth, deliberate drag. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  /** Incremented on every `openAddLessonForm` call to mint each "add" a unique `sessionId` — see
   * `LessonForm`'s own doc comment for why this matters. */
  const addSessionRef = useRef(0);

  function invalidateCurriculum() {
    queryClient.invalidateQueries({ queryKey: ["course-curriculum", courseId, api.cacheScope] });
  }
  function invalidateCourse() {
    queryClient.invalidateQueries({ queryKey: ["course", courseId, api.cacheScope] });
  }
  function patchCurriculum(updater: (prev: Curriculum) => Curriculum) {
    queryClient.setQueryData<Curriculum>(["course-curriculum", courseId, api.cacheScope], (prev) => (prev ? updater(prev) : prev));
  }

  const createModuleMutation = useMutation({
    mutationFn: (input: { title: string; description: string }) => api.createModule(courseId, input),
    onSuccess: () => {
      invalidateCurriculum();
      invalidateCourse();
    },
  });
  const updateModuleMutation = useMutation({
    mutationFn: ({ moduleId, input }: { moduleId: string; input: { title: string; description: string } }) => api.updateModule(moduleId, input),
    onSuccess: invalidateCurriculum,
  });
  const renameModuleMutation = useMutation({
    mutationFn: ({ moduleId, title }: { moduleId: string; title: string }) => api.updateModule(moduleId, { title }),
    onSuccess: invalidateCurriculum,
  });
  const setModuleStatusMutation = useMutation({
    // Only ever invoked when `api.supportsItemStatusToggle` is true (the UI hides the toggle
    // otherwise), which is exactly when `setModuleStatus` is guaranteed to be defined.
    mutationFn: ({ moduleId, status }: { moduleId: string; status: ContentStatus }) => api.setModuleStatus!(moduleId, status),
    onSuccess: invalidateCurriculum,
  });
  const deleteModuleMutation = useMutation({
    mutationFn: (moduleId: string) => api.deleteModule(moduleId),
    onSuccess: () => {
      invalidateCurriculum();
      invalidateCourse();
    },
  });
  const setContentItemStatusMutation = useMutation({
    // Same non-null rationale as `setModuleStatusMutation` above.
    mutationFn: ({ contentItemId, status }: { contentItemId: string; status: ContentStatus }) => api.setContentItemStatus!(contentItemId, status),
    onSuccess: invalidateCurriculum,
  });
  const deleteContentItemMutation = useMutation({
    mutationFn: (contentItemId: string) => api.deleteContentItem(contentItemId),
    onSuccess: invalidateCurriculum,
  });
  const reorderModuleContentItemsMutation = useMutation({
    mutationFn: ({ moduleId, contentItemIds }: { moduleId: string; contentItemIds: string[] }) => api.reorderModuleContentItems(moduleId, contentItemIds),
    onError: invalidateCurriculum,
  });
  const moveContentItemMutation = useMutation({
    mutationFn: ({ contentItemId, moduleId }: { contentItemId: string; moduleId: string | null }) => api.moveContentItem(contentItemId, moduleId),
    onSettled: invalidateCurriculum,
  });
  const reorderOutlineMutation = useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderOutline(courseId, orderedIds),
    onError: invalidateCurriculum,
  });

  if (!curriculum) {
    return curriculumQuery.isError ? <p className="banner-error">Couldn&apos;t load the curriculum. Try refreshing.</p> : <p className="text-sm text-muted">Loading…</p>;
  }

  const modules = curriculum.modules;
  const outline = buildCourseOutline(curriculum);

  function findModule(id: string): CourseModule | undefined {
    return curriculum!.modules.find((m) => m.id === id);
  }
  function findContentItem(id: string): ContentItem | undefined {
    for (const m of curriculum!.modules) {
      const found = (m.contentItems ?? []).find((c) => c.id === id);
      if (found) return found;
    }
    return curriculum!.standaloneContentItems.find((c) => c.id === id);
  }
  function findItemContainer(id: string): ItemContainer | null {
    for (const m of curriculum!.modules) {
      if ((m.contentItems ?? []).some((c) => c.id === id)) return { type: "module", moduleId: m.id };
    }
    if (curriculum!.standaloneContentItems.some((c) => c.id === id)) return { type: "standalone" };
    return null;
  }

  const allCollapsed = modules.length > 0 && modules.every((m) => collapsedModuleIds.has(m.id));
  const draggingModule = draggingId ? findModule(draggingId) : undefined;
  const draggingItem = !draggingModule && draggingId ? findContentItem(draggingId) : undefined;
  const standaloneLessonForm = lessonFormFor(lessonForm, null);
  // Rendering-only view of the outline — `handleDragEnd`/`resolveDropDestination` below must keep
  // operating on the full `outline` (including the hidden in-progress draft), since the reorder
  // endpoint validates its input against the course's real, full `outlineOrder` set.
  const visibleOutline = outline.filter(
    (entry) => !(entry.kind === "lesson" && (entry.item.id === standaloneLessonForm.addingCreatedId || entry.item.id === standaloneLessonForm.editingItem?.id)),
  );

  function openAddLessonForm(type: ContentItemType, target: ContentItemTarget) {
    addSessionRef.current += 1;
    setLessonForm({ kind: "add", type, target, createdId: null, sessionId: addSessionRef.current });
  }

  function openEditLessonForm(item: ContentItem, target: ContentItemTarget) {
    setLessonForm({ kind: "edit", item, target });
  }

  function closeLessonForm() {
    setLessonForm(null);
  }

  function handleLessonCreated(id: string) {
    setLessonForm((prev) => (prev && prev.kind === "add" ? { ...prev, createdId: id } : prev));
  }

  /** Resolves whatever `over.id` a drop landed on to a destination container + insertion index —
   * a module (by its header, an empty-module dropzone, or one of its content items), or the
   * top-level outline (by a module card or a standalone lesson row). */
  function resolveDropDestination(overId: string): DropDestination | null {
    if (overId.startsWith(MODULE_DROPZONE_PREFIX)) {
      return { type: "module", moduleId: overId.slice(MODULE_DROPZONE_PREFIX.length), index: 0 };
    }
    if (findModule(overId)) {
      const index = outline.findIndex((entry) => entry.id === overId);
      return index === -1 ? null : { type: "outline", index };
    }
    const overContainer = findItemContainer(overId);
    if (overContainer) {
      if (overContainer.type === "module") {
        const hostModule = findModule(overContainer.moduleId);
        if (!hostModule) return null;
        const index = (hostModule.contentItems ?? []).findIndex((c) => c.id === overId);
        return { type: "module", moduleId: overContainer.moduleId, index };
      }
      const index = outline.findIndex((entry) => entry.id === overId);
      return index === -1 ? null : { type: "outline", index };
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // Modules only ever live in the top-level outline — they can't be dropped into a module.
    if (findModule(activeId)) {
      const ids = outline.map((entry) => entry.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (newIndex === -1) return;
      const newOrder = arrayMove(ids, oldIndex, newIndex);
      patchCurriculum((prev) => ({ ...prev, outlineOrder: newOrder }));
      reorderOutlineMutation.mutate(newOrder);
      return;
    }

    if (!findContentItem(activeId)) return;
    const dest = resolveDropDestination(overId);
    if (!dest) return;
    const sourceContainer = findItemContainer(activeId);
    if (!sourceContainer) return;

    if (dest.type === "outline") {
      if (sourceContainer.type === "standalone") {
        const ids = outline.map((entry) => entry.id);
        const oldIndex = ids.indexOf(activeId);
        const newOrder = arrayMove(ids, oldIndex, dest.index);
        patchCurriculum((prev) => ({ ...prev, outlineOrder: newOrder }));
        reorderOutlineMutation.mutate(newOrder);
      } else if (api.supportsStandaloneContentItems) {
        moveContentItemMutation.mutate({ contentItemId: activeId, moduleId: null });
      }
      // No standalone items on the platform side — dropping a module-owned lesson onto another
      // module's header (the only way to reach `dest.type === "outline"` from a module-sourced item)
      // is simply a no-op there instead of erroring.
    } else if (sourceContainer.type === "module" && sourceContainer.moduleId === dest.moduleId) {
      const mod = findModule(dest.moduleId);
      if (!mod) return;
      const ids = (mod.contentItems ?? []).map((c) => c.id);
      const oldIndex = ids.indexOf(activeId);
      const newOrder = arrayMove(ids, oldIndex, dest.index);
      patchCurriculum((prev) => ({
        ...prev,
        modules: prev.modules.map((m) =>
          m.id === dest.moduleId ? { ...m, contentItems: newOrder.map((id) => (m.contentItems ?? []).find((c) => c.id === id)!) } : m,
        ),
      }));
      reorderModuleContentItemsMutation.mutate({ moduleId: dest.moduleId, contentItemIds: newOrder });
    } else {
      moveContentItemMutation.mutate({ contentItemId: activeId, moduleId: dest.moduleId });
    }
  }

  function toggleModuleCollapsed(moduleId: string) {
    setCollapsedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  function toggleCollapseAll() {
    setCollapsedModuleIds(allCollapsed ? new Set() : new Set(modules.map((m) => m.id)));
  }

  function closeAddMenu(open: boolean) {
    setAddMenuOpen(open);
    if (!open) setAddMenuStep("root");
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-primary">Course Outline</h2>
          <p className="text-sm text-muted">Build your course content by creating modules and lessons.</p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {modules.length > 0 && (
              <Button variant="outline" size="sm" onClick={toggleCollapseAll}>
                {allCollapsed ? "Expand All" : "Collapse All"}
              </Button>
            )}
            <Popover width={220} trigger={<Button size="sm">Add Content</Button>} open={addMenuOpen} onOpenChange={closeAddMenu}>
              {(close) => (
                <>
                  <PopoverMenuItem
                    icon={<Folder className="h-4 w-4" />}
                    title="Module"
                    onClick={() => {
                      close();
                      setEditingModule(null);
                      setModuleModalOpen(true);
                    }}
                  />
                  {api.supportsStandaloneContentItems && (
                    <LessonSubmenuItem
                      active={addMenuStep === "lesson"}
                      onToggle={() => setAddMenuStep((step) => (step === "lesson" ? "root" : "lesson"))}
                      close={close}
                      onPick={(type) => {
                        openAddLessonForm(type, { courseId });
                        setAddMenuStep("root");
                      }}
                      onAiPick={() => {
                        setAiModalOpen(true);
                        setAddMenuStep("root");
                      }}
                    />
                  )}
                </>
              )}
            </Popover>
          </div>
        )}
      </div>

      {visibleOutline.length === 0 && standaloneLessonForm.addingType === null && standaloneLessonForm.editingItem === null ? (
        <p className="text-sm text-muted">No modules or lessons yet — use &ldquo;Add Content&rdquo; to create one.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDraggingId(null)}>
          <SortableContext items={visibleOutline.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
            <ul>
              {visibleOutline.map((entry) =>
                entry.kind === "module" ? (
                  <SortableModule
                    key={entry.id}
                    courseId={courseId}
                    moduleId={entry.module.id}
                    title={entry.module.title}
                    status={entry.module.status}
                    contentItems={entry.module.contentItems ?? []}
                    readOnly={readOnly}
                    showStatusToggle={api.supportsItemStatusToggle}
                    collapsed={collapsedModuleIds.has(entry.module.id)}
                    onToggleCollapse={() => toggleModuleCollapsed(entry.module.id)}
                    onRename={(title) => renameModuleMutation.mutate({ moduleId: entry.module.id, title })}
                    onEdit={() => {
                      setEditingModule(entry.module);
                      setModuleModalOpen(true);
                    }}
                    onToggleStatus={() => setModuleStatusMutation.mutate({ moduleId: entry.module.id, status: entry.module.status === "published" ? "draft" : "published" })}
                    onDelete={() => setConfirmDeleteModuleId(entry.module.id)}
                    lessonForm={lessonFormFor(lessonForm, entry.module.id)}
                    onPickContentType={(type) => openAddLessonForm(type, { moduleId: entry.module.id })}
                    onToggleItemStatus={(item) => setContentItemStatusMutation.mutate({ contentItemId: item.id, status: item.status === "published" ? "draft" : "published" })}
                    onDeleteItem={(item) => setConfirmDeleteLessonId(item.id)}
                    onEditContent={openEditLessonForm}
                    onContentCreated={handleLessonCreated}
                    onContentFormClose={closeLessonForm}
                  />
                ) : (
                  <SortableContentItem
                    key={entry.id}
                    item={entry.item}
                    readOnly={readOnly}
                    showStatusToggle={api.supportsItemStatusToggle}
                    onToggleStatus={() =>
                      setContentItemStatusMutation.mutate({ contentItemId: entry.item.id, status: entry.item.status === "published" ? "draft" : "published" })
                    }
                    onEdit={() => openEditLessonForm(entry.item, { courseId })}
                    onDelete={() => setConfirmDeleteLessonId(entry.item.id)}
                  />
                ),
              )}
            </ul>
          </SortableContext>

          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            {draggingModule && (
              <div className="surface-card cursor-grabbing rounded-lg! px-4! py-3! shadow-card-lg">
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 shrink-0 text-secondary" />
                  <p className="font-semibold">{draggingModule.title}</p>
                </div>
              </div>
            )}
            {draggingItem && (
              <div className="surface-card flex cursor-grabbing items-center rounded-lg! px-3! py-2! shadow-card-lg">
                <span className="mr-2 flex shrink-0 items-center justify-center text-secondary" aria-hidden="true">
                  {TYPE_ICON[draggingItem.type]}
                </span>
                {draggingItem.title}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {!readOnly && standaloneLessonForm.addingType === "video" && (
        <VideoForm key={standaloneLessonForm.addingSessionId} courseId={courseId} target={{ courseId }} onClose={closeLessonForm} onCreated={handleLessonCreated} />
      )}
      {!readOnly && standaloneLessonForm.addingType === "article" && (
        <ArticleForm key={standaloneLessonForm.addingSessionId} courseId={courseId} target={{ courseId }} onClose={closeLessonForm} onCreated={handleLessonCreated} />
      )}
      {!readOnly && standaloneLessonForm.addingType === "live_class" && (
        <LiveClassForm key={standaloneLessonForm.addingSessionId} courseId={courseId} target={{ courseId }} onClose={closeLessonForm} onCreated={handleLessonCreated} />
      )}
      {!readOnly && (standaloneLessonForm.addingType === "test" || standaloneLessonForm.addingType === "assignment") && (
        <TestAssignmentForm
          key={standaloneLessonForm.addingSessionId}
          courseId={courseId}
          type={standaloneLessonForm.addingType}
          target={{ courseId }}
          onClose={closeLessonForm}
          onCreated={handleLessonCreated}
        />
      )}
      {!readOnly && standaloneLessonForm.addingType === "external_import" && (
        <ExternalImportForm key={standaloneLessonForm.addingSessionId} courseId={courseId} target={{ courseId }} onClose={closeLessonForm} onCreated={handleLessonCreated} />
      )}

      {!readOnly && standaloneLessonForm.editingItem && (
        <ContentItemEditForm key={standaloneLessonForm.editingItem.id} courseId={courseId} target={{ courseId }} item={standaloneLessonForm.editingItem} onClose={closeLessonForm} />
      )}

      <ModuleFormModal
        open={moduleModalOpen}
        module={editingModule}
        onSubmit={async ({ title, description }) => {
          try {
            if (editingModule) {
              await updateModuleMutation.mutateAsync({ moduleId: editingModule.id, input: { title, description } });
            } else {
              await createModuleMutation.mutateAsync({ title, description });
            }
          } catch (err) {
            return { error: (err as Error).message };
          }
        }}
        onClose={() => {
          setModuleModalOpen(false);
          setEditingModule(null);
        }}
      />

      <AiContentComingSoonModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} />

      <Modal open={confirmDeleteModuleId !== null} onClose={() => setConfirmDeleteModuleId(null)} title="Delete this module?">
        <p className="mb-4">Its content items will be deleted too. This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              if (confirmDeleteModuleId) deleteModuleMutation.mutate(confirmDeleteModuleId);
              setConfirmDeleteModuleId(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteModuleId(null)}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDeleteLessonId !== null} onClose={() => setConfirmDeleteLessonId(null)} title="Delete this lesson?">
        <p className="mb-4">This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              if (confirmDeleteLessonId) deleteContentItemMutation.mutate(confirmDeleteLessonId);
              setConfirmDeleteLessonId(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteLessonId(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
