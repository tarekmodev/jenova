import { OfferScreen } from "../../../../components/offer/OfferScreen";

export default async function OfferPage(props: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await props.params;
  return <OfferScreen offerId={offerId} />;
}
