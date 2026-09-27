import { describe, expect, it } from "vitest";
import {
  isCredentialField,
  isPublicKey,
  redactApiPayload,
  withheld,
} from "../src/redact.js";

describe("isPublicKey", () => {
  it("classifies by type when present", () => {
    expect(isPublicKey({ name: "default", type: "publishable" })).toBe(true);
    expect(isPublicKey({ name: "anon", type: "legacy" })).toBe(true);
    expect(isPublicKey({ name: "service_role", type: "legacy" })).toBe(false);
    expect(isPublicKey({ name: "default", type: "secret" })).toBe(false);
    expect(isPublicKey({ name: "weird", type: "quantum_v3" })).toBe(false);
  });

  it("falls back to the name allow-list only when type is absent", () => {
    expect(isPublicKey({ name: "publishable" })).toBe(true);
    expect(isPublicKey({ name: "anon" })).toBe(true);
    expect(isPublicKey({ name: "service_role" })).toBe(false);
  });

  it("treats a non-string type or name as unrecognised", () => {
    // A falsy non-string type falls through to the name list...
    expect(isPublicKey({ name: "anon", type: 42 as never })).toBe(true);
    // ...and a non-string name is never public.
    expect(isPublicKey({ name: 7 as never })).toBe(false);
  });
});

describe("withheld", () => {
  it("keeps a short identity suffix", () => {
    expect(withheld("FIXTURE-SECRET-VALUE")).toBe("hidden (…ALUE)");
  });

  it("shows no suffix for short or non-string values", () => {
    expect(withheld("abcd")).toBe("hidden");
    expect(withheld("a")).toBe("hidden");
    expect(withheld(undefined)).toBe("hidden");
    expect(withheld(12345)).toBe("hidden");
  });
});

describe("isCredentialField", () => {
  it("matches credential words in snake/kebab/camel/upper forms", () => {
    expect(isCredentialField("db_password")).toBe(true);
    expect(isCredentialField("serviceRoleKey")).toBe(true);
    expect(isCredentialField("api-key")).toBe(true);
    expect(isCredentialField("apikey")).toBe(true);
    expect(isCredentialField("SMTP_PASS")).toBe(true);
    expect(isCredentialField("external_google_secret")).toBe(true);
    expect(isCredentialField("sms_twilio_auth_token")).toBe(true);
    expect(isCredentialField("credentials")).toBe(true);
    expect(isCredentialField("jwt")).toBe(true);
    expect(isCredentialField("dsn")).toBe(true);
    expect(isCredentialField("db_pwd")).toBe(true);
  });

  it("matches connection-string spellings compactly", () => {
    expect(isCredentialField("connection_string")).toBe(true);
    expect(isCredentialField("connectionString")).toBe(true);
    expect(isCredentialField("connstr")).toBe(true);
    expect(isCredentialField("CONN_STR")).toBe(true);
  });

  it("leaves benign field names alone", () => {
    expect(isCredentialField("name")).toBe(false);
    expect(isCredentialField("keyword")).toBe(false);
    expect(isCredentialField("")).toBe(false);
    expect(isCredentialField("__")).toBe(false);
  });
});

