import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { BookingsScreen, type BookingRowDto } from "./bookings-screen";

interface SearchParams {
  readonly state?: string;
  readonly supplier?: string;
  readonly from?: string;
  readonly to?: string;
}

export default async function BookingsPage(props: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<ReactNode> {
  const t = await getTranslations("workspace.bookings");
  const params = await props.searchParams;
  const query = new URLSearchParams();
  for (const key of ["state", "supplier", "from", "to"] as const) {
    const value = params[key];
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const { bookings } = await apiJsonOrLogin<{ bookings: BookingRowDto[] }>(
    `/staff/bookings${suffix}`,
  );
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <BookingsScreen
        rows={bookings}
        filters={{
          state: params.state ?? "",
          supplier: params.supplier ?? "",
          from: params.from ?? "",
          to: params.to ?? "",
        }}
      />
    </>
  );
}
