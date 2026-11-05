// Prawdziwy provider OpenRouter z podstawionym fetch: kontrolowane odpowiedzi,
// zero zapytań do sieci i zero płatnych wywołań modelu.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Każda próba wyjścia do sieci poza podstawionym fetch kończy test błędem.
globalThis.fetch = () => {
  throw new Error("Test próbował wyjść do sieci!");
};
// Logi serwera ([analyze] ...) nie są potrzebne w wynikach testów.
console.error = () => {};

export const requests = [];

export function mockModel(respond) {
  return createOpenRouter({
    apiKey: "test-key-not-real",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return respond();
    },
  })("test/model", {
    provider: { require_parameters: true },
    structuredOutputs: { strict: true },
  });
}

export const completion =
  (content, finish = "stop", extra = {}) =>
  () =>
    new Response(
      JSON.stringify({
        id: "gen-test",
        model: "test/model",
        created: 0,
        choices: [
          { index: 0, message: { role: "assistant", content, ...extra }, finish_reason: finish },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

export const httpError = (status, message, metadata = {}) => () =>
  new Response(JSON.stringify({ error: { code: status, message, metadata } }), {
    status,
    headers: { "content-type": "application/json" },
  });

export const json = (o) => JSON.stringify(o);

export const GOOD = {
  category: "sales",
  priority: "normal",
  draft: "Konsultacja kosztuje 150 zł brutto.",
  needs_review: false,
};
