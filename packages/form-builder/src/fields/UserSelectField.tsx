"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";

const API_BASE = "/tenant-api/tenant";

interface UserResult {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Search-and-select a tenant user — the generic, form-builder-configurable version of the
 * search-and-select-a-user pattern Department's Manager/Assistant Manager fields pioneered via
 * the `fieldRenderers` escape hatch (those stay on their own bespoke component: their value
 * persists through dedicated `departments` table columns, not `custom_field_values`, so they
 * aren't a fit for a generic field type). The stored value here is just the user's id (a plain
 * string) — the name/email shown once someone is picked is resolved separately and is
 * display-only, never the value of record, so a later name change can never desync anything
 * already saved (same precedent Department's own picker follows).
 */
export function UserSelectField({ field, value, onChange, error, readOnly, subdomain }: FieldRendererProps) {
  const id = fieldInputId(field);
  const selectedId = typeof value === "string" ? value : "";
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // No tenant to search within outside a real tenant context (e.g. the Super Admin's Platform
  // Forms preview) — search is disabled rather than firing a request guaranteed to 401.
  const searchDisabled = !subdomain;

  // Resolve a stored id (e.g. loaded from an existing record) into a display name whenever it
  // changes and isn't already the user we have cached — never trusted as the value itself.
  useEffect(() => {
    if (!selectedId) {
      setSelectedUser(null);
      return;
    }
    if (selectedUser?.id === selectedId) return;
    if (searchDisabled) return;
    let cancelled = false;
    fetch(`${API_BASE}/forms/user-search?ids=${encodeURIComponent(selectedId)}&subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((json: { data: UserResult[] }) => {
        if (!cancelled) setSelectedUser(json.data?.[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, subdomain]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed || searchDisabled) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`${API_BASE}/forms/user-search?search=${encodeURIComponent(trimmed)}&subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" });
      const json = (await res.json()) as { data: UserResult[] };
      setResults(json.data ?? []);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, subdomain, searchDisabled]);

  function handleSelect(user: UserResult) {
    setSelectedUser(user);
    onChange(user.id);
    setQuery("");
    setResults([]);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}
      {selectedId ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-primary">{selectedUser?.fullName ?? "…"}</p>
            {selectedUser && <p className="truncate text-xs text-slate-400">{selectedUser.email}</p>}
          </div>
          {!readOnly && (
            <button
              type="button"
              className="shrink-0 cursor-pointer text-sm text-slate-400 hover:text-red-600"
              onClick={() => {
                setSelectedUser(null);
                onChange(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      ) : (
        <>
          <input
            id={id}
            className="field-input"
            placeholder={searchDisabled ? "Search isn't available in this preview" : (field.placeholder ?? "Search by name or email…")}
            value={query}
            disabled={readOnly || searchDisabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          />
          {isOpen && results.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(u)}
                >
                  {u.fullName} <span className="text-slate-400">({u.email})</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
