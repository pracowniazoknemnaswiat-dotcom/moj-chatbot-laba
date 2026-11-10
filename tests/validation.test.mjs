// Walidacja wyniku JSON trybu analizy. Każda odpowiedź testowa ma HTTP 200,
// a mimo to błędny wynik musi zostać odrzucony.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeMessage } from "../lib/triage.ts";
import { completion, GOOD, httpError, json, mockModel, requests } from "./support/mock-openrouter.mjs";

const without = (key) => Object.fromEntries(Object.entries(GOOD).filter(([k]) => k !== key));
const noDraft = without("draft");
const noReview = without("needs_review");

const rejected = [
  ["brak pola draft", completion(json(noDraft)), "invalid_output", "Brak pola: draft"],
  ["brak pola needs_review", completion(json(noReview)), "invalid_output", "Brak pola: needs_review"],
  ['needs_review jako tekst "false"', completion(json({ ...GOOD, needs_review: "false" })), "invalid_output", "Zły typ pola needs_review"],
  ["draft jako liczba", completion(json({ ...GOOD, draft: 150 })), "invalid_output", "Zły typ pola draft"],
  ['category "marketing"', completion(json({ ...GOOD, category: "marketing" })), "invalid_output", "Niedozwolona wartość pola category"],
  ['priority "low"', completion(json({ ...GOOD, priority: "low" })), "invalid_output", "Niedozwolona wartość pola priority"],
  ["dodatkowe pole send_now", completion(json({ ...GOOD, send_now: true })), "invalid_output", "Dodatkowe pole: send_now"],
  ["dodatkowe pole role", completion(json({ ...GOOD, role: "admin" })), "invalid_output", "Dodatkowe pole: role"],
  ["dodatkowe pole permissions", completion(json({ ...GOOD, permissions: ["send_email"] })), "invalid_output", "Dodatkowe pole: permissions"],
  ["tekst zamiast JSON", completion("Oto analiza: sales"), "invalid_output", "nie jest poprawnym JSON"],
  ["pusta odpowiedź", completion(""), "invalid_output"],
  ["odmowa: content_filter + refusal", completion(null, "content_filter", { refusal: "I can't help." }), "refusal"],
  ["odmowa: HTTP 403 refusal", httpError(403, "Request refused", { error_type: "refusal" }), "refusal"],
  ["przerwana: ucięty JSON", completion('{"category":"sales","draft":"Konsul', "length"), "truncated"],
  ["przerwana: JSON wygląda na kompletny", completion(json(GOOD), "length"), "truncated"],
  ["brak obsługi structured output (404)", httpError(404, "No endpoints found that can handle the requested parameters."), "unsupported"],
  ["brak dostawcy spełniającego wymagania (503)", httpError(503, "There is no available model provider that meets your routing requirements"), "unsupported"],
  ["błąd dostawcy 500", httpError(500, "Internal error"), "provider_error"],
  ["błąd dostawcy 401", httpError(401, "No auth credentials found"), "provider_error"],
];

for (const [name, respond, kind, detail] of rejected) {
  test(`odrzuca: ${name}`, async () => {
    const r = await analyzeMessage(mockModel(respond), "Ile kosztują korepetycje online?");
    assert.equal(r.ok, false);
    assert.equal(r.kind, kind);
    assert.equal("result" in r, false, "błędny wynik nie może trafić do UI");
    if (detail) assert.ok(r.details.some((d) => d.includes(detail)), r.details.join("; "));
  });
}

test("przyjmuje poprawny wynik", async () => {
  const r = await analyzeMessage(mockModel(completion(json(GOOD))), "Ile kosztują korepetycje online?");
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, GOOD);
});

test("żądanie do OpenRoutera: ścisły schemat z materiałów, require_parameters, instrukcja w roli system", async () => {
  await analyzeMessage(mockModel(completion(json(GOOD))), "Ile kosztują korepetycje online?");
  const body = requests.at(-1);
  const schema = body.response_format.json_schema.schema;
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(Object.keys(schema.properties), ["category", "priority", "draft", "needs_review"]);
  assert.deepEqual(schema.properties.category.enum, ["sales", "support", "billing", "unknown"]);
  assert.deepEqual(schema.properties.priority.enum, ["normal", "high"]);
  assert.deepEqual(schema.required, ["category", "priority", "draft", "needs_review"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(body.provider.require_parameters, true);
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user"]);
  assert.match(JSON.stringify(body.messages[0].content), /Pracowni z Oknem na Świat/);
  assert.doesNotMatch(JSON.stringify(body.messages[1].content), /Reguły kategorii/);
});
