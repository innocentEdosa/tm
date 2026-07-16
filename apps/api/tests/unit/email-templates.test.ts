import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  buildTenantCreationEmail,
  buildMemberInviteEmail,
  buildPasswordResetEmail,
} from "../../src/mail/email-templates";

/**
 * Foundational coverage (research.md §2–§4, data-model.md, contracts/email-template-builders.md).
 * Story-specific builder coverage (buildTenantCreationEmail/buildMemberInviteEmail/
 * buildPasswordResetEmail) lives in this same file, added alongside each builder's implementation.
 */
describe("escapeHtml", () => {
  it("escapes the five characters that can break HTML markup or attributes", () => {
    expect(escapeHtml(`<b>&"'</b>`)).toBe("&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");
  });

  it("leaves plain text without special characters unchanged", () => {
    expect(escapeHtml("Acme Corp")).toBe("Acme Corp");
  });

  it("neutralizes an injected tag so it cannot render as live markup (spec FR-007)", () => {
    const malicious = "<script>alert(1)</script>";
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
  });
});

describe("buildTenantCreationEmail (spec User Story 1, FR-001, FR-006)", () => {
  const input = {
    loginEmail: "admin@acme.example",
    tenantName: "Acme Corp",
    oneTimePassword: "ABC123",
    otpValidityHours: 72,
  };

  it("reads as a new-account welcome, not an invite", () => {
    const result = buildTenantCreationEmail(input);
    expect(result.subject.toLowerCase()).toContain("welcome");
    expect(result.text.toLowerCase()).toContain("welcome");
  });

  it("states the login email, tenant name, OTP, and expiry as distinct labeled facts in both text and html", () => {
    const result = buildTenantCreationEmail(input);
    for (const target of [result.text, result.html]) {
      expect(target).toContain("admin@acme.example");
      expect(target).toContain("Acme Corp");
      expect(target).toContain("ABC123");
      expect(target).toContain("72");
    }
    expect(result.text).toMatch(/Login email:\s*admin@acme\.example/);
  });

  it("escapes a tenant name containing markup instead of rendering it live (spec FR-007)", () => {
    const result = buildTenantCreationEmail({ ...input, tenantName: "<b>Injected</b> Co" });
    expect(result.html).not.toContain("<b>Injected</b>");
    expect(result.html).toContain("&lt;b&gt;Injected&lt;/b&gt;");
    expect(result.text).toContain("<b>Injected</b> Co");
  });
});

describe("buildMemberInviteEmail (spec User Story 2, FR-002, FR-003)", () => {
  const input = {
    loginEmail: "newuser@acme.example",
    tenantName: "Acme Corp",
    oneTimePassword: "XYZ789",
    otpValidityHours: 72,
  };

  it("states the login email, tenant name, OTP, and expiry as distinct labeled facts", () => {
    const result = buildMemberInviteEmail(input);
    for (const target of [result.text, result.html]) {
      expect(target).toContain("newuser@acme.example");
      expect(target).toContain("Acme Corp");
      expect(target).toContain("XYZ789");
      expect(target).toContain("72");
    }
  });

  it("reads distinctly from the tenant-creation email for equivalent inputs (spec FR-003, SC-005)", () => {
    const creation = buildTenantCreationEmail(input);
    const invite = buildMemberInviteEmail(input);
    expect(invite.subject).not.toBe(creation.subject);
    expect(invite.text).not.toBe(creation.text);
    expect(invite.text.toLowerCase()).toMatch(/invite|join/);
  });

  it("escapes an injected tenant name (spec FR-007)", () => {
    const result = buildMemberInviteEmail({ ...input, tenantName: "<img src=x onerror=alert(1)>" });
    expect(result.html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("buildPasswordResetEmail (spec User Story 3, FR-004)", () => {
  const input = { resetLink: "https://acme.tm.com/reset-password?token=abc123", linkValidityHours: 1 };

  it("renders the reset link as a highlighted action in html and a plain URL in text", () => {
    const result = buildPasswordResetEmail(input);
    expect(result.html).toContain(input.resetLink);
    expect(result.html).toMatch(/<a href="[^"]*reset-password[^"]*"/);
    expect(result.text).toContain(input.resetLink);
  });

  it("states the expiry, single-use, and ignore-if-not-you language", () => {
    const result = buildPasswordResetEmail(input);
    for (const target of [result.text, result.html]) {
      expect(target).toContain("1 hour");
      expect(target.toLowerCase()).toContain("single");
      expect(target.toLowerCase()).toMatch(/ignore|didn't request|did not request/);
    }
  });

  it("pluralizes the expiry word for a validity period other than one hour", () => {
    const result = buildPasswordResetEmail({ ...input, linkValidityHours: 24 });
    expect(result.text).toContain("24 hours");
  });
});
