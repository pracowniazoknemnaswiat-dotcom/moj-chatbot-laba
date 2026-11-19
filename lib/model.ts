import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Jedyne miejsce z nazwami modeli OpenRouter (rozmowa i embeddingi).
// Tylko serwer: klucz API nie może trafić do przeglądarki.
//
// Model rozmowy:     OPENROUTER_MODEL
// Model embeddingów: OPENROUTER_EMBEDDING_MODEL – ten sam do zapisu dokumentów i do pytań,
//                    inaczej wektory nie dadzą się porównać.
//   Sprawdzone 2026-11-19: openai/text-embedding-3-small → 1536 liczb
//   (tyle musi mieć kolumna chunks.embedding vector(1536) i funkcja match_chunks).
//   Zmiana modelu = nowa długość = poprawka tabeli i ponowny zapis wszystkich dokumentów.

/** Długość embeddingu = kolumna chunks.embedding vector(1536). */
export const EMBEDDING_DIMENSIONS = 1536;

export type ModelConfig = { apiKey: string; modelId: string };

function config(modelEnv: "OPENROUTER_MODEL" | "OPENROUTER_EMBEDDING_MODEL"): ModelConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const modelId = process.env[modelEnv]?.trim();
  return apiKey && modelId ? { apiKey, modelId } : null;
}

/** Klucz i model rozmowy albo null, gdy czegoś brakuje w .env.local. */
export function chatModelConfig(): ModelConfig | null {
  return config("OPENROUTER_MODEL");
}

/** Klucz i model embeddingów albo null, gdy czegoś brakuje w .env.local. */
export function embeddingModelConfig(): ModelConfig | null {
  return config("OPENROUTER_EMBEDDING_MODEL");
}

/** Model embeddingów gotowy do embed() / embedMany() z pakietu ai. */
export function embeddingModel(cfg: ModelConfig) {
  return createOpenRouter({ apiKey: cfg.apiKey }).textEmbeddingModel(cfg.modelId);
}
