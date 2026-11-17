// Adresy rozmów w czacie (bez połączenia z bazą – używane przez serwer i przeglądarkę).
//   /?c=12   – rozmowa nr 12 z bazy
//   /?new=1  – pusta, nowa rozmowa (wpis w bazie powstanie przy pierwszej wiadomości)
//   /        – ostatnia rozmowa

export const NEW_CONVERSATION_HREF = "/?new=1";

export function conversationHref(id: number): string {
  return `/?c=${id}`;
}

/** Numer rozmowy z parametru „c” albo null, gdy brak / nieprawidłowy. */
export function parseConversationId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
