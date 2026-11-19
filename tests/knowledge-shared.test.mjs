import assert from "node:assert/strict";
import test from "node:test";
import {
  answerUsesFragment,
  formatVersionDate,
  fragmentsLabel,
  normalizeTitle,
  sameTitle,
  similarityPercent,
  STAGE_LABELS,
  usedSources,
  withoutSourceLine,
} from "../lib/knowledge-shared.ts";

test("ten sam tytuł: wielkość liter i spacje nie mają znaczenia", () => {
  assert.ok(sameTitle("Cennik 2026", "  cennik   2026 "));
  assert.ok(sameTitle("ZAJĘCIA ŁÓDŹ", "zajęcia łódź"));
  assert.ok(!sameTitle("Cennik 2026", "Cennik 2027"));
  assert.equal(normalizeTitle(" A  b "), "a b");
});

test("odmiana: fragment / fragmenty / fragmentów", () => {
  assert.equal(fragmentsLabel(1), "1 fragment");
  assert.equal(fragmentsLabel(2), "2 fragmenty");
  assert.equal(fragmentsLabel(4), "4 fragmenty");
  assert.equal(fragmentsLabel(5), "5 fragmentów");
  assert.equal(fragmentsLabel(12), "12 fragmentów");
  assert.equal(fragmentsLabel(14), "14 fragmentów");
  assert.equal(fragmentsLabel(22), "22 fragmenty");
  assert.equal(fragmentsLabel(0), "0 fragmentów");
});

test("etapy importu mają polskie etykiety", () => {
  assert.deepEqual(STAGE_LABELS, {
    split: "Dzielę tekst…",
    embed: "Tworzę embeddingi…",
    save: "Zapisuję…",
  });
});

test("wersja = data w czasie polskim", () => {
  // 23:30 UTC 19 listopada = 00:30 20 listopada w Warszawie
  assert.match(formatVersionDate("2026-11-19T23:30:00Z"), /20 lis 2026.*00:30/);
});


const wynik = {
  fragmenty: [
    { tytul: "Regulamin Pracowni", tresc: "5. Lekcję można odwołać do 10:00.", podobienstwo: 0.813 },
    { tytul: "FAQ Pracowni", tresc: "Grupy 4–12 osób.", podobienstwo: 0.512 },
  ],
  uwaga: "…",
};

test("źródła: tylko dokumenty z linii „📎 Źródło”, każdy fragment raz", () => {
  const s = usedSources([wynik, wynik], "Do 10:00.\n\n📎 Źródło: Regulamin Pracowni");
  assert.deepEqual(s.map((f) => [f.tytul, f.podobienstwo]), [["Regulamin Pracowni", 0.813]]);
});

test("źródła: z wymienionego dokumentu tylko fragmenty użyte w odpowiedzi", () => {
  const cennik = {
    fragmenty: [
      { tytul: "Cennik Pracowni", tresc: "Korepetycje kosztują 130 zł za godzinę zegarową.", podobienstwo: 0.74 },
      { tytul: "Cennik Pracowni", tresc: "Przygotowanie do olimpiad kosztuje 169 zł.", podobienstwo: 0.51 },
    ],
  };
  const s = usedSources([cennik], "Korepetycje: 130 zł za godzinę.\n📎 Źródło: Cennik Pracowni");
  assert.deepEqual(s.map((f) => f.podobienstwo), [0.74]);
});

test("źródła: wspólne „10” (pakiet 10 godzin, 10% zniżki) nie czyni fragmentu źródłem", () => {
  const odp = "Korepetycje: 130 zł za godzinę, pakiet 10 godzin – 1299 zł.";
  assert.ok(answerUsesFragment(odp, "Korepetycje kosztują 130 zł. Pakiet 10 godzin kosztuje 1299 zł."));
  assert.ok(!answerUsesFragment(odp, "Olimpiady: 1699 zł za pakiet 10 godzin zajęć."));
  assert.ok(!answerUsesFragment(odp, "Przy trzecim kursie udzielamy 10% zniżki."));
  assert.ok(answerUsesFragment("Do 10:00 w dniu zajęć.", "Lekcję można odwołać do godziny 10:00."));
});

test("źródła: gdy nic nie pasuje dosłownie – najlepszy fragment wymienionego dokumentu", () => {
  const s = usedSources([wynik], "Tak, oczywiście.\n📎 Źródło: FAQ Pracowni");
  assert.deepEqual(s.map((f) => f.tytul), ["FAQ Pracowni"]);
});

test("źródła: brak linii „📎 Źródło” = odpowiedź nie z bazy = brak listy", () => {
  assert.deepEqual(usedSources([wynik], "Nie mam tej informacji w bazie wiedzy."), []);
});

test("źródła: dziwne dane z narzędzia są pomijane", () => {
  assert.deepEqual(usedSources([null, { fragmenty: [{ tytul: 1 }] }, { blad: "x" }], "📎 Źródło: X"), []);
});

test("procenty i usunięcie linii źródła (także pogrubionej)", () => {
  assert.equal(similarityPercent(0.8134), "81%");
  assert.equal(withoutSourceLine("Tekst\n\n**📎 Źródło: FAQ Pracowni**"), "Tekst");
});
