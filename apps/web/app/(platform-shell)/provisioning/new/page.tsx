"use client";

// Restyled to the locked design system (Role-Based Dashboard Shell spec's design-system/tm/MASTER.md)
// as part of the Super Admin Platform Dashboard Shell spec — presentation only, all state,
// validation, and submission logic is unchanged from before this feature (research.md §6, FR-003).
// Guarded by the shell's layout (`(platform-shell)/layout.tsx`), which already confirms a valid
// Super Admin session before this renders — the submit fetch still uses `credentials: "include"`
// since this is a Client Component making its own browser-side request.
import { useState } from "react";
import { Button, Badge } from "@tm/ui";
import type { ApiResponse } from "@tm/types";

const API_BASE = "/platform-api";

const DEFAULT_DEPARTMENTS = [
  "Human Resources",
  "Sales",
  "Engineering",
  "Finance",
  "Operations",
  "Customer Support",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CompanyDetails {
  name: string;
  subdomain: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

interface AdminDetails {
  fullName: string;
  email: string;
}

interface ProvisionedTenant {
  tenant: { id: string; name: string; subdomain: string; status: string };
  departments: { id: string; name: string }[];
  admin: { id: string; fullName: string; email: string; roleAssigned: string };
}

type SubmitState =
  | { status: "idle" | "loading" }
  | { status: "success"; data: ProvisionedTenant }
  | { status: "error"; message: string };

const STEP_LABELS = ["Company Details", "Departments", "Admin Account"];

export default function ProvisionTenantPage() {
  const [step, setStep] = useState(1);
  const [company, setCompany] = useState<CompanyDetails>({
    name: "",
    subdomain: "",
    industry: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
  });
  const [departments, setDepartments] = useState<string[]>(DEFAULT_DEPARTMENTS);
  const [departmentsTouched, setDepartmentsTouched] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [admin, setAdmin] = useState<AdminDetails>({ fullName: "", email: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  function markTouched(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function companyErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!company.name.trim()) errors.name = "Company name is required.";
    if (!company.subdomain.trim()) errors.subdomain = "Subdomain is required.";
    else if (!/^[a-z0-9-]+$/.test(company.subdomain.trim()))
      errors.subdomain = "Subdomain may only contain lowercase letters, numbers, and hyphens.";
    if (!company.contactName.trim()) errors.contactName = "Primary contact name is required.";
    if (!company.contactEmail.trim()) errors.contactEmail = "Primary contact email is required.";
    else if (!EMAIL_PATTERN.test(company.contactEmail.trim()))
      errors.contactEmail = "Enter a valid email address.";
    return errors;
  }

  function departmentErrors(): string | undefined {
    const trimmed = departments.map((d) => d.trim());
    if (trimmed.some((d) => d.length === 0)) return "Department names cannot be empty.";
    const lower = trimmed.map((d) => d.toLowerCase());
    if (new Set(lower).size !== lower.length) return "Department names must be unique.";
    return undefined;
  }

  function adminErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!admin.fullName.trim()) errors.fullName = "Admin full name is required.";
    if (!admin.email.trim()) errors.email = "Admin email is required.";
    else if (!EMAIL_PATTERN.test(admin.email.trim())) errors.email = "Enter a valid email address.";
    return errors;
  }

  function updateDepartment(index: number, name: string) {
    setDepartmentsTouched(true);
    setDepartments((prev) => prev.map((d, i) => (i === index ? name : d)));
  }

  function removeDepartment(index: number) {
    setDepartmentsTouched(true);
    setDepartments((prev) => prev.filter((_, i) => i !== index));
  }

  function addDepartment() {
    const name = newDepartmentName.trim();
    if (!name) return;
    setDepartmentsTouched(true);
    setDepartments((prev) => [...prev, name]);
    setNewDepartmentName("");
  }

  function goNext() {
    if (step === 1) {
      const errors = companyErrors();
      setTouched((prev) => ({
        ...prev,
        name: true,
        subdomain: true,
        contactName: true,
        contactEmail: true,
      }));
      if (Object.keys(errors).length > 0) return;
    }
    if (step === 2) {
      const error = departmentErrors();
      if (error) return;
    }
    setStep((s) => Math.min(s + 1, 3));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleSubmit() {
    const errors = adminErrors();
    setTouched((prev) => ({ ...prev, fullName: true, email: true }));
    if (Object.keys(errors).length > 0) return;
    const deptError = departmentErrors();
    if (deptError) return;

    setSubmit({ status: "loading" });

    const payload = {
      company: {
        name: company.name.trim(),
        subdomain: company.subdomain.trim(),
        ...(company.industry.trim() ? { industry: company.industry.trim() } : {}),
        primaryContact: {
          name: company.contactName.trim(),
          email: company.contactEmail.trim(),
          ...(company.contactPhone.trim() ? { phone: company.contactPhone.trim() } : {}),
        },
      },
      ...(departmentsTouched
        ? { departments: departments.map((name) => ({ name: name.trim() })) }
        : {}),
      admin: { fullName: admin.fullName.trim(), email: admin.email.trim() },
    };

    try {
      const res = await fetch(`${API_BASE}/provisioning/tenants`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<ProvisionedTenant>;

      if (res.status === 201 && json.success) {
        setSubmit({ status: "success", data: json.data });
        return;
      }
      if (res.status === 401) {
        setSubmit({
          status: "error",
          message: "You need to be logged in as a platform Super Admin to do this.",
        });
        return;
      }
      setSubmit({ status: "error", message: json.message ?? "Provisioning failed. Try again." });
    } catch {
      setSubmit({ status: "error", message: "Couldn't reach the provisioning service. Try again." });
    }
  }

  if (submit.status === "success") {
    return <SuccessSummary data={submit.data} />;
  }

  const cErrors = companyErrors();
  const dError = departmentErrors();
  const aErrors = adminErrors();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight text-primary">Provision a New Tenant</h1>
      <p className="mt-2 text-sm text-slate-600">
        Onboard a new company onto TM — sales-assisted setup for internal Super Admins only.
      </p>

      <ol className="mt-8 flex items-center gap-2" aria-label="Provisioning steps">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const isActive = n === step;
          const isDone = n < step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                  isActive
                    ? "bg-cta text-white"
                    : isDone
                      ? "bg-cta/10 text-cta"
                      : "bg-slate-100 text-slate-500"
                }`}
                aria-current={isActive ? "step" : undefined}
              >
                {n}
              </div>
              <span
                className={`text-sm font-medium ${isActive ? "text-primary" : "text-slate-500"}`}
              >
                {label}
              </span>
              {n < STEP_LABELS.length && <div className="h-px flex-1 bg-border" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-slate-500">
        Step {step} of {STEP_LABELS.length}
      </p>

      {submit.status === "error" && (
        <div role="alert" className="banner-error mt-6">
          {submit.message}
        </div>
      )}

      {step === 1 && (
        <section className="mt-8 space-y-5">
          <Field
            id="company-name"
            label="Company name"
            value={company.name}
            onChange={(v) => setCompany((c) => ({ ...c, name: v }))}
            onBlur={() => markTouched("name")}
            error={touched.name ? cErrors.name : undefined}
            required
          />
          <Field
            id="company-subdomain"
            label="Subdomain"
            value={company.subdomain}
            onChange={(v) => setCompany((c) => ({ ...c, subdomain: v }))}
            onBlur={() => markTouched("subdomain")}
            error={touched.subdomain ? cErrors.subdomain : undefined}
            hint="Lowercase letters, numbers, and hyphens only — e.g. acme"
            required
          />
          <Field
            id="company-industry"
            label="Industry"
            value={company.industry}
            onChange={(v) => setCompany((c) => ({ ...c, industry: v }))}
          />
          <div className="border-t border-border pt-5">
            <h2 className="text-sm font-semibold text-primary">Primary contact</h2>
            <div className="mt-4 space-y-5">
              <Field
                id="contact-name"
                label="Contact name"
                value={company.contactName}
                onChange={(v) => setCompany((c) => ({ ...c, contactName: v }))}
                onBlur={() => markTouched("contactName")}
                error={touched.contactName ? cErrors.contactName : undefined}
                required
              />
              <Field
                id="contact-email"
                label="Contact email"
                type="email"
                value={company.contactEmail}
                onChange={(v) => setCompany((c) => ({ ...c, contactEmail: v }))}
                onBlur={() => markTouched("contactEmail")}
                error={touched.contactEmail ? cErrors.contactEmail : undefined}
                required
              />
              <Field
                id="contact-phone"
                label="Contact phone"
                type="tel"
                value={company.contactPhone}
                onChange={(v) => setCompany((c) => ({ ...c, contactPhone: v }))}
              />
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-8">
          <p className="text-sm text-slate-600">
            Default departments are pre-filled below. Rename, remove, or add to them — changes apply
            once you submit at the end.
          </p>
          <ul className="mt-4 space-y-2">
            {departments.map((name, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  id={`department-${i}`}
                  aria-label={`Department ${i + 1} name`}
                  type="text"
                  value={name}
                  onChange={(e) => updateDepartment(i, e.target.value)}
                  className="field-input h-10 flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeDepartment(i)}
                  className="btn btn-outline btn-sm cursor-pointer"
                  aria-label={`Remove ${name || "department"}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {departments.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">
              No departments will be created. You can add departments later.
            </p>
          )}
          {dError && (
            <p className="field-error mt-3" role="alert">
              {dError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              aria-label="New department name"
              placeholder="Add a department"
              value={newDepartmentName}
              onChange={(e) => setNewDepartmentName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDepartment();
                }
              }}
              className="field-input h-10 flex-1"
            />
            <button type="button" onClick={addDepartment} className="btn btn-secondary btn-sm cursor-pointer">
              Add
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-8 space-y-8">
          <div className="space-y-5">
            <Field
              id="admin-full-name"
              label="Admin full name"
              value={admin.fullName}
              onChange={(v) => setAdmin((a) => ({ ...a, fullName: v }))}
              onBlur={() => markTouched("fullName")}
              error={touched.fullName ? aErrors.fullName : undefined}
              required
            />
            <Field
              id="admin-email"
              label="Admin email"
              type="email"
              value={admin.email}
              onChange={(v) => setAdmin((a) => ({ ...a, email: v }))}
              onBlur={() => markTouched("email")}
              error={touched.email ? aErrors.email : undefined}
              hint="This person will be created as HR/L&D Admin for the new tenant."
              required
            />
          </div>

          <div className="rounded-lg border border-border bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-primary">Review</h2>
            <dl className="mt-3 space-y-1 text-sm">
              <ReviewRow label="Company" value={company.name || "—"} />
              <ReviewRow label="Subdomain" value={company.subdomain || "—"} />
              <ReviewRow label="Primary contact" value={company.contactEmail || "—"} />
              <ReviewRow
                label="Departments"
                value={departments.length > 0 ? departments.join(", ") : "None"}
              />
            </dl>
          </div>
        </section>
      )}

      <div className="mt-10 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={goBack}
          disabled={step === 1 || submit.status === "loading"}
        >
          Back
        </Button>
        {step < 3 ? (
          <Button type="button" onClick={goNext}>
            Next
          </Button>
        ) : (
          <Button type="button" onClick={handleSubmit} isLoading={submit.status === "loading"}>
            Provision Tenant
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  type = "text",
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="field-input"
      />
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}

function SuccessSummary({ data }: { data: ProvisionedTenant }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="banner-success">Tenant provisioned successfully.</div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-primary">{data.tenant.name}</h1>
      <dl className="mt-4 space-y-1 text-sm">
        <ReviewRow label="Tenant ID" value={data.tenant.id} />
        <ReviewRow label="Subdomain" value={data.tenant.subdomain} />
        <ReviewRow label="Status" value={data.tenant.status} />
        <ReviewRow label="Admin" value={`${data.admin.fullName} (${data.admin.email})`} />
        <ReviewRow label="Admin role" value={data.admin.roleAssigned} />
      </dl>

      <h2 className="mt-8 text-xl font-semibold text-primary">Departments</h2>
      {data.departments.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.departments.map((d) => (
            <Badge key={d.id} variant="accent">
              {d.name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">No departments were created.</p>
      )}
    </div>
  );
}
