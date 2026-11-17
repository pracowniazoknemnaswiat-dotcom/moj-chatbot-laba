import { cookies } from "next/headers";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { parseConversationId } from "@/lib/conversation-link";
import { deleteConversation, StorageError } from "@/lib/conversations";

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Usunięcie rozmowy razem z wiadomościami (przycisk „Usuń” na /history).
export async function DELETE(_req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  // 1. Sesja – zanim dotkniemy bazy.
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return json({ error: "Dostęp zablokowany: brak konfiguracji hasła na serwerze." }, 503);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, authConfig)) {
    return json({ error: "Brak ważnej sesji. Odśwież stronę i wpisz hasło ponownie." }, 401);
  }

  const id = parseConversationId((await ctx.params).id);
  if (!id) return json({ error: "Nieprawidłowy numer rozmowy." }, 400);

  try {
    const deleted = await deleteConversation(id);
    if (!deleted) return json({ error: "Tej rozmowy już nie ma." }, 404);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof StorageError) return json({ error: error.message }, 503);
    throw error;
  }
}
