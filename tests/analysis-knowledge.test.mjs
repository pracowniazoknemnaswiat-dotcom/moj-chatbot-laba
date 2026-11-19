// Analiza wiadomości z bazą wiedzy: filtr dokumentów, zapytania, strażnik kwot i luk.
// Bez sieci i bez płatnych wywołań.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { completion, json, mockModel, requests } from "./support/mock-openrouter.mjs";

registerHooks({
  resolve: (s, c, n) => (s === "server-only" ? { url: "data:text/javascript,", shortCircuit: true } : n(s, c)),
});
const { analysisQueries, isPracowniaDocument, mergeAnalysisMatches } = await import("../lib/knowledge-search.ts");
const { guardResult, sourceTitles } = await import("../lib/guard.ts");
const { analyzeMessage, ANALYSIS_INSTRUCTIONS } = await import("../lib/triage.ts");
const { KNOWLEDGE_GAP } = await import("../lib/studio-nova.ts");

const CENNIK = { tytul: "Cennik Pracowni", tresc: "Kurs grupowy (30 godzin) kosztuje 2199 zł.", podobienstwo: 0.8 };
const FAQ = { tytul: "FAQ Pracowni", tresc: "Można płacić w 6 ratach, bez odsetek.", podobienstwo: 0.7 };
const wiedza = (fragments = [CENNIK, FAQ], error = null) => ({ fragments, error });
const szkic = (draft, needs_review = false) => ({ category: "sales", priority: "normal", draft, needs_review });

test("tylko dokumenty Pracowni (tytuł kończy się na „Pracowni”)", () => {
  assert.ok(isPracowniaDocument("FAQ Pracowni"));
  assert.ok(isPracowniaDocument("  Regulamin pracowni "));
  assert.ok(!isPracowniaDocument("FAQ"));
  assert.ok(!isPracowniaDocument("Cennik 2026"));
  assert.ok(!isPracowniaDocument(null));
});

test("zapytania: cała wiadomość + każde pytanie osobno", () => {
  const q = analysisQueries(
    "Dzień dobry, ile kosztuje kurs do egzaminu ósmoklasisty z matematyki i czy można płacić w ratach? Czy macie parking?",
  );
  assert.equal(q.length, 3);
  assert.equal(q[2], "Czy macie parking?");
});

test("łączenie wyników: bez Kwantowego Borsuka, bez powtórzeń, od najlepszego", () => {
  const f = mergeAnalysisMatches([
    [
      { id: 1, title: "Cennik 2026", content: "Pakiet Start 490 zł", similarity: 0.95 },
      { id: 2, title: "Cennik Pracowni", content: "Kurs 2199 zł", similarity: 0.6 },
    ],
    [
      { id: 2, title: "Cennik Pracowni", content: "Kurs 2199 zł", similarity: 0.7 },
      { id: 3, title: "FAQ Pracowni", content: "Raty", similarity: 0.65 },
      { id: 4, title: "FAQ", content: "Borsuk", similarity: 0.9 },
    ],
  ]);
  assert.deepEqual(
    f.map((x) => [x.tytul, x.podobienstwo]),
    [["Cennik Pracowni", 0.7], ["FAQ Pracowni", 0.65]],
  );
});

test("strażnik: kwota z fragmentu i poprawne źródło – bez uwag", () => {
  const r = guardResult("Ile kosztuje kurs?", szkic("Kurs kosztuje 2199 zł.\n📎 Źródło: Cennik Pracowni"), wiedza());
  assert.deepEqual(r.checks, []);
  assert.equal(r.result.needs_review, false);
});

test("strażnik: kwota spoza fragmentów (np. ze stałego cennika) – sprawdzenie", () => {
  const r = guardResult("Ile kosztuje?", szkic("Korepetycje: 130 zł.\n📎 Źródło: Cennik Pracowni"), wiedza());
  assert.ok(r.checks.some((c) => c.includes("spoza cennika we fragmentach") && c.includes("130 zł")));
  assert.equal(r.result.needs_review, true);
});

