"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldRendererProps } from "./field-renderer-props";
import { fieldInputId } from "./field-renderer-props";
import type { PersonOrRoleSelection } from "../types/field";

const API_BASE = "/tenant-api/tenant";

/**
 * Default renderer for `people_select` — multi-select of both users and roles in one picker
 * (multiple form responses feature follow-up, TNA's "Affected Individuals"). Stores an array of
 * `PersonOrRoleSelection` (`{ type, id, label, sublabel? }`) — the label/sublabel are cached at
 * selection time, same "store the id, never re-trust a later lookup" precedent `UserSelectField`
 * already established, extended here to also cache the display text since a multi-valued field
 * has no single natural place to re-resolve names from afterward.
 *
 * Hits the session-authenticated `GET /tenant/forms/people-search` — a consuming feature filled
 * out with **no session** (e.g. TNA's magic-link response form) MUST override this field key with
 * its own `fieldRenderers` entry pointed at its own token-scoped search endpoint instead (spec
 * FR-029); this default only works where a real tenant session exists.
 */
export function PeopleSelectField({ field, value, onChange, error, readOnly, subdomain }: FieldRendererProps) {
  const id = fieldInputId(field);
  const selected = (value as PersonOrRoleSelection[] | undefined) ?? [];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonOrRoleSelection[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDisabled = !subdomain;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed || searchDisabled) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`${API_BASE}/forms/people-search?search=${encodeURIComponent(trimmed)}&subdomain=${encodeURIComponent(subdomain!)}`, {
        credentials: "include",
      });
      const json = (await res.json()) as { data: PersonOrRoleSelection[] };
      setResults(json.data ?? []);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, subdomain, searchDisabled]);

  function handleSelect(entry: PersonOrRoleSelection) {
    if (selected.some((s) => s.type === entry.type && s.id === entry.id)) {
      setQuery("");
      setResults([]);
      setIsOpen(false);
      return;
    }
    onChange([...selected, entry]);
    setQuery("");
    setResults([]);
    setIsOpen(false);
  }

  function handleRemove(entry: PersonOrRoleSelection) {
    onChange(selected.filter((s) => !(s.type === entry.type && s.id === entry.id)));
  }

  return (
    <div className="relative">
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.isRequired ? " *" : ""}
      </label>
      {field.description && <p className="field-hint">{field.description}</p>}

      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((entry) => (
            <span key={`${entry.type}:${entry.id}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2.5 py-1 text-xs text-primary">
              {entry.label}
              <span className="text-slate-400">({entry.type === "user" ? "person" : "role"})</span>
              {!readOnly && (
                <button type="button" className="cursor-pointer text-slate-400 hover:text-red-600" onClick={() => handleRemove(entry)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          <input
            id={id}
            className="field-input"
            placeholder={searchDisabled ? "Search isn't available in this preview" : (field.placeholder ?? "Search people or roles…")}
            value={query}
            disabled={searchDisabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          />
          {isOpen && results.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
              {results.map((r) => (
                <button
                  key={`${r.type}:${r.id}`}
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(r)}
                >
                  {r.label} {r.sublabel && <span className="text-slate-400">({r.sublabel})</span>}
                  <span className="ml-1 text-xs text-slate-400">{r.type === "user" ? "· person" : "· role"}</span>
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
