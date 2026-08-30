/**
 * Injection tokens for the documents module — separate file so the module
 * and its controllers can both import them without a circular import (which
 * would leave the token undefined at decorator-evaluation time).
 */

/** Resolves to a DocumentsService, or null when documents are not configured. */
export const DOCUMENTS_SERVICE = Symbol("jenova.api.documentsService");
