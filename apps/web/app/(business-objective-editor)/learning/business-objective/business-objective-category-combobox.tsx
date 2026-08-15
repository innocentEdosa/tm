"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tenantFetch } from "@/lib/tenant-api-client";

interface CategoryOption {
  id: string;
  name: string;
}

/** Autocomplete-with-create-option over the real category list — mirrors `CategoryCombobox`
 * (learning/courses/category-combobox.tsx) exactly: typing an unmatched name shows a "Create"
 * option, and the business-objective create/update endpoints resolve it (creating if needed) when
 * the form is submitted. Takes `subdomain` as a prop rather than `useSubdomain()` context since this
 * form isn't nested deep enough to need a `SubdomainProvider`. */
export default function BusinessObjectiveCategoryCombobox({
  subdomain,
  value,
  onChange,
  id = "category",
}: {
  subdomain: string;
  value: string;
  onChange: (name: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  // Focusing the field (even with an existing value already typed/selected) shows the full option
  // list first, same as clicking into any other picker — filtering by the current text only kicks
  // in once the user actually types, not just because a value happens to already be there.
  const [showAllOnFocus, setShowAllOnFocus] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ["business-objective-categories", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CategoryOption[] }>("/business-objectives/categories", { subdomain });
      return data;
    },
  });
  const categories = categoriesQuery.data ?? [];

  const trimmed = value.trim();
  const matches =
    showAllOnFocus || !trimmed
      ? categories
      : categories.filter((c) => c.name.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="relative">
      <label className="field-label" htmlFor={id}>
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
          setShowAllOnFocus(false);
        }}
        onFocus={() => {
          setOpen(true);
          setShowAllOnFocus(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        placeholder="Type to search or create a category"
      />
      {open && (matches.length > 0 || (trimmed && !exactMatch)) && (
        <ul className="surface-card absolute z-10 mt-1 max-h-48 w-full overflow-auto p-1">
          {matches.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                className="block w-full cursor-pointer px-2 py-1 text-left hover:bg-slate-50"
                onMouseDown={() => onChange(category.name)}
              >
                {category.name}
              </button>
            </li>
          ))}
          {trimmed && !exactMatch && (
            <li>
              <button
                type="button"
                className="block w-full cursor-pointer px-2 py-1 text-left hover:bg-slate-50"
                onMouseDown={() => onChange(trimmed)}
              >
                Create &ldquo;{trimmed}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
