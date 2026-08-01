"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { Input, Button, Drawer } from "@tm/ui";
import { tenantFetch, uploadFileToPresignedUrl } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseAuthor } from "@/lib/course-api-types";

/** "Add Author" drawer (Course Authors sub-section) — name/email/role-or-description/profile-image.
 * The author is created first, then (if a photo was picked) its profile image uploads via its own
 * presigned-URL flow, same shape as the course-image upload. */
export default function AddAuthorDrawer({ courseId, open, onClose }: { courseId: string; open: boolean; onClose: () => void }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleOrDescription, setRoleOrDescription] = useState("");
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setEmail("");
    setRoleOrDescription("");
    setProfileImageFile(null);
    setProfileImagePreview(null);
    setError(null);
  }

  function readImageFile(file: File | undefined) {
    if (!file) return;
    setProfileImageFile(file);
    setProfileImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { data: author } = await tenantFetch<{ data: CourseAuthor }>(`/courses/${courseId}/authors`, {
        method: "POST",
        subdomain,
        body: { name, email, roleOrDescription },
      });
      if (profileImageFile) {
        const { data: attachment } = await tenantFetch<{ data: { id: string; uploadUrl: string } }>(`/course-authors/${author.id}/image`, {
          method: "POST",
          subdomain,
          body: { fileName: profileImageFile.name, contentType: profileImageFile.type, sizeBytes: profileImageFile.size },
        });
        await uploadFileToPresignedUrl(attachment.uploadUrl, profileImageFile, profileImageFile.type);
        await tenantFetch(`/attachments/${attachment.id}/confirm`, { method: "POST", subdomain });
      }
      await queryClient.invalidateQueries({ queryKey: ["course-authors", courseId, subdomain] });
      reset();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add Author"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <p className="banner-error">{error}</p>}

        <div className="flex flex-col items-center gap-2 py-2">
          <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => readImageFile(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-slate-50 text-secondary hover:bg-slate-100"
          >
            {profileImagePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview before upload completes
              <img src={profileImagePreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-6 w-6" />
            )}
          </button>
          <span className="text-xs text-muted">Upload a profile image</span>
        </div>

        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <div>
          <label className="field-label" htmlFor="author-role">
            Role or description
          </label>
          <textarea
            id="author-role"
            className="field-input min-h-[100px]"
            value={roleOrDescription}
            onChange={(e) => setRoleOrDescription(e.target.value)}
          />
        </div>

        <div className="mt-2 flex gap-2">
          <Button type="submit" isLoading={submitting}>
            Add Author
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
