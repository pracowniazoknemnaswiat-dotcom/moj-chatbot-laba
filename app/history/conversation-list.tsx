"use client";

import Link from "next/link";
import { useState } from "react";
import { conversationHref, NEW_CONVERSATION_HREF } from "@/lib/conversation-link";
import styles from "./history.module.css";

// Dane z serwera (strona /history) – bez połączenia z bazą w przeglądarce.
export type ConversationItem = {
  id: number;
  title: string;
  /** Data gotowa do wyświetlenia (sformatowana na serwerze). */
  date: string;
  messageCount: number;
};

// „1 wiadomość”, poza tym zawsze „wiadomości” (2 wiadomości, 5 wiadomości).
function messagesLabel(count: number): string {
  return count === 1 ? "1 wiadomość" : `${count} wiadomości`;
}

function errorFrom(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

export default function ConversationList({ initial }: { initial: ConversationItem[] }) {
  const [items, setItems] = useState(initial);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(item: ConversationItem) {
    const ok = window.confirm(
      `Usunąć rozmowę „${item.title}”?\n\nZniknie z historii razem ze wszystkimi wiadomościami (${messagesLabel(item.messageCount)}). Tego nie da się cofnąć.`,
    );
    if (!ok) return;
    setDeleting(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${item.id}`, { method: "DELETE" });
      const data: unknown = await res.json().catch(() => null);
      // 404 = rozmowy już nie ma w bazie – też usuwamy ją z listy.
      if (!res.ok && res.status !== 404) {
        setError(errorFrom(data, "Nie udało się usunąć rozmowy. Spróbuj ponownie."));
        return;
      }
      setItems((prev) => prev.filter((c) => c.id !== item.id));
    } catch {
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setDeleting(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyGreeting}>Dzień dobry! 🪟</p>
        <p>
          Tu jeszcze pusto – nie mamy żadnej zapisanej rozmowy. Napisz, w czym mogę
          pomóc: przygotuję szkic odpowiedzi dla rodzica pytającego o kurs
          ósmoklasisty, sprawdzę termin ferii albo policzę raty za zajęcia.
        </p>
        <p className={styles.emptySignature}>– Asystent Pracowni z Oknem na Świat</p>
        <Link className={styles.newButton} href={NEW_CONVERSATION_HREF}>
          Zacznijmy pierwszą rozmowę
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.list}>
        {items.map((c) => (
          <li key={c.id} className={styles.row}>
            <Link className={styles.item} href={conversationHref(c.id)}>
              <span className={styles.title}>{c.title}</span>
              <span className={styles.meta}>
                {c.date} · {messagesLabel(c.messageCount)}
              </span>
            </Link>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => remove(c)}
              disabled={deleting !== null}
              aria-label={`Usuń rozmowę: ${c.title}`}
            >
              {deleting === c.id ? "Usuwam…" : "Usuń"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