test("strażnik: luka [brak w bazie wiedzy] wymusza sprawdzenie", () => {
  const r = guardResult("Czy macie parking?", szkic(`Parking: ${KNOWLEDGE_GAP}`), wiedza());
  assert.ok(r.checks.some((c) => c.includes("szkic ma luki")));
  assert.equal(r.result.needs_review, true);
  assert.equal(r.forcedReview, true);
});

test("strażnik: źródło spoza znalezionych dokumentów i kwota bez źródła", () => {
  const obce = guardResult("Cena?", szkic("Kurs: 2199 zł.\n📎 Źródło: Cennik 2026"), wiedza());
  assert.ok(obce.checks.some((c) => c.includes("spoza znalezionych fragmentów: Cennik 2026")));
  const bez = guardResult("Cena?", szkic("Kurs: 2199 zł."), wiedza());
  assert.ok(bez.checks.some((c) => c.includes("bez linii „📎 Źródło”")));
});

test("strażnik: niedostępna baza wiedzy wymusza sprawdzenie", () => {
  const r = guardResult("Cena?", szkic(`Cena: ${KNOWLEDGE_GAP}`), wiedza([], "Baza wiedzy nie odpowiada."));
  assert.ok(r.checks.some((c) => c.includes("baza wiedzy była niedostępna")));
});

test("linia źródła: kilka tytułów, cudzysłowy i nawiasy", () => {
  assert.deepEqual(sourceTitles("Tekst\n📎 Źródło: „Cennik Pracowni”, [FAQ Pracowni]."), ["Cennik Pracowni", "FAQ Pracowni"]);
  assert.deepEqual(sourceTitles("Bez źródła"), []);
});

test("instrukcja analizy: bez cen wpisanych na stałe", () => {
  for (const cena of ["2199", "1599", "160 zł", "130 zł"]) {
    assert.ok(!ANALYSIS_INSTRUCTIONS.includes(cena), `instrukcja zawiera ${cena}`);
  }
  assert.ok(ANALYSIS_INSTRUCTIONS.includes(KNOWLEDGE_GAP));
});

test("analiza: fragmenty trafiają do modelu jako dane, wynik je zwraca", async () => {
  requests.length = 0;
  const r = await analyzeMessage(
    mockModel(completion(json(szkic("Kurs kosztuje 2199 zł.\n📎 Źródło: Cennik Pracowni", false)))),
    "Ile kosztuje kurs?",
    wiedza(),
  );
  assert.equal(r.ok, true);
  assert.equal(r.knowledge.fragments.length, 2);
  const wyslane = JSON.stringify(requests.at(-1).messages);
  assert.match(wyslane, /BAZA_[0-9a-f]{16}/);
  assert.ok(wyslane.includes("Kurs grupowy (30 godzin) kosztuje 2199 zł."));
  assert.match(wyslane, /KLIENT_[0-9a-f]{16}/);
});

test("czat i analiza mają osobne instrukcje – format szkicu tylko w analizie", async () => {
  const { CHAT_BASE } = await import("../lib/studio-nova.ts");
  for (const zdanie of ["Pomagasz przygotowywać szkice", "Przygotowujesz wyłącznie szkic"]) {
    assert.ok(ANALYSIS_INSTRUCTIONS.includes(zdanie), `analiza powinna mieć: ${zdanie}`);
    assert.ok(!CHAT_BASE.includes(zdanie), `czat nie powinien mieć: ${zdanie}`);
  }
});

test("instrukcja czatu bez cen i rat – te są tylko w bazie wiedzy", async () => {
  const { CHAT_BASE } = await import("../lib/studio-nova.ts");
  assert.doesNotMatch(CHAT_BASE, /\d+\s*zł|złot|\b(2199|1599|160|130)\b|\b[68] rat/);
  assert.match(CHAT_BASE, /Korepetycje: wyłącznie indywidualne, stacjonarnie w Warszawie i online/);
});
