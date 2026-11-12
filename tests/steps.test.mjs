// Lista kroków agenta w czacie (lib/steps.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isStepCount, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  krokiZNarzedziami,
  LIMIT_KROKOW,
  LIMIT_WYWOLAN,
  MIEKKI_LIMIT_CZASU_MS,
  nowyLicznik,
  opisKrokow,
  opisStatystyk,
  ustawieniaKroku,
  zLimitami,
} from "../lib/steps.ts";
import { kalkulator, waluty } from "../lib/tools.ts";

const opcje = { toolCallId: "t1", messages: [] };

test("limit wywołań narzędzi: 16, potem czytelny komunikat zamiast wywołania", async () => {
  const licznik = nowyLicznik();
  const { kalkulator: k } = zLimitami({ kalkulator }, licznik);
  for (let i = 0; i < LIMIT_WYWOLAN; i++) {
    const r = await k.execute({ operacja: "dodawanie", a: i, b: 1 }, opcje);
    assert.equal(r.wynik, i + 1);
  }
  assert.equal(licznik.wywolania, 16);
  const r = await k.execute({ operacja: "dodawanie", a: 100, b: 1 }, opcje);
  assert.match(r.blad, /limit 16 wywołań/);
  assert.equal(licznik.wywolania, 16, "odrzucone wywołanie się nie liczy");
  assert.equal(licznik.powod, "wywolania");
});

test("nieudane wywołanie nie jest powtarzane w kółko", async () => {
  const licznik = nowyLicznik();
  let wywolaniaApi = 0;
  const { psuje } = zLimitami(
    { psuje: { execute: async () => (wywolaniaApi++, { blad: "źródło nie odpowiada" }) } },
    licznik,
  );
  assert.match((await psuje.execute({ x: 1 }, opcje)).blad, /źródło nie odpowiada/);
  assert.match((await psuje.execute({ x: 1 }, opcje)).blad, /nie powtarzaj/);
  assert.equal(wywolaniaApi, 1, "drugie identyczne wywołanie nie dotarło do API");
  await psuje.execute({ x: 2 }, opcje); // inne dane – wolno spróbować
  assert.equal(wywolaniaApi, 2);
});

test("narzędzie po przekroczeniu czasu zwraca „źródło nie odpowiada”", async () => {
  const oryginalny = globalThis.fetch;
  // API, które nie odpowiada – kończy się dopiero przerwaniem.
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  try {
    // AbortSignal.timeout(5) udaje upływ 10 s (ten sam rodzaj przerwania: TimeoutError).
    const r = await waluty.execute({ waluta: "EUR" }, { ...opcje, abortSignal: AbortSignal.timeout(5) });
    assert.match(r.blad, /źródło nie odpowiada \(brak odpowiedzi w 10 s\)/);
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test("ostatni krok: przy limicie wywołań i po 45 s narzędzia są wyłączone", () => {
  const start = 1_000_000;
  assert.equal(ustawieniaKroku(1, "X", nowyLicznik(start), start + 1000), undefined);
  const wyczerpany = { ...nowyLicznik(start), wywolania: LIMIT_WYWOLAN };
  assert.equal(ustawieniaKroku(1, "X", wyczerpany, start + 1000).toolChoice, "none");
  assert.equal(wyczerpany.powod, "wywolania");
  const pozno = nowyLicznik(start);
  assert.match(ustawieniaKroku(1, "X", pozno, start + MIEKKI_LIMIT_CZASU_MS).instructions, /60 sekundach/);
  assert.equal(pozno.powod, "czas");
});

test("po przerwaniu (limit czasu) przeglądarka i tak dostaje metadane ze statystykami", async () => {
  const { toUIMessageStream } = await import("ai");
  // Model, który zaczyna pisać i „zawiesza się”.
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "Częściowy wynik" });
          abortSignal?.addEventListener("abort", () => c.error(abortSignal.reason));
        },
      }),
    }),
  });
  const wynik = streamText({ model, prompt: "x", abortSignal: AbortSignal.timeout(50) });
  const czesci = [];
  const strumien = toUIMessageStream({
    stream: wynik.stream,
    messageMetadata: ({ part }) =>
      part.type === "finish" || part.type === "abort" ? { powodZatrzymania: "czas" } : undefined,
  });
  for await (const c of strumien) czesci.push(c);
  assert.ok(czesci.some((c) => c.type === "text-delta" && c.delta === "Częściowy wynik"));
  assert.ok(
    czesci.some((c) => c.type === "message-metadata" && c.messageMetadata?.powodZatrzymania === "czas"),
    "brak metadanych po przerwaniu",
  );
});

