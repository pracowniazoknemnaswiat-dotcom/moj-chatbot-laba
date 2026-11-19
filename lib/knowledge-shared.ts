// Wspólne dla serwera i przeglądarki (strona /upload): etapy importu,
// porównanie tytułów, odmiana „fragment”. Bez bazy i bez kluczy.

export type ImportStage = "split" | "embed" | "save";

export const STAGE_LABELS: Record<ImportStage, string> = {
  split: "Dzielę tekst…",
  embed: "Tworzę embeddingi…",
  save: "Zapisuję…",
};

/** Nazwa etapu w komunikacie o błędzie: „na etapie: tworzenie embeddingów”. */
export const STAGE_NAMES: Record<ImportStage, string> = {
  split: "dzielenie tekstu",
  embed: "tworzenie embeddingów",
  save: "zapis w bazie",
};

/** Dokument na liście: tytuł = nazwa źródła, data dodania = wersja. */
export type DocumentSummary = {
  id: number;
  title: string;
  /** Data i godzina dodania, sformatowana na serwerze (czas polski). */
  date: string;
  chunkCount: number;
};

/** Zdarzenia wysyłane przez POST /api/documents (jedna linia JSON = jedno zdarzenie). */
export type ImportEvent =
  | { type: "stage"; stage: ImportStage }
  | {
      type: "done";
      title: string;
      chunks: number;
      backfilled: number;
      replaced: number;
      warnings: string[];
    }
  | { type: "error"; stage: ImportStage; error: string; hint: string };

/** Ten sam dokument = ten sam tytuł bez względu na wielkość liter i nadmiarowe spacje. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl-PL");
}

export function sameTitle(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

const SOURCE_LINE = /📎\s*Źródło:\s*(.+)$/imu;

/** Tytuły dokumentów z linii „📎 Źródło: …” w odpowiedzi lub szkicu. */
export function sourceTitles(text: string): string[] {
  const m = text.match(SOURCE_LINE);
  if (!m) return [];
  return m[1]
    .split(/[,;]/)
    .map((t) => t.replace(/^[\s„"“[*_]+|[\s”"\].*_]+$/g, "").trim())
    .filter(Boolean);
}

/** Fragment bazy wiedzy, jak go zwraca narzędzie searchKnowledge. */
export type SourceFragment = { tytul: string; tresc: string; podobienstwo: number };

function isSourceFragment(x: unknown): x is SourceFragment {
  const f = x as SourceFragment | null;
  return (
    typeof f === "object" &&
    f !== null &&
    typeof f.tytul === "string" &&
    typeof f.tresc === "string" &&
    typeof f.podobienstwo === "number"
  );
}

/** Liczby z tekstu (ceny, godziny, procenty): „10:00”, „2199”, „2 199” → „10:00”, „2199”. */
function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(/\d+(?:[:.,]\d+)*(?:[  ]\d{3})*/g)].map((m) => m[0].replace(/[  ]/g, "")));
}

/** Słowa treści (co najmniej 5 liter, bez wielkości liter), np. „odwołać”, „rodzeństwa”. */
function wordsIn(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase("pl-PL").match(/\p{L}{5,}/gu) ?? []);
}

/** Liczba znacząca dla źródła: cena (min. 3 cyfry) albo godzina („10:00”). „10” czy „6” – za częste. */
const isDistinctiveNumber = (n: string) => n.includes(":") || n.replace(/\D/g, "").length >= 3;

/**
 * Czy odpowiedź korzysta z fragmentu.
 *   - Fragment z cenami lub godzinami: decydują tylko one – musi się w odpowiedzi pojawić
 *     choć jedna z nich (słowa typu „pakiet”, „kosztuje” są wspólne dla całego cennika).
 *   - Fragment bez liczb (np. opis TPJ): co najmniej 30% jego słów treści w odpowiedzi.
 */
export function answerUsesFragment(answer: string, fragment: string): boolean {
  const liczbyFragmentu = [...numbersIn(fragment)].filter(isDistinctiveNumber);
  if (liczbyFragmentu.length) {
    const liczby = numbersIn(answer);
    return liczbyFragmentu.some((n) => liczby.has(n));
  }
  const slowaFragmentu = wordsIn(fragment);
  if (slowaFragmentu.size === 0) return false;
  const slowaOdpowiedzi = wordsIn(answer);
  const wspolne = [...slowaFragmentu].filter((w) => slowaOdpowiedzi.has(w)).length;
  return wspolne / slowaFragmentu.size >= 0.3;
}

/**
 * Źródła odpowiedzi: fragmenty zwrócone przez searchKnowledge z dokumentów wymienionych
 * w linii „📎 Źródło”, a z nich tylko te, z których odpowiedź naprawdę korzysta
 * (gdy z danego dokumentu żaden nie pasuje – jego najlepszy fragment). Każdy fragment raz,
 * od najlepiej pasującego. Brak linii źródła = odpowiedź nie z bazy = brak źródeł.
 */
export function usedSources(toolOutputs: unknown[], answer: string): SourceFragment[] {
  const titles = sourceTitles(answer);
  if (!titles.length) return [];
  const unique = new Map<string, SourceFragment>();
  for (const out of toolOutputs) {
    const list = (out as { fragmenty?: unknown } | null)?.fragmenty;
    if (!Array.isArray(list)) continue;
    for (const f of list) {
      if (!isSourceFragment(f) || !titles.some((t) => sameTitle(t, f.tytul))) continue;
      const key = `${normalizeTitle(f.tytul)}\n${f.tresc}`;
      const prev = unique.get(key);
      if (!prev || prev.podobienstwo < f.podobienstwo) unique.set(key, f);
    }
  }
  const all = [...unique.values()].sort((a, b) => b.podobienstwo - a.podobienstwo);
  const tekst = withoutSourceLine(answer);
  const used = all.filter((f) => answerUsesFragment(tekst, f.tresc));
  // Dokument wymieniony w „📎 Źródło”, a żaden jego fragment nie pasuje – pokaż najlepszy.
  for (const t of titles) {
    if (used.some((f) => sameTitle(f.tytul, t))) continue;
    const best = all.find((f) => sameTitle(f.tytul, t));
    if (best) used.push(best);
  }
  return used.sort((a, b) => b.podobienstwo - a.podobienstwo);
}

/** 0.8134 → „81%”. */
export function similarityPercent(similarity: number): string {
  return `${Math.round(similarity * 100)}%`;
}

/** Tekst bez linii „📎 Źródło: …” (lista źródeł jest pokazywana osobno). */
export function withoutSourceLine(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*[*_]*📎\s*Źródło:/u.test(l))
    .join("\n")
    .trimEnd();
}

/** 1 fragment, 2–4 fragmenty, 5 fragmentów, 22 fragmenty, 12 fragmentów. */
export function fragmentsLabel(n: number): string {
  if (n === 1) return "1 fragment";
  const r10 = n % 10;
  const r100 = n % 100;
  const few = r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14);
  return `${n} ${few ? "fragmenty" : "fragmentów"}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});

export function formatVersionDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}
