import "server-only";
import type { StoredMessage } from "./conversation-text";
import { getSupabase } from "./supabase";

// Zapis i odczyt rozmów w tabelach conversations i messages.
// Wywoływać tylko po sprawdzeniu sesji (endpoint czatu, strona główna).

export class StorageError extends Error {}

function db() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new StorageError(
      "Brak konfiguracji bazy: uzupełnij SUPABASE_URL i SUPABASE_SECRET_KEY w pliku .env.local i uruchom ponownie serwer.",
    );
  }
  return supabase;
}

function fail(action: string, error: { message: string }): never {
  console.error(`Supabase – ${action}:`, error.message);
  throw new StorageError("Nie udało się połączyć z bazą rozmów. Spróbuj ponownie za chwilę.");
}

/** Nowa rozmowa; zwraca jej id. */
export async function createConversation(title: string): Promise<number> {
  const { data, error } = await db()
    .from("conversations")
    .insert({ title })
    .select("id")
    .single();
  if (error) fail("tworzenie rozmowy", error);
  return Number(data.id);
}

export async function conversationExists(id: number): Promise<boolean> {
  const { data, error } = await db()
    .from("conversations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("sprawdzanie rozmowy", error);
  return data !== null;
}

export async function updateConversationTitle(id: number, title: string): Promise<void> {
  const { error } = await db().from("conversations").update({ title }).eq("id", id);
  if (error) fail("zmiana tytułu rozmowy", error);
}

/**
 * Usuwa rozmowę razem z wiadomościami. Najpierw wiadomości, potem rozmowę –
 * działa także wtedy, gdy klucz obcy nie ma usuwania kaskadowego.
 * false = takiej rozmowy nie było.
 */
export async function deleteConversation(id: number): Promise<boolean> {
  if (!(await conversationExists(id))) return false;
  const supabase = db();
  const { error: messagesError } = await supabase
    .from("messages")
    .delete()
    .eq("conversation_id", id);
  if (messagesError) fail("usuwanie wiadomości", messagesError);
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) fail("usuwanie rozmowy", error);
  return true;
}

/** Zapisuje wiadomości jednym poleceniem, w podanej kolejności (id rosną po kolei). */
export async function saveMessages(
  conversationId: number,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<void> {
  if (messages.length === 0) return;
  const { error } = await db()
    .from("messages")
    .insert(messages.map((m) => ({ conversation_id: conversationId, ...m })));
  if (error) fail("zapis wiadomości", error);
}

export type LoadedConversation = { id: number; messages: StoredMessage[] };

/** Wiadomości rozmowy w kolejności zapisu (rosnące id). */
async function loadMessages(conversationId: number): Promise<StoredMessage[]> {
  const { data: rows, error } = await db()
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: true });
  if (error) fail("odczyt wiadomości", error);

  const messages: StoredMessage[] = [];
  for (const row of rows ?? []) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    messages.push({ id: `db-${row.id}`, role: row.role, text: String(row.content ?? "") });
  }
  return messages;
}

/** Ostatnia rozmowa z wiadomościami albo null, gdy w bazie nie ma żadnej. */
export async function loadLatestConversation(): Promise<LoadedConversation | null> {
  const { data: conversation, error } = await db()
    .from("conversations")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("odczyt ostatniej rozmowy", error);
  if (!conversation) return null;

  const id = Number(conversation.id);
  return { id, messages: await loadMessages(id) };
}

/** Wybrana rozmowa z wiadomościami albo null, gdy takiej nie ma. */
export async function loadConversation(id: number): Promise<LoadedConversation | null> {
  if (!(await conversationExists(id))) return null;
  return { id, messages: await loadMessages(id) };
}

export type ConversationSummary = {
  id: number;
  title: string;
  createdAt: string;
  messageCount: number;
};

/** Lista rozmów do strony /history: najnowsze na górze. */
export async function listConversations(limit = 100): Promise<ConversationSummary[]> {
  // messages(count) – liczba wiadomości z tabeli messages (klucz obcy conversation_id).
  const { data, error } = await db()
    .from("conversations")
    .select("id, title, created_at, messages(count)")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) fail("lista rozmów", error);

  return (data ?? []).map((row) => {
    const counted = row.messages as unknown as { count: number }[] | null;
    return {
      id: Number(row.id),
      title: String(row.title ?? "").trim() || "Bez tytułu",
      createdAt: String(row.created_at),
      messageCount: counted?.[0]?.count ?? 0,
    };
  });
}
