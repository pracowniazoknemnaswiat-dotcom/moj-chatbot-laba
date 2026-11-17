import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { NEW_CONVERSATION_HREF } from "@/lib/conversation-link";
import { listConversations, StorageError } from "@/lib/conversations";
import ConversationList, { type ConversationItem } from "./conversation-list";
import styles from "./history.module.css";

// Historia rozmów – tylko po zalogowaniu. Bez sesji: przekierowanie do
// strony głównej (formularz hasła), zanim dotkniemy bazy.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <History />
    </Suspense>
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});

async function History() {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = getAuthConfig();
  if (!config || !isSessionValid(token, config)) redirect("/");

  let items: ConversationItem[] = [];
  let storageError: string | null = null;
  try {
    items = (await listConversations()).map((c) => ({
      id: c.id,
      title: c.title,
      date: DATE_FORMAT.format(new Date(c.createdAt)),
      messageCount: c.messageCount,
    }));
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    storageError = error.message;
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>Historia rozmów</h1>
        <Link className={styles.back} href="/">
          ← Czat
        </Link>
        <Link className={styles.newButton} href={NEW_CONVERSATION_HREF}>
          ➕ Nowa rozmowa
        </Link>
      </div>

      {storageError ? (
        <p className={styles.error}>{storageError}</p>
      ) : (
        <ConversationList initial={items} />
      )}
    </main>
  );
}
