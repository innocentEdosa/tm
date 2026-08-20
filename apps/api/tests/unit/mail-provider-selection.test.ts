import { afterEach, describe, expect, it } from "vitest";
import { createDefaultSender } from "../../src/mail/send-mail";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { SmtpMailSender } from "../../src/mail/smtp-mail-sender";

const ORIGINAL_MAIL_PROVIDER = process.env.MAIL_PROVIDER;

describe("send-mail.ts — MAIL_PROVIDER selects the active MailSender", () => {
  afterEach(() => {
    if (ORIGINAL_MAIL_PROVIDER === undefined) delete process.env.MAIL_PROVIDER;
    else process.env.MAIL_PROVIDER = ORIGINAL_MAIL_PROVIDER;
  });

  it("defaults to ZeptoMailSender when MAIL_PROVIDER is unset", () => {
    delete process.env.MAIL_PROVIDER;
    expect(createDefaultSender()).toBeInstanceOf(ZeptoMailSender);
  });

  it("selects ZeptoMailSender for MAIL_PROVIDER=api", () => {
    process.env.MAIL_PROVIDER = "api";
    expect(createDefaultSender()).toBeInstanceOf(ZeptoMailSender);
  });

  it("selects SmtpMailSender for MAIL_PROVIDER=smtp", () => {
    process.env.MAIL_PROVIDER = "smtp";
    expect(createDefaultSender()).toBeInstanceOf(SmtpMailSender);
  });

  it("is case-insensitive and trims whitespace", () => {
    process.env.MAIL_PROVIDER = "  SMTP  ";
    expect(createDefaultSender()).toBeInstanceOf(SmtpMailSender);
  });

  it("falls back to ZeptoMailSender for an unrecognized value", () => {
    process.env.MAIL_PROVIDER = "carrier-pigeon";
    expect(createDefaultSender()).toBeInstanceOf(ZeptoMailSender);
  });
});