test("statystyki pod odpowiedzią", () => {
  assert.equal(
    opisStatystyk({ liczbaKrokow: 3, liczbaWywolan: 4, czasMs: 7240 }),
    "Kroki: 3 · wywołania narzędzi: 4 · czas: 7,2 s",
  );
});

const zuzycie = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

test("pętla agenta: po 6 krokach koniec, ostatni krok bez narzędzi i z podsumowaniem", async () => {
  const wywolania = [];
  // Model, który przy każdej okazji chce liczyć dalej (nigdy sam nie kończy).
  const model = new MockLanguageModelV4({
    doStream: async (opcje) => {
      wywolania.push(opcje);
      const bezNarzedzi = opcje.toolChoice?.type === "none";
      const chunks = bezNarzedzi
        ? [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "Ustaliłem: 1+1=2." },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: zuzycie },
          ]
        : [
            {
              type: "tool-call",
              toolCallId: `c${wywolania.length}`,
              toolName: "kalkulator",
              input: JSON.stringify({ operacja: "dodawanie", a: 1, b: 1 }),
            },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: zuzycie },
          ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });

  const wynik = streamText({
    model,
    prompt: "Licz w nieskończoność",
    tools: { kalkulator },
    stopWhen: isStepCount(LIMIT_KROKOW),
    prepareStep: ({ stepNumber }) => ustawieniaKroku(stepNumber, "OSTATNI KROK"),
  });

  assert.equal(await wynik.text, "Ustaliłem: 1+1=2.");
  assert.equal((await wynik.steps).length, LIMIT_KROKOW);
  assert.equal(wywolania.length, LIMIT_KROKOW);
  assert.equal(wywolania.at(-1).toolChoice?.type, "none");
  assert.ok(wywolania.slice(0, -1).every((o) => o.toolChoice?.type !== "none"));
  assert.match(JSON.stringify(wywolania.at(-1).prompt), /OSTATNI KROK/);
});

test("limit kroków to rozsądna liczba (docelowo 6)", () => {
  assert.ok(Number.isInteger(LIMIT_KROKOW) && LIMIT_KROKOW >= 2 && LIMIT_KROKOW <= 10);
});

test("kroki po kolei, krok z samą odpowiedzią pomijany", () => {
  const parts = [
    { type: "step-start" }, { type: "tool-pogoda" },
    { type: "step-start" }, { type: "tool-waluty" },
    { type: "step-start" }, { type: "tool-kalkulator" },
    { type: "step-start" }, { type: "text" },
  ];
  assert.equal(opisKrokow(krokiZNarzedziami(parts)), "1. pogoda → 2. waluty → 3. kalkulator");
});

test("dwa narzędzia w jednym kroku i wyszukiwanie po źródłach", () => {
  const parts = [
    { type: "step-start" }, { type: "tool-czas" }, { type: "tool-pogoda" }, { type: "tool-pogoda" },
    { type: "step-start" }, { type: "source-url" }, { type: "source-url" },
    { type: "step-start" }, { type: "dynamic-tool", toolName: "notatki" },
  ];
  assert.equal(
    opisKrokow(krokiZNarzedziami(parts), { web_search: "wyszukiwanie" }),
    "1. czas + pogoda → 2. wyszukiwanie → 3. notatki",
  );
});

test("odpowiedź bez narzędzi = brak listy kroków", () => {
  assert.deepEqual(krokiZNarzedziami([{ type: "step-start" }, { type: "text" }]), []);
});
