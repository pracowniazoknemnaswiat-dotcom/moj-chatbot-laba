import "server-only";
import { embedTexts, EmbeddingError } from "./embeddings";
import {
  formatVersionDate,
  sameTitle,
  type DocumentSummary,
  type ImportStage,
} from "./knowledge-shared";
import { getSupabase } from "./supabase";

// Baza wiedzy: dokumenty (documents) i ich fragmenty z embeddingami (chunks).
//
// Import – kolejność chroni przed niedokończonymi dokumentami:
//   1. stare fragmenty bez embeddingu (do uzupełnienia),
//   2. embeddingi nowych i starych fragmentów – JEDNO wywołanie embedMany;
//      błąd = nic nie zapisujemy,
//   3. zapis dokumentu i fragmentów od razu z embeddingami; błąd = usuwamy nowy dokument,
//      poprzednia wersja zostaje nietknięta,
//   4. dopiero teraz usuwamy poprzednią wersję (ten sam tytuł) i uzupełniamy stare embeddingi;
//      ich błędy nie cofają nowego dokumentu (jest kompletny) – wynik o nich mówi.

/** Błąd bazy wiedzy: komunikat, etap importu i podpowiedź, co zrobić. */
export class DocumentError extends Error {
  readonly stage: ImportStage;
  readonly hint: string;
  constructor(message: string, stage: ImportStage, hint: string) {
    super(message);
    this.stage = stage;
    this.hint = hint;
  }
}

/** Ile starych fragmentów bez embeddingu uzupełniamy przy jednym imporcie. */
const BACKFILL_LIMIT = 300;
/** Ile aktualizacji starych fragmentów wysyłamy równocześnie. */
const UPDATE_BATCH = 20;

const HINT_DB =
  "Nic nie zostało zapisane. Spróbuj ponownie za chwilę. Jeśli błąd się powtarza, sprawdź w Supabase Dashboard, czy projekt działa (nie jest wstrzymany).";
const HINT_CONFIG =
  "Uzupełnij SUPABASE_URL i SUPABASE_SECRET_KEY w pliku .env.local i uruchom ponownie serwer.";

function db(stage: ImportStage = "save") {
  const supabase = getSupabase();
  if (!supabase) {
    throw new DocumentError("Baza wiedzy nie jest podłączona: na serwerze brakuje ustawień Supabase.", stage, HINT_CONFIG);
  }
  return supabase;
}

// ───────────────────────── lista i usuwanie ─────────────────────────

/** Dokumenty od najnowszego, z liczbą fragmentów. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const { data, error } = await db()
    .from("documents")
    .select("id, title, created_at, chunks(count)")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Odczyt listy dokumentów nie powiódł się:", error.message);
    throw new DocumentError("Nie udało się wczytać listy dokumentów.", "save", "Odśwież stronę za chwilę.");
  }
  return (data ?? []).map((d) => ({
    id: d.id as number,
    title: d.title as string,
    date: formatVersionDate(d.created_at as string),
    chunkCount: ((d.chunks as { count: number }[] | null)?.[0]?.count ?? 0),
  }));
}

/** Dokumenty o tym samym tytule (bez względu na wielkość liter i spacje). */
export async function findDocumentsByTitle(title: string): Promise<DocumentSummary[]> {
  return (await listDocuments()).filter((d) => sameTitle(d.title, title));
}

/** Usuwa dokument z fragmentami. false = takiego dokumentu nie było. */
export async function deleteDocument(id: number): Promise<boolean> {
  const supabase = db();
  const { error: chunksError } = await supabase.from("chunks").delete().eq("document_id", id);
  if (chunksError) {
    console.error("Usuwanie fragmentów nie powiodło się:", id, chunksError.message);
    throw new DocumentError("Nie udało się usunąć dokumentu.", "save", "Spróbuj ponownie za chwilę.");
  }
  const { data, error } = await supabase.from("documents").delete().eq("id", id).select("id");
  if (error) {
    console.error("Usuwanie dokumentu nie powiodło się:", id, error.message);
    throw new DocumentError("Nie udało się usunąć dokumentu.", "save", "Spróbuj ponownie za chwilę.");
  }
  return (data ?? []).length > 0;
}

// ───────────────────────── import ─────────────────────────

export type ImportResult = {
  id: number;
  chunks: number;
  /** Stare fragmenty, którym uzupełniono embedding. */
  backfilled: number;
  /** Usunięte poprzednie wersje (ten sam tytuł). */
  replaced: number;
  /** Rzeczy, które się nie udały, choć nowy dokument jest kompletny. */
  warnings: string[];
};

