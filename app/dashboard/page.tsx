import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import Dashboard from "./dashboard";

// Asystent podróży – tylko po zalogowaniu. Bez sesji: przekierowanie do
// strony głównej, gdzie jest formularz hasła.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  // connection(): sesję sprawdzamy przy każdym żądaniu, nie w prerenderze.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = getAuthConfig();
  if (!config || !isSessionValid(token, config)) redirect("/");
  return <Dashboard />;
}
