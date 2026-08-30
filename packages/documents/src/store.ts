/**
 * Object-store seam for rendered documents (issue #99). The S3 API is the
 * contract (MinIO in dev via docker-compose, any S3-compatible store in
 * production); the port keeps rendering/tests independent of it.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface DocumentStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Null when no object exists under `key`. */
  get(key: string): Promise<Uint8Array | null>;
}

export interface S3DocumentStoreConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** MinIO needs path-style addressing (S3_FORCE_PATH_STYLE=true in dev). */
  readonly forcePathStyle: boolean;
}

export class S3DocumentStore implements DocumentStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3DocumentStoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (result.Body === undefined) {
        return null;
      }
      return await result.Body.transformToByteArray();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error.name === "NoSuchKey" || error.name === "NotFound")
      ) {
        return null;
      }
      throw error;
    }
  }
}

/** Test double: same observable contract, held in process memory. */
export class InMemoryDocumentStore implements DocumentStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key)?.bytes ?? null);
  }

  keys(): readonly string[] {
    return [...this.objects.keys()];
  }
}
