import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { SmtpMailSender } from "../../src/mail/smtp-mail-sender";

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("SmtpMailSender", () => {
  beforeEach(() => {
    setEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "test-user",
      SMTP_PASSWORD: "test-pass",
      SMTP_SECURE: undefined,
      MAIL_FROM_EMAIL: "no-reply@example.com",
      MAIL_FROM_NAME: undefined,
    });
    vi.mocked(nodemailer.createTransport).mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("isConfigured", () => {
    it("returns true when every SMTP_* var and MAIL_FROM_EMAIL are set", () => {
      expect(new SmtpMailSender().isConfigured()).toBe(true);
    });

    it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM_EMAIL"])(
      "returns false when %s is missing",
      (key) => {
        setEnv({ [key]: undefined });
        expect(new SmtpMailSender().isConfigured()).toBe(false);
      },
    );

    it("returns false when a required var is an empty string", () => {
      setEnv({ SMTP_HOST: "" });
      expect(new SmtpMailSender().isConfigured()).toBe(false);
    });
  });

  describe("send", () => {
    function mockTransport() {
      const sendMail = vi.fn().mockResolvedValue(undefined);
      vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
      return sendMail;
    }

    it("creates a transporter from SMTP_* and sends with the shared MAIL_FROM identity", async () => {
      const sendMail = mockTransport();

      await new SmtpMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "smtp.example.com",
          port: 587,
          secure: false,
          auth: { user: "test-user", pass: "test-pass" },
        }),
      );
      expect(sendMail).toHaveBeenCalledWith({
        from: { address: "no-reply@example.com", name: "TM" },
        to: "a@example.com",
        subject: "s",
        text: "t",
        html: "<p>t</p>",
      });
    });

    it("uses MAIL_FROM_NAME when set, instead of the default", async () => {
      setEnv({ MAIL_FROM_NAME: "Acme Support" });
      const sendMail = mockTransport();

      await new SmtpMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { address: "no-reply@example.com", name: "Acme Support" } }));
    });

    it("defaults secure to true only for port 465", async () => {
      setEnv({ SMTP_PORT: "465" });
      mockTransport();

      await new SmtpMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
    });

    it("respects an explicit SMTP_SECURE override", async () => {
      setEnv({ SMTP_PORT: "465", SMTP_SECURE: "false" });
      mockTransport();

      await new SmtpMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false }));
    });

    it("propagates a rejection from the transporter", async () => {
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error("connection refused")),
      } as never);

      await expect(
        new SmtpMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
      ).rejects.toThrow(/connection refused/);
    });
  });
});
