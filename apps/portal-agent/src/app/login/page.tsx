import { redirect } from "next/navigation";
import { fetchSessionContext } from "../../lib/session";
import { LoginForm } from "../../components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await fetchSessionContext();
  if (session !== null) {
    redirect("/search");
  }
  return <LoginForm />;
}
