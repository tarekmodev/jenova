import { BookingDetailScreen } from "../../../../components/bookings/BookingDetailScreen";

export default async function BookingDetailPage(props: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await props.params;
  return <BookingDetailScreen bookingId={bookingId} />;
}
