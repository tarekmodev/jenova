import { redirect } from "next/navigation";
import { fetchSessionContext } from "../lib/session";

export const dynamic = "force-dynamic";

export default async function Home(): Promise<never> {
  const session = await fetchSessionContext();
  redirect(session === null ? "/login" : "/search");
}
