"use client";

import { useQuery } from "@tanstack/react-query";
import type { EffectiveForm } from "../types/form";

const API_BASE = "/tenant-api/tenant";

/**
 * `GET /tenant/forms/:formKey/effective` (contracts/form-builder-api.md) — the one call a
 * consuming feature needs to retrieve the fully-resolved form for the current tenant. No
 * consuming page merges platform/tenant fields, resolves versions, or sorts anything itself.
 */
export function useEffectiveForm(formKey: string, subdomain: string) {
  const query = useQuery({
    queryKey: ["effective-form", formKey, subdomain],
    queryFn: async (): Promise<EffectiveForm | null> => {
      const res = await fetch(`${API_BASE}/forms/${encodeURIComponent(formKey)}/effective?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      const json = (await res.json()) as { data: EffectiveForm | null };
      return json.data;
    },
    enabled: !!formKey && !!subdomain,
  });

  return { form: query.data ?? null, isLoading: query.isLoading, error: query.error as Error | null };
}
