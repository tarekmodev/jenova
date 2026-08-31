import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretBox, SecretBoxError, UnconfiguredSecretBox } from "./secret-box";

describe("AesGcmSecretBox", () => {
  const key = randomBytes(32);
  const box = new AesGcmSecretBox("test-v1", key);

  it("round-trips utf8 plaintext (Arabic included)", () => {
    const plaintext = JSON.stringify({ username: "وكالة", password: "s3cr3t", apiUrl: "https://x" });
    const blob = box.seal(plaintext);
    expect(box.open(blob, "test-v1")).toBe(plaintext);
  });

  it("produces a fresh blob per seal (random IV)", () => {
    const a = box.seal("same");
    const b = box.seal("same");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("refuses a blob recorded under a different key id", () => {
    const blob = box.seal("secret");
    expect(() => box.open(blob, "other-key")).toThrow(SecretBoxError);
  });

  it("refuses a tampered blob", () => {
    const blob = Buffer.from(box.seal("secret"));
    const flipped = blob.at(-1);
    if (flipped === undefined) throw new Error("empty blob");
    blob[blob.length - 1] = flipped ^ 0xff;
    expect(() => box.open(blob, "test-v1")).toThrow(SecretBoxError);
  });

  it("refuses truncated blobs without throwing raw crypto errors", () => {
    expect(() => box.open(Buffer.from([1, 2, 3]), "test-v1")).toThrow(SecretBoxError);
  });

  it("binds the key id as AAD — same key under a different label fails", () => {
    const relabeled = new AesGcmSecretBox("test-v2", key);
    const blob = box.seal("secret");
    expect(() => relabeled.open(blob, "test-v2")).toThrow(SecretBoxError);
  });

  it("demands a 32-byte key", () => {
    expect(() => new AesGcmSecretBox("short", randomBytes(16))).toThrow(SecretBoxError);
  });
});

describe("UnconfiguredSecretBox", () => {
  it("fails loudly on both operations", () => {
    const box = new UnconfiguredSecretBox();
    expect(() => box.seal()).toThrow(SecretBoxError);
    expect(() => box.open()).toThrow(SecretBoxError);
  });
});
