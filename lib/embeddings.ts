import "server-only";
import { embedMany } from "ai";
import { EMBEDDING_DIMENSIONS, embeddingModel, embeddingModelConfig } from "./model";

// Embeddingi fragmentów bazy wiedzy – jeden model (OPENROUTER_EMBEDDING_MODEL)
// do zapisu dokumentów i do pytań.

/** Błąd embeddingów: komunikat + podpowiedź, co może zrobić użytkownik. */
export class EmbeddingError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

/** Embeddingi tekstów w tej samej kolejności, jednym wywołaniem embedMany. */
export async function embedTexts(values: string[], abortSignal?: AbortSignal): Promise<number[][]> {
  if (values.length === 0) return [];
  const cfg = embeddingModelConfig();
  if (!cfg) {
    throw new EmbeddingError(
      "Na serwerze brakuje ustawień modelu embeddingów.",
      "Dopisz OPENROUTER_EMBEDDING_MODEL (i OPENROUTER_API_KEY) w pliku .env.local, uruchom ponownie serwer i dodaj dokument jeszcze raz.",
    );
  }

  let embeddings: number[][];
  try {
    ({ embeddings } = await embedMany({
      model: embeddingModel(cfg),
      values,
      maxRetries: 2,
      abortSignal: abortSignal ?? AbortSignal.timeout(60_000),
    }));
  } catch (e) {
    // Tylko opis błędu – pełny obiekt błędu zawiera całą treść fragmentów.
    const status = (e as { statusCode?: unknown }).statusCode;
    console.error(
      `Embeddingi nie powiodły się (${values.length} fragmentów${status ? `, HTTP ${status}` : ""}):`,
      e instanceof Error ? e.message : String(e),
    );
    throw new EmbeddingError(
      "Usługa embeddingów (OpenRouter) nie przygotowała tekstu.",
      "Spróbuj ponownie za minutę. Jeśli błąd się powtarza, sprawdź na openrouter.ai, czy na koncie są środki i czy nazwa modelu w OPENROUTER_EMBEDDING_MODEL jest poprawna.",
    );
  }

  const badShape =
    embeddings.length !== values.length || embeddings.some((e) => e.length !== EMBEDDING_DIMENSIONS);
  if (badShape) {
    console.error(
      `Embeddingi mają złą liczbę lub długość: ${embeddings.length}/${values.length}, długości:`,
      [...new Set(embeddings.map((e) => e.length))],
    );
    throw new EmbeddingError(
      `Model embeddingów zwrócił wektory innej długości niż ${EMBEDDING_DIMENSIONS}.`,
      `Ustaw w OPENROUTER_EMBEDDING_MODEL model, który zwraca ${EMBEDDING_DIMENSIONS} liczb (np. openai/text-embedding-3-small), albo zmień kolumnę embedding w Supabase.`,
    );
  }
  return embeddings;
}
