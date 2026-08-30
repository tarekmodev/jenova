/**
 * Zod schemas for TBO HotelAPI responses, written from REAL recorded sandbox
 * traffic (packages/sandbox-replay/recordings/tbo — CLAUDE.md rule 5). Only
 * the fields the adapter consumes are validated; everything else passes
 * through unvalidated so benign supplier additions don't break parsing.
 * Malformed payloads surface as SupplierError(invalid_request) via
 * parseJsonWith.
 */

import { z } from "zod";

/** Envelope on every TBO response: {"Status":{"Code":200,"Description":"Success"}} */
export const tboStatusSchema = z.object({
  Code: z.number().int(),
  Description: z.string(),
});
export type TboStatus = z.infer<typeof tboStatusSchema>;

export const tboEnvelopeSchema = z.object({ Status: tboStatusSchema });

/** {"FromDate":"29-08-2026 00:00:00","ChargeType":"Fixed","CancellationCharge":0} */
export const tboCancelPolicySchema = z.object({
  FromDate: z.string(),
  ChargeType: z.string(),
  CancellationCharge: z.number(),
});
export type TboCancelPolicy = z.infer<typeof tboCancelPolicySchema>;

/**
 * One rate in HotelResult[].Rooms[] (search and PreBook share the shape).
 * TotalFare/TotalTax are decimal floats on the wire — converted exactly to
 * minor units at the boundary (mapping.ts).
 */
export const tboRoomSchema = z.object({
  Name: z.array(z.string()).min(1),
  BookingCode: z.string().min(1),
  Inclusion: z.string().optional(),
  TotalFare: z.number(),
  TotalTax: z.number().optional(),
  CancelPolicies: z.array(tboCancelPolicySchema).optional(),
  MealType: z.string(),
  IsRefundable: z.boolean(),
});
export type TboRoom = z.infer<typeof tboRoomSchema>;

export const tboHotelResultSchema = z.object({
  HotelCode: z.string().min(1),
  Currency: z.string().min(1),
  Rooms: z.array(tboRoomSchema),
});
export type TboHotelResult = z.infer<typeof tboHotelResultSchema>;

/**
 * POST /search and POST /PreBook — {"Status":…,"HotelResult":[…]} (absent on
 * no-availability). PreBook returns the same shape narrowed to the one
 * revalidated rate (verified on the recorded PreBook response).
 */
export const tboSearchResponseSchema = z.object({
  Status: tboStatusSchema,
  HotelResult: z.array(tboHotelResultSchema).optional(),
});
export type TboSearchResponse = z.infer<typeof tboSearchResponseSchema>;

/** POST /Book — envelope + references echoed back. */
export const tboBookResponseSchema = z.object({
  Status: tboStatusSchema,
  ConfirmationNumber: z.string().optional(),
  ClientReferenceId: z.string().optional(),
});
export type TboBookResponse = z.infer<typeof tboBookResponseSchema>;

/**
 * One room on a stored booking (BookingDetail.Rooms[], recorded live):
 * fare/tax/policies live PER ROOM; there is no booking-level total. The
 * response does NOT echo ClientReferenceId — only Book's response does
 * (verified live, recorded).
 */
export const tboBookedRoomSchema = z.object({
  Currency: z.string().min(1),
  /** e.g. "Not Cancelled" — room-level supplier state, diagnostics only. */
  Status: z.string().optional(),
  Name: z.array(z.string()).optional(),
  TotalFare: z.number(),
  TotalTax: z.number().optional(),
  CancelPolicies: z.array(tboCancelPolicySchema).optional(),
  MealType: z.string().optional(),
  IsRefundable: z.boolean().optional(),
});
export type TboBookedRoom = z.infer<typeof tboBookedRoomSchema>;

/** POST /BookingDetail — the stored booking, as recorded live. */
export const tboBookingDetailSchema = z.object({
  BookingStatus: z.string().optional(),
  ConfirmationNumber: z.string().optional(),
  VoucherStatus: z.boolean().optional(),
  HotelDetails: z.object({ HotelCode: z.string().optional() }).optional(),
  Rooms: z.array(tboBookedRoomSchema).optional(),
});
export type TboBookingDetail = z.infer<typeof tboBookingDetailSchema>;

export const tboBookingDetailResponseSchema = z.object({
  Status: tboStatusSchema,
  BookingDetail: tboBookingDetailSchema.optional(),
});
export type TboBookingDetailResponse = z.infer<typeof tboBookingDetailResponseSchema>;

/** POST /Cancel — envelope (+ any refund detail TBO includes). */
export const tboCancelResponseSchema = z.object({
  Status: tboStatusSchema,
  ConfirmationNumber: z.string().optional(),
});
export type TboCancelResponse = z.infer<typeof tboCancelResponseSchema>;
