"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseCategory } from "@/lib/course-api-types";

/**
 * Autocomplete-with-create-option over the real category list — mirrors the real backend's own
 * resolve-or-create-by-name behavior: typing an unmatched name shows a "Create" option, and the
 * course create/update endpoints resolve it (creating if needed) when the form is submitted. Placed
 * directly under `courses/` (not `[courseId]/`) so it can be imported without crossing the dynamic
 * `[courseId]` segment.
 */
export default function CategoryCombobox({ value, onChange, id = "category" }: { value: string; onChange: (name: string) => void; id?: string }) {
  const subdomain = useSubdomain();
  const [open, setOpen] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ["course-categories", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseCategory[] }>("/courses/categories", { subdomain });
      return data;
    },
  });
  const categories = categoriesQuery.data ?? [];

  const trimmed = value.trim();
  const matches = trimmed ? categories.filter((c) => c.name.toLowerCase().includes(trimmed.toLowerCase())) : categories;
  const exactMatch = categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="relative">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-secondary" htmlFor={id}>
        Category
        <span className="text-red-600"> *</span>
      </label>
      <input
        id={id}
        className="field-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        placeholder="Type to search or create a category"
      />
      {open && (matches.length > 0 || (trimmed && !exactMatch)) && (
        <ul className="surface-card absolute z-10 mt-1 max-h-48 w-full overflow-auto p-1">
          {matches.map((category) => (
            <li key={category.id}>
              <button type="button" className="w-full cursor-pointer text-left px-2 py-1 hover:bg-accent-soft" onMouseDown={() => onChange(category.name)}>
                {category.name}
              </button>
            </li>
          ))}
          {trimmed && !exactMatch && (
            <li>
              <button type="button" className="w-full cursor-pointer text-left px-2 py-1 hover:bg-accent-soft" onMouseDown={() => onChange(trimmed)}>
                Create &ldquo;{trimmed}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
