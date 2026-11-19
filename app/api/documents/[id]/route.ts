import { DocumentError, deleteDocument } from "@/lib/documents";
import { brakSesji } from "@/lib/session-guard";

// Usunięcie dokumentu z bazy wiedzy razem z fragmentami (przycisk „Usuń” na /upload).

const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function DELETE(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  // 1. Sesja – zanim dotkniemy bazy.
  const odmowa = await brakSesji();
  if (odmowa) return odmowa;

  const raw = (await ctx.params).id;
  const id = /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
  if (!id || !Number.isSafeInteger(id)) return json({ error: "Nieprawidłowy numer dokumentu." }, 400);

  try {
    if (!(await deleteDocument(id))) return json({ error: "Tego dokumentu już nie ma." }, 404);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocumentError) return json({ error: e.message, hint: e.hint }, 503);
    throw e;
  }
}
