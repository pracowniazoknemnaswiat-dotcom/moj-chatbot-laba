import { z } from "zod";
import { MAX_DOCUMENT_LENGTH, MAX_TITLE_LENGTH, splitIntoChunks } from "@/lib/chunking";
import { DocumentError, findDocumentsByTitle, importDocument, listDocuments } from "@/lib/documents";
import type { ImportEvent, ImportStage } from "@/lib/knowledge-shared";
import { brakSesji } from "@/lib/session-guard";

// Baza wiedzy (strona /upload).
//   GET  – lista dokumentów: tytuł (źródło), data dodania (wersja), liczba fragmentów,
//   POST – import dokumentu. Odpowiedź to strumień zdarzeń, jedna linia JSON = jedno
//          zdarzenie (etap, wynik albo błąd z etapem i podpowiedzią) – strona pokazuje postęp.
//          Ten sam tytuł co istniejący dokument: 409, chyba że replace = true (zastąpienie).

// Import z embeddingami może potrwać – więcej czasu niż domyślnie.
export const maxDuration = 60;

const json = (data: unknown, status = 200) => Response.json(data, { status });

const bodySchema = z.strictObject({
  title: z.string(),
  content: z.string(),
  replace: z.boolean().optional(),
});

export async function GET() {
  // 1. Sesja – zanim dotkniemy bazy.
  const odmowa = await brakSesji();
  if (odmowa) return odmowa;
  try {
    return json({ documents: await listDocuments() });
  } catch (e) {
    if (e instanceof DocumentError) return json({ error: e.message, hint: e.hint }, 503);
    throw e;
  }
}

export async function POST(req: Request) {
  // 1. Sesja – zanim przeczytamy treść i dotkniemy bazy albo modelu.
  const odmowa = await brakSesji();
  if (odmowa) return odmowa;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Nieprawidłowe zapytanie." }, 400);
  const title = parsed.data.title.trim();
  const content = parsed.data.content.trim();

  if (!title) return json({ error: "Wpisz tytuł dokumentu." }, 400);
  if (!content) return json({ error: "Wklej treść dokumentu." }, 400);
  if (title.length > MAX_TITLE_LENGTH) {
    return json({ error: `Tytuł może mieć najwyżej ${MAX_TITLE_LENGTH} znaków.` }, 400);
  }
  if (content.length > MAX_DOCUMENT_LENGTH) {
    return json(
      { error: `Treść może mieć najwyżej ${MAX_DOCUMENT_LENGTH.toLocaleString("pl-PL")} znaków. Podziel dokument na części.` },
      400,
    );
  }

  // 2. Czy to nowa wersja istniejącego dokumentu? Zastępujemy tylko po potwierdzeniu.
  let previous;
  try {
    previous = await findDocumentsByTitle(title);
  } catch (e) {
    if (e instanceof DocumentError) return json({ error: e.message, hint: e.hint }, 503);
    throw e;
  }
  if (previous.length && !parsed.data.replace) {
    return json(
      {
        error: `Dokument „${previous[0].title}” już jest w bazie.`,
        conflict: { title: previous[0].title, date: previous[0].date, chunkCount: previous[0].chunkCount },
      },
      409,
    );
  }

  // 3. Import ze zdarzeniami o postępie.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ImportEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let stage: ImportStage = "split";
      try {
        send({ type: "stage", stage: "split" });
        const chunks = splitIntoChunks(content);
        const result = await importDocument(title, chunks, {
          replaceIds: previous.map((d) => d.id),
          onStage: (s) => {
            stage = s;
            send({ type: "stage", stage: s });
          },
        });
        send({
          type: "done",
          title,
          chunks: result.chunks,
          backfilled: result.backfilled,
          replaced: result.replaced,
          warnings: result.warnings,
        });
      } catch (e) {
        if (e instanceof DocumentError) {
          send({ type: "error", stage: e.stage, error: e.message, hint: e.hint });
        } else {
          console.error("Nieoczekiwany błąd importu:", e instanceof Error ? e.message : e);
          send({
            type: "error",
            stage,
            error: "Coś poszło nie tak po stronie serwera.",
            hint: "Spróbuj ponownie za chwilę. Jeśli to się powtarza, sprawdź okno terminala z serwerem (npm run dev).",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
