import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { loadProfile, ProfileError } from "@/lib/profile";
import ProfileEditor, { type ProfileData } from "./profile-editor";
import styles from "./profile.module.css";

// Profil użytkownika (pamięć agenta) – tylko po zalogowaniu. Bez sesji
// przekierowanie do hasła, zanim dotkniemy bazy. Zmiany: /api/profile.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = getAuthConfig();
  if (!config || !isSessionValid(token, config)) redirect("/");

  let profile: ProfileData = { name: null, preferences: {} };
  let error: string | null = null;
  try {
    profile = (await loadProfile()) ?? profile;
  } catch (e) {
    if (!(e instanceof ProfileError)) throw e;
    error = e.message;
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>Mój profil</h1>
        <Link className={styles.back} href="/">
          ← Czat
        </Link>
      </div>
      <p className={styles.intro}>
        To pamięta o Tobie asystent Pracowni. Możesz to poprawić tutaj albo po prostu
        napisać w czacie, np. „wolę szczegółowe odpowiedzi”.
      </p>

      {error ? <p className={styles.error}>{error}</p> : <ProfileEditor initial={profile} />}
    </main>
  );
}
