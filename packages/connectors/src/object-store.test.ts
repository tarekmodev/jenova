import { describe, expect, it } from "vitest";
import {
  assertValidObjectKey,
  InMemoryObjectStore,
  ObjectStoreError,
  s3ObjectStoreFromEnv,
} from "./object-store";

describe("assertValidObjectKey", () => {
  it("accepts namespaced keys", () => {
    expect(() => assertValidObjectKey("tenants/t-1/branding/logo.png")).not.toThrow();
  });

  it("refuses traversal, absolute and empty keys", () => {
    for (const key of ["", "/abs", "a//b", "../up", "tenants/../other", "a/.hidden"]) {
      expect(() => assertValidObjectKey(key), key).toThrow(ObjectStoreError);
    }
  });
});

describe("InMemoryObjectStore", () => {
  it("round-trips bytes + content type and deletes", async () => {
    const store = new InMemoryObjectStore();
    await store.put("tenants/t-1/branding/logo.png", Buffer.from([1, 2, 3]), "image/png");
    const stored = await store.get("tenants/t-1/branding/logo.png");
    expect(stored?.contentType).toBe("image/png");
    expect([...(stored?.bytes ?? [])]).toEqual([1, 2, 3]);
    await store.delete("tenants/t-1/branding/logo.png");
    expect(await store.get("tenants/t-1/branding/logo.png")).toBeNull();
  });
});

describe("s3ObjectStoreFromEnv", () => {
  it("is null until the S3_* block is configured", () => {
    expect(s3ObjectStoreFromEnv({})).toBeNull();
    expect(s3ObjectStoreFromEnv({ S3_ACCESS_KEY_ID: "x" })).toBeNull();
  });

  it("builds a store from the .env.example variable block", () => {
    expect(
      s3ObjectStoreFromEnv({
        S3_ENDPOINT: "http://localhost:9000",
        S3_REGION: "me-south-1",
        S3_ACCESS_KEY_ID: "jenova",
        S3_SECRET_ACCESS_KEY: "jenova-minio",
        S3_BUCKET: "jenova-dev",
        S3_FORCE_PATH_STYLE: "true",
      }),
    ).not.toBeNull();
  });
});
