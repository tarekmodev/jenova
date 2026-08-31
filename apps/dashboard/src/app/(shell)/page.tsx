import { redirect } from "next/navigation";

/** The workspace bookings queue is the staff home (docs/apps/core-workspace.md). */
export default function HomePage(): never {
  redirect("/workspace/bookings");
}
