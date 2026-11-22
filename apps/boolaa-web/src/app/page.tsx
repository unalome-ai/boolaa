import { redirect } from "next/navigation";

// The proxy normally redirects "/" before we get here.
export default function Index() {
  redirect("/home");
}