describe("redactApiPayload", () => {
  it("returns primitives untouched and counts nothing", () => {
    expect(redactApiPayload("v1/health", null)).toEqual({
      payload: null,
      secrets: 0,
    });
    expect(redactApiPayload("v1/health", "ok")).toEqual({
      payload: "ok",
      secrets: 0,
    });
    expect(redactApiPayload("v1/health", 42)).toEqual({
      payload: 42,
      secrets: 0,
    });
    expect(redactApiPayload("v1/health", [null, "x"])).toEqual({
      payload: [null, "x"],
      secrets: 0,
    });
  });

  it("masks secret keys and keeps public ones on the /api-keys shape", () => {
    const { payload, secrets } = redactApiPayload("v1/projects/p1/api-keys", [
      { name: "anon", type: "legacy", api_key: "public-value" },
      { name: "service_role", type: "legacy", api_key: "FIXTURE-ROLE" },
      { name: "default", type: "secret", api_key: "FIXTURE-MODERN" },
    ]);
    expect(payload).toEqual([
      { name: "anon", type: "legacy", api_key: "public-value" },
      { name: "service_role", type: "legacy", api_key: "hidden (…ROLE)" },
      { name: "default", type: "secret", api_key: "hidden (…DERN)" },
    ]);
    expect(secrets).toBe(2);
  });

  it("recognises a bare api-keys segment and one with slashes/query/case", () => {
    const item = [
      { name: "service_role", type: "legacy", api_key: "FIXTURE-ROLE" },
    ];
    expect(redactApiPayload("api-keys", item).secrets).toBe(1);
    expect(
      redactApiPayload("/V1/PROJECTS/p1/API-KEYS/?x=1", item).secrets,
    ).toBe(1);
  });

  it("recurses into non-string values where classification is impossible", () => {
    const { payload, secrets } = redactApiPayload("v1/projects/p1/api-keys", [
      { name: "service_role", api_key: { note: "not a string" } },
    ]);
    expect(payload).toEqual([
      { name: "service_role", api_key: { note: "not a string" } },
    ]);
    expect(secrets).toBe(0);
  });

  it("leaves public api_key values and benign fields alone", () => {
    const { payload, secrets } = redactApiPayload("v1/projects/p1/api-keys", [
      { name: "anon", type: "legacy", api_key: "keep-me", note: "also keep" },
    ]);
    expect(payload).toEqual([
      { name: "anon", type: "legacy", api_key: "keep-me", note: "also keep" },
    ]);
    expect(secrets).toBe(0);
  });

  it("masks every /secrets value string", () => {
    const { payload, secrets } = redactApiPayload("v1/projects/p1/secrets", [
      { name: "STRIPE_KEY", value: "FIXTURE-STRIPE" },
      { name: "SHORT", value: "abc" },
    ]);
    expect(payload).toEqual([
      { name: "STRIPE_KEY", value: "hidden (…RIPE)" },
      { name: "SHORT", value: "hidden" },
    ]);
    expect(secrets).toBe(2);
  });

  it("masks a non-string /secrets value subtree entirely", () => {
    const { payload, secrets } = redactApiPayload("secrets", [
      { name: "META", value: { note: "FIXTURE-NESTED" } },
    ]);
    expect(payload).toEqual([
      { name: "META", value: { note: "hidden (…STED)" } },
    ]);
    expect(secrets).toBe(1);
  });

  it("fails closed on unknown endpoints: credential-shaped names mask anywhere", () => {
    const { payload, secrets } = redactApiPayload(
      "v1/projects/p1/config/database/postgres",
      {
        ref: "p1",
        connection_string: "postgresql://user:FIXTURE-DB-PASSWORD@db.p1",
        settings: {
          serviceToken: "FIXTURE-TOKEN",
          items: [
            { db_password: "FIXTURE-NESTED", note: "keep me" },
            { public_key: "public" },
          ],
        },
        benign: "visible",
      },
    );
    expect(payload).toEqual({
      ref: "p1",
      connection_string: "hidden (…b.p1)",
      settings: {
        serviceToken: "hidden (…OKEN)",
        items: [
          { db_password: "hidden (…STED)", note: "keep me" },
          { public_key: "hidden (…blic)" },
        ],
      },
      benign: "visible",
    });
    expect(secrets).toBe(4);
  });

  it("masks a bare api_key field on an endpoint with no dedicated shape", () => {
    const { payload, secrets } = redactApiPayload("v1/organizations/o1", {
      api_key: "FIXTURE-ANY",
    });
    expect(payload).toEqual({ api_key: "hidden (…-ANY)" });
    expect(secrets).toBe(1);
  });

  it("masks bare strings inside a credential-named container", () => {
    const { payload, secrets } = redactApiPayload("v1/unknown", {
      tokens: ["FIXTURE-ONE", "FIXTURE-TWO"],
      nested: { keys: { pair: "FIXTURE-NESTED" } },
    });
    expect(payload).toEqual({
      tokens: ["hidden (…-ONE)", "hidden (…-TWO)"],
      nested: { keys: { pair: "hidden (…STED)" } },
    });
    expect(secrets).toBe(3);
  });

  it("does not mutate the payload it was given", () => {
    const original = { secret: "FIXTURE-ORIGINAL" };
    redactApiPayload("v1/anything", original);
    expect(original).toEqual({ secret: "FIXTURE-ORIGINAL" });
  });
});
