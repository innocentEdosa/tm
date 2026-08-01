"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Input, Button } from "@tm/ui";
import { tenantFetch, uploadFileToPresignedUrl } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { Course, DeliveryMode, DurationUnit } from "@/lib/course-api-types";
import CategoryCombobox from "../category-combobox";

// Tiptap/ProseMirror is one of the heaviest deps in @tm/ui and is only exercised by this one
// description field — code-split it rather than paying for it in every course-editor page load.
const RichTextEditor = dynamic(() => import("@tm/ui").then((mod) => mod.RichTextEditor), {
  ssr: false,
  loading: () => <div className="h-[160px] animate-pulse rounded-lg border border-border bg-slate-50" />,
});

const DELIVERY_MODE_LABEL: Record<DeliveryMode, string> = {
  in_person: "In person",
  virtual: "Virtual",
  self_paced: "Self-paced",
  blended: "Blended",
};

const DURATION_UNIT_LABEL: Record<DurationUnit, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

function FieldLabel({ children, htmlFor, required }: { children: React.ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-secondary">
      {children}
      {required && <span className="text-red-600"> *</span>}
    </label>
  );
}

/**
 * The Information > Course Details panel — uppercase field labels, a rich-text description, a
 * Category/Subcategory pair, and a course image upload. The course image uploads immediately on
 * selection (its own presigned-URL flow, independent of this form's own save) rather than waiting for
 * "Save Changes" — everything else here is a plain PATCH on submit. Provider/Cost live elsewhere
 * (Cost belongs conceptually in a future Pricing tab).
 */
export default function CourseDetailsPanel({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const courseQuery = useQuery({
    queryKey: ["course", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}`, { subdomain });
      return data;
    },
  });
  const course = courseQuery.data;

  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [categoryName, setCategoryName] = useState(course?.category?.name ?? "");
  const [subcategory, setSubcategory] = useState(course?.subcategory ?? "");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(course?.deliveryMode ?? "self_paced");
  const [durationValue, setDurationValue] = useState(String(course?.duration.value ?? 1));
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(course?.duration.unit ?? "hours");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [localImagePreview, setLocalImagePreview] = useState<string | null>(null);

  useEffect(() => {
    if (!course) return;
    setTitle(course.title);
    setDescription(course.description ?? "");
    setCategoryName(course.category?.name ?? "");
    setSubcategory(course.subcategory ?? "");
    setDeliveryMode(course.deliveryMode);
    setDurationValue(String(course.duration.value));
    setDurationUnit(course.duration.unit);
    setLocalImagePreview(null);
    // Only re-sync on initial load / a genuinely different course — not after every save's refetch,
    // which would otherwise clobber whatever the user is mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  if (!course) {
    return courseQuery.isError ? <p className="banner-error">Couldn&apos;t load this course. Try refreshing.</p> : <p className="text-sm text-muted">Loading…</p>;
  }

  async function handleImageFile(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    setLocalImagePreview(URL.createObjectURL(file));
    setUploadingImage(true);
    try {
      const { data: attachment } = await tenantFetch<{ data: { id: string; uploadUrl: string } }>(`/courses/${courseId}/image`, {
        method: "POST",
        subdomain,
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await uploadFileToPresignedUrl(attachment.uploadUrl, file, file.type);
      await tenantFetch(`/attachments/${attachment.id}/confirm`, { method: "POST", subdomain });
      await queryClient.invalidateQueries({ queryKey: ["course", courseId, subdomain] });
    } catch (err) {
      setImageError((err as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    setSaving(true);
    try {
      await tenantFetch(`/courses/${courseId}`, {
        method: "PATCH",
        subdomain,
        body: {
          title,
          description,
          category: categoryName,
          subcategory,
          deliveryMode,
          duration: { value: Number(durationValue), unit: durationUnit },
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["course", courseId, subdomain] });
      setError(null);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const courseImageUrl = localImagePreview ?? course.courseImageUrl;

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">Course Details</h2>
      <p className="mb-6 text-sm text-muted">Edit the details about your course and get your learners informed.</p>

      {error && <p className="banner-error mb-4">{error}</p>}
      {saved && !error && <p className="mb-4 text-sm text-success">Saved.</p>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <fieldset disabled={readOnly} className="flex flex-col gap-6">
          <div>
            <FieldLabel htmlFor="cd-title" required>
              Title
            </FieldLabel>
            <input
              id="cd-title"
              className="field-input"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                queryClient.setQueryData(["course", courseId, subdomain], (prev: Course | undefined) =>
                  prev ? { ...prev, title: e.target.value } : prev,
                );
              }}
              required
            />
          </div>

          <div>
            <FieldLabel htmlFor="cd-description">Description</FieldLabel>
            <RichTextEditor
              key={courseId}
              id="cd-description"
              defaultValue={description}
              onChange={setDescription}
              placeholder="Insert your course description"
              readOnly={readOnly}
            />
          </div>

          <CategoryCombobox value={categoryName} onChange={setCategoryName} id="details-category" />

          <div>
            <FieldLabel htmlFor="details-subcategory">Subcategory</FieldLabel>
            <input
              id="details-subcategory"
              className="field-input"
              placeholder="e.g. Workplace Safety"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel htmlFor="details-deliveryMode" required>
              Delivery mode
            </FieldLabel>
            <select id="details-deliveryMode" className="field-input" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}>
              {Object.entries(DELIVERY_MODE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <FieldLabel htmlFor="details-durationValue" required>
                Duration
              </FieldLabel>
              <Input id="details-durationValue" type="number" min={0} step="any" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} required />
            </div>
            <div>
              <FieldLabel htmlFor="details-durationUnit" required>
                Unit
              </FieldLabel>
              <select id="details-durationUnit" className="field-input" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as DurationUnit)}>
                {Object.entries(DURATION_UNIT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <FieldLabel>Course image</FieldLabel>
            {imageError && <p className="banner-error mb-2">{imageError}</p>}
            <input
              ref={imageInputRef}
              type="file"
              accept=".jpeg,.jpg,.png,.gif,.webp"
              className="hidden"
              onChange={(e) => handleImageFile(e.target.files?.[0])}
            />
            {courseImageUrl ? (
              <div className="flex items-stretch gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote/presigned URL, no next/image domain config for it */}
                <img src={courseImageUrl} alt="Course" className="h-32 w-52 shrink-0 rounded-lg border border-border object-cover" />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleImageFile(e.dataTransfer.files?.[0]);
                  }}
                  disabled={uploadingImage}
                  className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-4 text-center hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary">
                    <Upload className="h-4 w-4" />
                  </span>
                  <p className="text-sm text-secondary">
                    <span className="font-semibold underline">{uploadingImage ? "Uploading…" : "Change"}</span> {!uploadingImage && "or drag and drop"}
                  </p>
                  <p className="text-xs text-muted">Recommended .jpeg, .jpg, .png, or .webp</p>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleImageFile(e.dataTransfer.files?.[0]);
                }}
                disabled={uploadingImage}
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-10 text-center hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary">
                  <Upload className="h-4 w-4" />
                </span>
                <p className="text-sm text-secondary">
                  <span className="font-semibold underline">{uploadingImage ? "Uploading…" : "Click to upload"}</span> {!uploadingImage && "or drag and drop"}
                </p>
                <p className="text-xs text-muted">Recommended .jpeg, .jpg, .png, or .webp</p>
              </button>
            )}
          </div>
        </fieldset>

        {!readOnly && (
          <div>
            <Button type="submit" variant="secondary" isLoading={saving}>
              Save Changes
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
