import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { parseConversationId } from "@/lib/conversation-link";
import {
  loadConversation,
  loadLatestConversation,
  StorageError,
  type LoadedConversation,
} from "@/lib/conversations";
import Chat from "./chat";
import styles from "./page.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  password: "Błędne hasło.",
  limit: "Za dużo nieudanych prób. Spróbuj ponownie za 15 minut.",
  config: "Dostęp zablokowany: brak konfiguracji hasła na serwerze.",
};

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={null}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}

async function Gate({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  // cookies() przed odczytem env: konfiguracja jest sprawdzana przy żądaniu, nie przy buildzie.
  // connection(): sprawdzanie ważności sesji (Date.now) tylko przy żądaniu, nie w prerenderze.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = getAuthConfig();
  if (!config) {
    return (
      <main className={styles.main}>
        <h1>Mój chatbot</h1>
        <p className={styles.error}>
          Dostęp zablokowany: ustaw CHAT_PASSWORD i SESSION_SECRET (min. 32
          znaki) w pliku .env.local.
        </p>
      </main>
    );
  }

  if (isSessionValid(token, config)) {
    // Odczyt z bazy dopiero po sprawdzeniu sesji. Błąd bazy nie blokuje czatu –
    // zaczynamy pustą rozmowę i pokazujemy komunikat.
    //   ?c=12  – rozmowa nr 12 (z historii), ?new=1 – pusta rozmowa, bez parametrów – ostatnia.
    const params = await searchParams;
    const wanted = parseConversationId(params.c);
    const startEmpty = params.new === "1";
    let loaded: LoadedConversation | null = null;
    let storageError: string | null = null;
    try {
      if (wanted) {
        loaded = await loadConversation(wanted);
        if (!loaded) storageError = "Nie znaleziono tej rozmowy. Zaczynasz nową.";
      } else if (!startEmpty) {
        loaded = await loadLatestConversation();
      }
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      storageError = error.message;
    }
    return (
      <Chat
        // Inna rozmowa = nowy czat (bez wiadomości z poprzednio otwartej).
        key={loaded ? `c-${loaded.id}` : "new"}
        initialConversationId={loaded?.id ?? null}
        initialMessages={loaded?.messages ?? []}
        storageError={storageError}
      />
    );
  }

  const { error } = await searchParams;
  const message = typeof error === "string" ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className={styles.main}>
      <h1>Wpisz hasło</h1>
      <form className={styles.form} action="/api/login" method="post">
        <input
          className={styles.input}
          type="password"
          name="password"
          required
          autoFocus
          placeholder="Hasło warsztatowe"
          aria-label="Hasło"
        />
        <button className={styles.button} type="submit">
          Wejdź
        </button>
      </form>
      {message && <p className={styles.error}>{message}</p>}
    </main>
  );
}
