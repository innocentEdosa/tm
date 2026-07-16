import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailMessage, MailSender } from "../../src/mail/mail-sender";
import {
  sendTenantCreationEmail,
  sendMemberInviteEmail,
  sendPasswordResetEmail,
  __setMailSenderForTesting,
} from "../../src/tenant-auth/mailer";

/**
 * Proves the guarantees in research.md §3 hold for the wrapper itself, independent of ZeptoMail —
 * a hand-written fake `MailSender`, not the real adapter, is installed via the test seam
 * (`__setMailSenderForTesting`, mirroring `server.ts`'s `registerAuthStub` precedent).
 */
function fakeSender(overrides: Partial<MailSender> = {}): MailSender {
  return {
    isConfigured: () => true,
    send: async () => {},
    ...overrides,
  };
}

describe("mailer.ts wrapper guarantees (research.md §3, §4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips send() entirely and warns, without throwing, when isConfigured() is false", async () => {
    const send = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    __setMailSenderForTesting(fakeSender({ isConfigured: () => false, send }));

    await expect(
      sendTenantCreationEmail("user@example.com", "123456", "Acme Co"),
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("user@example.com");
  });

  it("resolves without throwing, and logs, when send() rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    __setMailSenderForTesting(
      fakeSender({ send: async () => { throw new Error("boom"); } }),
    );

    await expect(sendPasswordResetEmail("user@example.com", "https://x/reset?token=abc")).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves within the timeout budget, without throwing, when send() never resolves", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    __setMailSenderForTesting(
      fakeSender({ send: () => new Promise<void>(() => {}) }),
    );

    const start = Date.now();
    await expect(
      sendTenantCreationEmail("user@example.com", "123456", "Acme Co"),
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  }, 10000);

  it("calls send() with the expected MailMessage shape (including html) for sendTenantCreationEmail", async () => {
    let received: MailMessage | undefined;
    __setMailSenderForTesting(
      fakeSender({
        send: async (message) => {
          received = message;
        },
      }),
    );

    await sendTenantCreationEmail("user@example.com", "654321", "Acme Co");

    expect(received?.to).toBe("user@example.com");
    expect(received?.subject).toBeTruthy();
    expect(received?.text).toContain("654321");
    expect(received?.html).toBeTruthy();
    expect(received?.html).toContain("654321");
  });
});

describe("sendMemberInviteEmail (spec 019 User Story 2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips send() entirely and warns, without throwing, when isConfigured() is false", async () => {
    const send = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    __setMailSenderForTesting(fakeSender({ isConfigured: () => false, send }));

    await expect(
      sendMemberInviteEmail("newuser@example.com", "111222", "Acme Co"),
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves without throwing, and logs, when send() rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    __setMailSenderForTesting(fakeSender({ send: async () => { throw new Error("boom"); } }));

    await expect(
      sendMemberInviteEmail("newuser@example.com", "111222", "Acme Co"),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("calls send() with the expected MailMessage shape (including html)", async () => {
    let received: MailMessage | undefined;
    __setMailSenderForTesting(
      fakeSender({
        send: async (message) => {
          received = message;
        },
      }),
    );

    await sendMemberInviteEmail("newuser@example.com", "111222", "Acme Co");

    expect(received?.to).toBe("newuser@example.com");
    expect(received?.text).toContain("111222");
    expect(received?.html).toContain("111222");
    expect(received?.text).toContain("Acme Co");
  });
});

describe("sendPasswordResetEmail content (spec 019 User Story 3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls send() with the expected MailMessage shape (including html)", async () => {
    let received: MailMessage | undefined;
    __setMailSenderForTesting(
      fakeSender({
        send: async (message) => {
          received = message;
        },
      }),
    );

    await sendPasswordResetEmail("user@example.com", "https://acme.tm.com/reset?token=xyz");

    expect(received?.to).toBe("user@example.com");
    expect(received?.text).toContain("https://acme.tm.com/reset?token=xyz");
    expect(received?.html).toContain("https://acme.tm.com/reset?token=xyz");
  });
});
