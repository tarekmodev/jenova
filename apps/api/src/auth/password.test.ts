import { describe, expect, it } from "vitest";
import { ARGON2ID_OPTIONS, hashPassword, passwordNeedsRehash, verifyPassword } from "./password";

describe("password hashing (argon2id)", () => {
  it("emits a PHC string carrying the documented parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    // argon2id, v19, m=19456 KiB, t=2, p=1 — parameters live IN the hash.
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(ARGON2ID_OPTIONS).toMatchObject({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  });

  it("verifies the right password and refuses the wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery stapl")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts: hashing the same password twice yields different strings", async () => {
    const password = "same password";
    expect(await hashPassword(password)).not.toBe(await hashPassword(password));
  });

  it("never echoes the password into the hash", async () => {
    const hash = await hashPassword("s3cret-value");
    expect(hash).not.toContain("s3cret-value");
  });

  it("treats malformed or foreign hashes as 'wrong password', never a throw", async () => {
    expect(await verifyPassword("", "anything")).toBe(false);
    expect(await verifyPassword("not-a-phc-string", "anything")).toBe(false);
    expect(await verifyPassword("$2b$10$bcrypt-shaped-garbage", "anything")).toBe(false);
  });

  it("flags hashes made with weaker parameters for rehash-on-login", async () => {
    const current = await hashPassword("pw");
    expect(passwordNeedsRehash(current)).toBe(false);
    // A hash recorded with lower memory cost must be flagged.
    const weaker = current.replace("m=19456", "m=8192");
    expect(passwordNeedsRehash(weaker)).toBe(true);
  });
});
