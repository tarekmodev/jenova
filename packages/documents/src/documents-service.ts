/**
 * DocumentsService (issue #99): renders a booking's bilingual voucher PDF,
 * stores the artifact in the object store, and records the handle in the
 * tenant's `document` table. Rendering is deterministic (Typst, pinned
 * fonts, date: none): re-rendering the same booking produces byte-identical
 * output, so the upsert is naturally idempotent.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Locale, TenantId } from "@jenova/domain";
import {
  documents,
  type DocumentKind,
  type TenantDbResolver,
  type ControlPlaneClient,
} from "@jenova/db";
import { buildVoucherTemplateInput, type VoucherData } from "./voucher-content";
import {
  loadVoucherData,
  NullPropertyNameSource,
  type PropertyNameSource,
} from "./voucher-data";
import { TypstRenderer, VOUCHER_TEMPLATE } from "./typst";
import type { DocumentStore } from "./store";

export type DocumentRow = typeof documents.$inferSelect;

export interface StoredVoucher {
  readonly document: DocumentRow;
  readonly bytes: Uint8Array;
}

export interface RenderedVoucher extends StoredVoucher {
  /** The assembled voucher facts — delivery builds the email from these. */
  readonly data: VoucherData;
}

export interface DocumentsServiceDeps {
  readonly resolver: TenantDbResolver;
  readonly controlPlane: ControlPlaneClient;
  readonly store: DocumentStore;
  readonly renderer: TypstRenderer;
  /** Canonical property display names; defaults to the null source until M3 mapping. */
  readonly propertyNames?: PropertyNameSource;
}

const VOUCHER_KIND: DocumentKind = "hotel_voucher";
const LOGO_FILE = "logo.png";

export class DocumentsService {
  private readonly propertyNames: PropertyNameSource;

  constructor(private readonly deps: DocumentsServiceDeps) {
    this.propertyNames = deps.propertyNames ?? new NullPropertyNameSource();
  }

  /**
   * Renders the voucher for `bookingId` (Arabic-primary bilingual document;
   * `locale` selects which language section leads), stores the PDF, upserts
   * the document row, and returns handle + bytes.
   */
  async renderVoucher(
    tenant: TenantId,
    bookingId: string,
    locale: Locale = "ar",
  ): Promise<RenderedVoucher> {
    const data = await loadVoucherData(
      {
        resolver: this.deps.resolver,
        controlPlane: this.deps.controlPlane,
        propertyNames: this.propertyNames,
      },
      tenant,
      bookingId,
    );
    const bytes = await this.renderPdf(data, locale);
    const storageKey = this.storageKey(tenant, data.bookingItemId, locale);
    await this.deps.store.put(storageKey, bytes, "application/pdf");

    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const db = await this.deps.resolver.getTenantDb(tenant);
    const [row] = await db
      .insert(documents)
      .values({
        bookingId: data.bookingId,
        bookingItemId: data.bookingItemId,
        kind: VOUCHER_KIND,
        locale,
        storageKey,
        contentSha256,
        sizeBytes: bytes.byteLength,
      })
      .onConflictDoUpdate({
        target: [documents.bookingItemId, documents.kind, documents.locale],
        set: {
          storageKey,
          contentSha256,
          sizeBytes: bytes.byteLength,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row === undefined) {
      throw new Error("document upsert returned no row");
    }
    return { document: row, bytes, data };
  }

  /**
   * The voucher PDF for re-download: the stored artifact when present,
   * otherwise a fresh (deterministic) render.
   */
  async voucherPdf(
    tenant: TenantId,
    bookingId: string,
    locale: Locale = "ar",
  ): Promise<StoredVoucher> {
    const db = await this.deps.resolver.getTenantDb(tenant);
    const [existing] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.bookingId, bookingId),
          eq(documents.kind, VOUCHER_KIND),
          eq(documents.locale, locale),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      const bytes = await this.deps.store.get(existing.storageKey);
      if (bytes !== null) {
        return { document: existing, bytes };
      }
      // Object store lost the artifact — deterministic re-render restores it.
    }
    return this.renderVoucher(tenant, bookingId, locale);
  }

  private async renderPdf(data: VoucherData, locale: Locale): Promise<Uint8Array> {
    const hasLogo = data.brand.logoPng !== null;
    const input = buildVoucherTemplateInput(data, locale, hasLogo ? LOGO_FILE : null);
    return this.deps.renderer.render({
      templatePath: VOUCHER_TEMPLATE,
      data: input,
      ...(data.brand.logoPng === null ? {} : { files: { [LOGO_FILE]: data.brand.logoPng } }),
    });
  }

  private storageKey(tenant: TenantId, bookingItemId: string, locale: Locale): string {
    return `tenants/${tenant}/documents/hotel-voucher/${bookingItemId}.${locale}.pdf`;
  }
}
