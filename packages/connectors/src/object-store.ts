/**
 * ObjectStore — the platform's door to S3-compatible object storage
 * (docker-compose MinIO in dev, a managed bucket in production;
 * docs/07-tech-stack.md). First consumer: tenant branding assets (M2 #91).
 *
 * Keys are namespaced by the caller (e.g. `tenants/<tenantId>/branding/…`)
 * and validated here so no key can traverse outside its namespace.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class ObjectStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

/** Conservative allowlist: segments of [a-z0-9._-], '/'-separated, no traversal. */
const KEY_PATTERN = /^(?:[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9][a-z0-9._-]*)*$/i;

export function assertValidObjectKey(key: string): void {
  if (key.length === 0 || key.length > 512 || !KEY_PATTERN.test(key) || key.includes("..")) {
    throw new ObjectStoreError("invalid object key");
  }
}

export interface S3ObjectStoreOptions {
  readonly endpoint?: string | undefined;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Path-style addressing — required by MinIO. */
  readonly forcePathStyle?: boolean | undefined;
}

export class S3ObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(options: S3ObjectStoreOptions) {
    this.#bucket = options.bucket;
    this.#client = new S3Client({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined
        ? { forcePathStyle: options.forcePathStyle }
        : {}),
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertValidObjectKey(key);
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidObjectKey(key);
    try {
      const result = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (result.Body === undefined) return null;
      const bytes = await result.Body.transformToByteArray();
      return { bytes, contentType: result.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if (isNoSuchKey(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidObjectKey(key);
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}

function isNoSuchKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: string }).name === "NoSuchKey" ||
      (error as { name: string }).name === "NotFound")
  );
}

/** Per-process store for tests and tooling — never a production binding. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertValidObjectKey(key);
    this.objects.set(key, { bytes, contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    assertValidObjectKey(key);
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  delete(key: string): Promise<void> {
    assertValidObjectKey(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/**
 * Build the store from the environment (.env.example S3_* block —
 * docker-compose MinIO locally). null when unconfigured: callers surface
 * a clear "object store unconfigured" failure ON USE, not at boot.
 */
export function s3ObjectStoreFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ObjectStore | null {
  const accessKeyId = env["S3_ACCESS_KEY_ID"];
  const secretAccessKey = env["S3_SECRET_ACCESS_KEY"];
  const bucket = env["S3_BUCKET"];
  if (
    accessKeyId === undefined ||
    accessKeyId === "" ||
    secretAccessKey === undefined ||
    secretAccessKey === "" ||
    bucket === undefined ||
    bucket === ""
  ) {
    return null;
  }
  return new S3ObjectStore({
    endpoint: env["S3_ENDPOINT"],
    region: env["S3_REGION"] ?? "me-south-1",
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle: env["S3_FORCE_PATH_STYLE"] === "true",
  });
}
