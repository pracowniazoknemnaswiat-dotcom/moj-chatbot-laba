// Pętla agenta: limity, liczniki i lista kroków do pokazania w czacie.
import type { ToolSet } from "ai";

/** Najwyżej tyle kroków modelu na jedno zadanie (wywołania narzędzi + odpowiedź). */
export const LIMIT_KROKOW = 6;
/** Najwyżej tyle wywołań narzędzi na jedno zadanie (liczone osobno od kroków). */
export const LIMIT_WYWOLAN = 16;
/** Najwyżej tyle czasu na całe zadanie – potem twarde przerwanie. */
export const LIMIT_CZASU_MS = 60_000;
/** Po tym czasie agent dostaje polecenie, żeby kończyć (zdąży podsumować przed 60 s). */
export const MIEKKI_LIMIT_CZASU_MS = 45_000;
/** Najwyżej tyle jedno narzędzie czeka na odpowiedź zewnętrznego API. */
export const LIMIT_CZASU_NARZEDZIA_MS = 10_000;

export type PowodZatrzymania = "kroki" | "wywolania" | "czas";

/** Liczniki jednego zadania (jednej odpowiedzi agenta). */
export type Licznik = {
  start: number;
  wywolania: number;
  /** Wywołania, które się nie udały – klucz: narzędzie + dane wejściowe. */
  nieudane: Set<string>;
  powod: PowodZatrzymania | null;
};

export function nowyLicznik(teraz: number = Date.now()): Licznik {
  return { start: teraz, wywolania: 0, nieudane: new Set(), powod: null };
}

/** Komunikat dla użytkownika, gdy agent zatrzymał się na limicie. */
export function komunikatZatrzymania(powod: PowodZatrzymania): string {
  switch (powod) {
    case "kroki":
      return `Zatrzymałem się po ${LIMIT_KROKOW} krokach.`;
    case "wywolania":
      return `Zatrzymałem się po ${LIMIT_WYWOLAN} wywołaniach narzędzi.`;
    case "czas":
      return `Zatrzymałem się po ${LIMIT_CZASU_MS / 1000} sekundach.`;
  }
}

/**
 * Dla prepareStep. Gdy to ostatni dozwolony krok, wyczerpano wywołania narzędzi
 * albo kończy się czas – wyłącza narzędzia i każe modelowi podsumować to, co ustalił.
 * stepNumber liczy się od 0, więc ostatni krok to LIMIT_KROKOW - 1.
 */
export function ustawieniaKroku(
  stepNumber: number,
  instrukcjeBazowe: string,
  licznik: Licznik = nowyLicznik(),
  teraz: number = Date.now(),
) {
  let powod: PowodZatrzymania | null = null;
  if (licznik.wywolania >= LIMIT_WYWOLAN) powod = "wywolania";
  else if (teraz - licznik.start >= MIEKKI_LIMIT_CZASU_MS) powod = "czas";
  else if (stepNumber >= LIMIT_KROKOW - 1) powod = "kroki";
  if (!powod) return undefined;

  licznik.powod = powod;
  return {
    toolChoice: "none" as const,
    instructions: `${instrukcjeBazowe}

TO JEST OSTATNI KROK – ${komunikatZatrzymania(powod)} Nie wywołuj już narzędzi.
Na podstawie dotychczasowych wyników napisz, co udało się ustalić, oraz wprost,
czego nie udało się sprawdzić ani zrobić (np. zapisu w notatkach) – z powodu limitu,
a nie awarii narzędzi. Nie twierdź, że wykonałeś czynność, której nie wykonałeś.
Użytkownik może o to dopytać lub poprosić o dokończenie w kolejnej wiadomości.`,
  };
}

// ───────────────────────── opakowanie narzędzi ─────────────────────────

type Wynik = unknown;
const czyBlad = (w: Wynik) => typeof w === "object" && w !== null && "blad" in w;

/**
 * Każde wykonywane u nas narzędzie: liczy wywołania (limit LIMIT_WYWOLAN)
 * i nie pozwala powtarzać wywołania, które przed chwilą zakończyło się błędem.
 * Narzędzia po stronie dostawcy (np. web_search, bez execute) zostają bez zmian
 * – ich wywołania liczy route.ts ze strumienia.
 */
