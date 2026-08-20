"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { tenantFetch } from "@/lib/tenant-api-client";

export interface TargetRef {
  id: string;
  name: string;
}

/** Multi-select search picker shared by the three TNA targeting kinds (department/role/user) —
 * fetches the full candidate list once (departments/roles are always tenant-bounded in size; users
 * capped at the same 100-row convention `DepartmentPicker`/Business Objectives' Owner field
 * already use) and filters client-side, since `/tenant/roles` has no server-side `search` param at
 * all and the other two lists are small enough that a round-trip per keystroke isn't worth it.
 *
 * Lives under `_shared` (not the `(dashboard-shell)` TNA list/detail folder it originally shipped
 * in) because it's consumed both by the full-screen create/edit form (`(tna-editor)` route group,
 * a separate top-level layout with no shared ancestor) and by the detail page's "Add participant"
 * modal — the same cross-route-group sharing convention `_shared/form-builder` already
 * established. */
export default function TargetPicker({
  subdomain,
  label,
  queryKey,
  path,
  nameOf,
  selected,
  onChange,
  placeholder,
}: {
  subdomain: string;
  label: string;
  queryKey: string;
  path: string;
  nameOf: (item: Record<string, unknown>) => string;
  selected: TargetRef[];
  onChange: (next: TargetRef[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const candidatesQuery = useQuery({
    queryKey: [queryKey, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Record<string, unknown>[] }>(path, { subdomain });
      return data.map((item) => ({ id: item.id as string, name: nameOf(item) }));
    },
  });
  const candidates = candidatesQuery.data ?? [];
  const selectedIds = new Set(selected.map((s) => s.id));
  const matches = candidates.filter(
    (c) => !selectedIds.has(c.id) && (!query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div>
      <label className="field-label">{label}</label>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {item.name}
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                className="cursor-pointer text-slate-400 hover:text-primary"
                onClick={() => onChange(selected.filter((x) => x.id !== item.id))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          className="field-input"
          placeholder={placeholder ?? "Search…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
        />
        {open && matches.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-white py-1 shadow-card-md">
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50"
                onMouseDown={() => {
                  onChange([...selected, item]);
                  setQuery("");
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
