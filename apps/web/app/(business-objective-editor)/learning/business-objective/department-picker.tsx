"use client";

import { useEffect, useState } from "react";
import { tenantFetch } from "@/lib/tenant-api-client";

export interface DepartmentRef {
  id: string;
  name: string;
}

interface DepartmentSearchResult {
  id: string;
  name: string;
}

/** Search-as-you-type department picker for the objective's owning department — mirrors
 * `PersonPicker` (department-settings-client.tsx) exactly, just querying `/departments?search=`
 * instead of `/users?search=`. */
export default function DepartmentPicker({
  subdomain,
  value,
  onChange,
  id = "owner-department",
}: {
  subdomain: string;
  value: DepartmentRef | null;
  onChange: (department: DepartmentRef | null) => void;
  id?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DepartmentSearchResult[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const { data } = await tenantFetch<{ data: DepartmentSearchResult[] }>(
          `/departments?search=${encodeURIComponent(query)}`,
          { subdomain },
        );
        setResults(data);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, subdomain]);

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        Owner
        <span className="text-red-600"> *</span>
      </label>
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-sm text-primary">{value.name}</span>
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-slate-500 hover:text-primary"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            id={id}
            className="field-input"
            placeholder="Search for a department…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-white py-1 shadow-card-md">
              {results.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50"
                  onClick={() => {
                    onChange({ id: d.id, name: d.name });
                    setQuery("");
                    setResults([]);
                  }}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