export function zLimitami<T extends ToolSet>(narzedzia: T, licznik: Licznik): T {
  const wynik: Record<string, unknown> = {};
  for (const [nazwa, narzedzie] of Object.entries(narzedzia)) {
    const execute = (narzedzie as { execute?: (...a: unknown[]) => Promise<Wynik> }).execute;
    if (typeof execute !== "function") {
      wynik[nazwa] = narzedzie;
      continue;
    }
    wynik[nazwa] = {
      ...narzedzie,
      execute: async (input: unknown, opcje: unknown) => {
        const klucz = `${nazwa}:${JSON.stringify(input)}`;
        if (licznik.nieudane.has(klucz)) {
          return {
            blad:
              "To samo wywołanie przed chwilą się nie udało – nie powtarzaj go. " +
              "Podaj wynik częściowy i napisz wprost, czego nie udało się sprawdzić.",
          };
        }
        if (licznik.wywolania >= LIMIT_WYWOLAN) {
          licznik.powod ??= "wywolania";
          return {
            blad: `Wykorzystano limit ${LIMIT_WYWOLAN} wywołań narzędzi – podsumuj to, co już wiesz.`,
          };
        }
        licznik.wywolania += 1;
        try {
          const w = await execute(input, opcje);
          if (czyBlad(w)) licznik.nieudane.add(klucz);
          return w;
        } catch (e) {
          licznik.nieudane.add(klucz);
          throw e;
        }
      },
    };
  }
  return wynik as T;
}

// ───────────────────────── lista kroków w czacie ─────────────────────────
// W wiadomości z useChat każdy krok modelu zaczyna się od części "step-start".
// Narzędzia to części "tool-<nazwa>" (albo "dynamic-tool" z polem toolName).
// Wyszukiwanie OpenRouter działa po stronie dostawcy i nie zawsze wysyła
// osobną część narzędzia – poznajemy je po źródłach ("source-url").

type CzescWiadomosci = { type: string; toolName?: string };

export type Krok = { nr: number; narzedzia: string[] };

/** Kroki, w których model użył narzędzi (krok z samą odpowiedzią jest pomijany). */
export function krokiZNarzedziami(parts: readonly CzescWiadomosci[]): Krok[] {
  const kroki: Krok[] = [];
  let biezacy: Krok | null = null;
  let nr = 0;

  const dodaj = (nazwa: string) => {
    if (!biezacy) {
      // Wiadomość bez "step-start" (np. starszy zapis) – traktujemy jako krok 1.
      nr += 1;
      biezacy = { nr, narzedzia: [] };
    }
    if (!biezacy.narzedzia.includes(nazwa)) biezacy.narzedzia.push(nazwa);
  };

  for (const p of parts) {
    if (p.type === "step-start") {
      if (biezacy && (biezacy as Krok).narzedzia.length) kroki.push(biezacy);
      nr += 1;
      biezacy = { nr, narzedzia: [] };
    } else if (p.type === "dynamic-tool" && p.toolName) {
      dodaj(p.toolName);
    } else if (p.type.startsWith("tool-")) {
      dodaj(p.type.slice("tool-".length));
    } else if (p.type === "source-url") {
      dodaj("web_search");
    }
  }
  if (biezacy && (biezacy as Krok).narzedzia.length) kroki.push(biezacy);
  return kroki;
}

/** „1. pogoda → 2. waluty + kalkulator” (etykiety z mapy, gdy są). */
export function opisKrokow(kroki: Krok[], etykiety: Record<string, string> = {}): string {
  return kroki
    .map((k) => `${k.nr}. ${k.narzedzia.map((n) => etykiety[n] ?? n).join(" + ")}`)
    .join(" → ");
}

/** „Kroki: 3 · wywołania narzędzi: 4 · czas: 7,2 s” */
export function opisStatystyk(s: { liczbaKrokow?: number; liczbaWywolan?: number; czasMs?: number }) {
  const czesci: string[] = [];
  if (s.liczbaKrokow !== undefined) czesci.push(`kroki: ${s.liczbaKrokow}`);
  if (s.liczbaWywolan !== undefined) czesci.push(`wywołania narzędzi: ${s.liczbaWywolan}`);
  if (s.czasMs !== undefined) {
    czesci.push(`czas: ${(s.czasMs / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s`);
  }
  if (!czesci.length) return "";
  const tekst = czesci.join(" · ");
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}
