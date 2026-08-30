/**
 * SecretBox — at-rest encryption for tenant secret blobs (supplier account
 * credentials, staff TOTP secrets). MONEY-PATH ADJACENT: human review
 * required (CLAUDE.md working agreements).
 *
 * Deliberately boring crypto: AES-256-GCM straight from node:crypto — no
 * new primitives, no hand-rolled constructions (same policy as the M0 auth
 * primitives). Blob layout is `iv(12) || ciphertext || tag(16)`; the key id
 * is bound as additional authenticated data, so a blob can never silently
 * decrypt under a different key label than the one recorded next to it
 * (`secrets_key_id` columns).
 *
 * Key management today is one process-wide key from the environment
 * (JENOVA_DATA_KEY, 32 bytes base64) labeled JENOVA_DATA_KEY_ID. The
 * per-tenant KMS-wrapped data keys of docs/08 slot in behind this same
 * interface: `open` dispatches on the stored key id, `seal` uses the
 * current one — callers never change.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ApiConfig } from "../config/config";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Nest injection token for the process-wide {@link SecretBox}. */
export const SECRET_BOX = Symbol("jenova.api.secretBox");

export class SecretBoxError extends Error {
  constructor(message: string) {
    // Never echoes blob contents or key material.
    super(message);
    this.name = "SecretBoxError";
  }
}

export interface SecretBox {
  /** Key id written alongside every blob this box seals. */
  readonly keyId: string;
  seal(plaintext: string): Uint8Array;
  /** @param keyId the id stored next to the blob — must match this box's key. */
  open(blob: Uint8Array, keyId: string): string;
}

export class AesGcmSecretBox implements SecretBox {
  readonly #key: Buffer;

  constructor(
    readonly keyId: string,
    key: Uint8Array,
  ) {
    if (key.length !== KEY_BYTES) {
      throw new SecretBoxError(`data key must be exactly ${String(KEY_BYTES)} bytes`);
    }
    this.#key = Buffer.from(key);
  }

  seal(plaintext: string): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(this.keyId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  }

  open(blob: Uint8Array, keyId: string): string {
    if (keyId !== this.keyId) {
      throw new SecretBoxError(
        `blob was sealed under key '${keyId}' but this process holds '${this.keyId}'`,
      );
    }
    if (blob.length < IV_BYTES + TAG_BYTES) {
      throw new SecretBoxError("blob is too short to be a sealed secret");
    }
    const buffer = Buffer.from(blob);
    const iv = buffer.subarray(0, IV_BYTES);
    const tag = buffer.subarray(buffer.length - TAG_BYTES);
    const ciphertext = buffer.subarray(IV_BYTES, buffer.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
    decipher.setAAD(Buffer.from(this.keyId, "utf8"));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretBoxError("sealed secret failed authentication (tampered or wrong key)");
    }
  }
}

/**
 * Bound when JENOVA_DATA_KEY is absent: the app still boots (readiness owns
 * liveness), but every seal/open fails loudly instead of storing plaintext
 * or guessing a key.
 */
export class UnconfiguredSecretBox implements SecretBox {
  readonly keyId = "unconfigured";

  seal(): never {
    throw new SecretBoxError(
      "JENOVA_DATA_KEY is not configured — sealed tenant secrets cannot be written",
    );
  }

  open(): never {
    throw new SecretBoxError(
      "JENOVA_DATA_KEY is not configured — sealed tenant secrets cannot be read",
    );
  }
}

/** Build the process box from config; unconfigured key ⇒ fail-on-use box. */
export function secretBoxFromConfig(config: ApiConfig): SecretBox {
  if (config.dataKey === null) {
    return new UnconfiguredSecretBox();
  }
  return new AesGcmSecretBox(config.dataKeyId, Buffer.from(config.dataKey, "base64"));
}