type ImportOptions = {
  /** Poprzednie wersje do zastąpienia (usuwane po udanym zapisie nowej). */
  replaceIds?: number[];
  onStage?: (stage: ImportStage) => void;
};

export async function importDocument(
  title: string,
  chunks: string[],
  { replaceIds = [], onStage }: ImportOptions = {},
): Promise<ImportResult> {
  onStage?.("embed");
  const supabase = db("embed");

  // 1. Stare fragmenty z pustym embeddingiem (bez tych, które zaraz zastąpimy).
  let missingQuery = supabase.from("chunks").select("id, content").is("embedding", null);
  if (replaceIds.length) missingQuery = missingQuery.not("document_id", "in", `(${replaceIds.join(",")})`);
  const { data: missingData, error: missingError } = await missingQuery.order("id").limit(BACKFILL_LIMIT);
  if (missingError) {
    console.error("Odczyt fragmentów bez embeddingu nie powiódł się:", missingError.message);
    throw new DocumentError("Nie udało się połączyć z bazą wiedzy.", "embed", HINT_DB);
  }
  const missing = (missingData ?? []) as { id: number; content: string }[];

  // 2. Embeddingi: nowe fragmenty + stare, jednym wywołaniem.
  let vectors: number[][];
  try {
    vectors = await embedTexts([...chunks, ...missing.map((c) => c.content)]);
  } catch (e) {
    if (e instanceof EmbeddingError) {
      throw new DocumentError(e.message, "embed", `Nic nie zostało zapisane. ${e.hint}`);
    }
    throw e;
  }
  const newVectors = vectors.slice(0, chunks.length);
  const oldVectors = vectors.slice(chunks.length);

  // 3. Nowy dokument i fragmenty z embeddingami.
  onStage?.("save");
  const { data: doc, error: docError } = await supabase.from("documents").insert({ title }).select("id").single();
  if (docError || !doc) {
    console.error("Zapis dokumentu nie powiódł się:", docError?.message);
    throw new DocumentError("Baza nie przyjęła dokumentu.", "save", HINT_DB);
  }
  const rows = chunks.map((content, index) => ({
    document_id: doc.id,
    chunk_index: index,
    content,
    embedding: newVectors[index],
  }));
  const { error: chunksError } = await supabase.from("chunks").insert(rows);
  if (chunksError) {
    console.error("Zapis fragmentów nie powiódł się – usuwam nowy dokument", doc.id, chunksError.message);
    await deleteDocument(doc.id).catch(() => {
      console.error("Nie udało się usunąć niedokończonego dokumentu", doc.id);
    });
    throw new DocumentError(
      "Baza nie przyjęła fragmentów dokumentu, więc wycofałem cały import.",
      "save",
      replaceIds.length ? `Poprzednia wersja została bez zmian. ${HINT_DB}` : HINT_DB,
    );
  }

  const warnings: string[] = [];

  // 4a. Poprzednie wersje – dopiero gdy nowa jest kompletna.
  let replaced = 0;
  for (const id of replaceIds) {
    try {
      if (await deleteDocument(id)) replaced++;
    } catch {
      warnings.push("Nie udało się usunąć poprzedniej wersji – usuń ją ręcznie z listy poniżej (przycisk „Usuń”).");
    }
  }

  // 4b. Uzupełnienie starych fragmentów. id to kolumna GENERATED ALWAYS, więc upsert
  //     nie przejdzie – aktualizujemy wiersz po wierszu, po kilka naraz.
  let backfilled = 0;
  for (let i = 0; i < missing.length; i += UPDATE_BATCH) {
    const results = await Promise.all(
      missing.slice(i, i + UPDATE_BATCH).map((c, j) =>
        supabase.from("chunks").update({ embedding: oldVectors[i + j] }).eq("id", c.id),
      ),
    );
    for (const { error } of results) {
      if (error) console.error("Uzupełnienie embeddingu nie powiodło się:", error.message);
      else backfilled++;
    }
  }
  if (backfilled < missing.length) {
    warnings.push(
      `Nie udało się uzupełnić embeddingów ${missing.length - backfilled} starszych fragmentów – spróbuję przy następnym imporcie.`,
    );
  }

  return { id: doc.id, chunks: rows.length, backfilled, replaced, warnings };
}
