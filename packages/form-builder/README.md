# @tm/form-builder

Shared form infrastructure for TM: a Super Admin builds and publishes a versioned form (fields,
layout, steps, sections); Tenant Admins extend it with their own fields or hide optional ones;
any application feature consumes the result through one shared renderer. See
`specs/033-form-builder/` for the full spec, architecture, and API contracts.

## Consuming a form (the common case)

If you're building a feature that needs a configurable form (create/edit an entity, a profile
view, anything with fields a tenant might want to extend), you need three things:

```tsx
"use client";
import { useEffectiveForm, FormRenderer } from "@tm/form-builder";

export function MyFeatureForm({ subdomain }: { subdomain: string }) {
  const { form } = useEffectiveForm("my_form_key", subdomain);
  const [values, setValues] = useState<Record<string, unknown>>({});

  return (
    <FormRenderer
      form={form}
      values={values}
      onChange={(fieldKey, value) => setValues((v) => ({ ...v, [fieldKey]: value }))}
      onSubmit={async (values) => {
        await fetch(`/tenant-api/tenant/my-feature`, {
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ ...values }),
        });
      }}
    />
  );
}
```

That's it. You do not:

- Query individual fields, sort them, or merge platform/tenant fields — `useEffectiveForm`
  already returns the fully-resolved, ordered form.
- Write a field-type switch (`text` vs `select` vs `date` vs …) — `FormRenderer` handles all 13
  supported types.
- Implement multi-column layout, multi-step navigation, or step-level validation —
  `FormRenderer` does this from the form definition alone.
- Re-implement required/type validation — `FormRenderer` runs it client-side before calling
  `onSubmit`, and merges in whatever your backend returns via the `errors` prop.

**Registering a new form type**: form types are either created once via a Super Admin session
(`POST /platform/forms`, no migration needed — see the "Platform Forms" screen at
`/admin/forms`) or seeded via migration for framework-owned system fields (see any
`0*_seed_*_system_fields.sql` migration for the pattern). Your feature only ever needs the form's
`key` (e.g. `"department"`, `"member"`) — never its internal id.

## When a system field needs bespoke behavior

Some fields aren't generic — a person-search widget, a filtered dropdown, anything more than
"render an input of this type." Supply your own component for that field key via
`fieldRenderers`:

```tsx
import type { FieldRendererProps } from "@tm/form-builder";

function ManagerPickerField({ field, value, onChange, error }: FieldRendererProps) {
  return <PersonPicker label={field.label} value={value as UserRef | null} onChange={onChange} />;
}

<FormRenderer form={form} values={values} onChange={handleChange} onSubmit={handleSubmit}
  fieldRenderers={{ manager_id: ManagerPickerField }}
/>;
```

Every other field on the form still renders generically — you only override what's genuinely
bespoke. See `apps/web/app/(dashboard-shell)/settings/department/department-settings-client.tsx`
for a full worked example (`DEPARTMENT_FIELD_RENDERERS`), including the module-level React
Context pattern used to give override components access to page-local state without breaking
component identity across renders (defining a component *inline* in your render body will remount
it — and drop input focus — on every keystroke; don't do that).

## When you need more than one submit action

If your form has more than one differently-validated action (e.g. "Save as draft" that skips
required-field checks, plus "Submit" that enforces them — see
`apps/web/app/(dashboard-shell)/learning/training-requests/training-need-form.tsx`), pass
`hideActions` to suppress `FormRenderer`'s own footer, attach a `ref`, and call
`ref.current.validate()` from whichever of your own buttons should enforce validation:

```tsx
const formRef = useRef<FormRendererHandle>(null);

<FormRenderer ref={formRef} form={form} values={values} onChange={handleChange}
  onSubmit={() => {}} hideActions
/>
<Button onClick={() => saveDraft(values)}>Save as draft</Button>
<Button onClick={() => { if (formRef.current?.validate()) submit(values); }}>Submit</Button>
```

## Preview

`<FormPreview form={form} />` renders the exact same component tree as production, in read-only
mode — used by the Platform Forms builder's live preview and by any "view" drawer that just needs
to display a record's field values without inputs. Never build a second, bespoke preview renderer.

## Package contents

- `components/FormRenderer` — the shared renderer (`FormRenderer`, `FormRendererHandle`).
- `components/FormPreview` — read-only wrapper around `FormRenderer`.
- `fields/` — one component per field type (`text`, `textarea`, `number`, `email`, `url`, `date`,
  `datetime`, `select`, `multiselect`, `radio`, `checkbox`, `toggle`, `file`).
- `hooks/use-effective-form.ts` — `useEffectiveForm(formKey, subdomain)`.
- `types/` — `EffectiveForm`, `FormStep`, `FormSection`, `FormField`, `FieldType`, etc. — the
  single source of truth for the wire shape (mirrors `apps/api/src/form-builder/get-effective-form.ts`).

Only what's re-exported from `src/index.ts` is public. Don't import from `components/`, `fields/`,
or `hooks/` directly.

## Testing

```bash
pnpm --filter @tm/form-builder test
```

Pure-logic tests only (no DOM rendering — this repo has no React testing library installed; see
`specs/033-form-builder/tasks.md` T017 for why that's a deliberate gap, not an oversight).
