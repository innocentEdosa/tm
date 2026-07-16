import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("ZeptoMailSender (contracts/zeptomail-api.md, data-model.md)", () => {
  beforeEach(() => {
    setEnv({
      MAIL_API_TOKEN: "test-token",
      MAIL_FROM_EMAIL: "no-reply@example.com",
      MAIL_FROM_NAME: undefined,
      MAIL_API_URL: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("isConfigured", () => {
    it("returns true when both MAIL_API_TOKEN and MAIL_FROM_EMAIL are set", () => {
      expect(new ZeptoMailSender().isConfigured()).toBe(true);
    });

    it("returns false when MAIL_API_TOKEN is missing", () => {
      setEnv({ MAIL_API_TOKEN: undefined });
      expect(new ZeptoMailSender().isConfigured()).toBe(false);
    });

    it("returns false when MAIL_FROM_EMAIL is missing", () => {
      setEnv({ MAIL_FROM_EMAIL: undefined });
      expect(new ZeptoMailSender().isConfigured()).toBe(false);
    });

    it("returns false when a required var is set to an empty string", () => {
      setEnv({ MAIL_API_TOKEN: "" });
      expect(new ZeptoMailSender().isConfigured()).toBe(false);
    });
  });

  describe("send", () => {
    it("sends the exact request shape from contracts/zeptomail-api.md", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ code: "DELIVERY_SCHEDULED" }], message: "Success" }), {
          status: 201,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await new ZeptoMailSender().send({
        to: "jordan.lee@acme.example",
        subject: "Set up your TM account",
        text: "Welcome to TM.",
        html: "<p>Welcome to TM.</p>",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.zeptomail.com/v1.1/email");
      expect(init.method).toBe("POST");
      expect(init.headers["Authorization"]).toBe("zoho-enczapikey test-token");
      expect(init.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body);
      expect(body).toEqual({
        from: { address: "no-reply@example.com", name: "TM" },
        to: [
          {
            email_address: {
              address: "jordan.lee@acme.example",
              name: "jordan.lee@acme.example",
            },
          },
        ],
        subject: "Set up your TM account",
        textbody: "Welcome to TM.",
        htmlbody: "<p>Welcome to TM.</p>",
      });
    });

    it("uses MAIL_FROM_NAME when set, instead of the default", async () => {
      setEnv({ MAIL_FROM_NAME: "Acme Support" });
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await new ZeptoMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).from.name).toBe("Acme Support");
    });

    it("respects a custom MAIL_API_URL override", async () => {
      setEnv({ MAIL_API_URL: "https://api.zeptomail.eu/v1.1/email" });
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await new ZeptoMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      expect(fetchMock.mock.calls[0][0]).toBe("https://api.zeptomail.eu/v1.1/email");
    });

    it("throws with the provider's error message on a non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "INVALID_TOKEN", message: "Invalid API token" } }),
            { status: 401 },
          ),
        ),
      );

      await expect(
        new ZeptoMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
      ).rejects.toThrow(/Invalid API token/);
    });

    it("throws when fetch itself rejects (network failure)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

      await expect(
        new ZeptoMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
      ).rejects.toThrow(/network unreachable/);
    });

    it("passes an AbortSignal so a hung request can be cancelled (research.md §4)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await new ZeptoMailSender().send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });

      expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
  });
});
