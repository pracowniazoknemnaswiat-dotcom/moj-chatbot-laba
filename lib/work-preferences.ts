// Preferencje pracy w Pracowni – stałe klucze w preferences (tabela user_profiles).
// Bez zależności: używane przez serwer (instrukcje agenta, API) i przeglądarkę (/profile).

export const WORK_PREFERENCES = [
  {
    key: "rola_w_firmie",
    label: "Rola w firmie",
    examples: "np. właścicielka, koordynatorka biura",
    aliases: ["rola", "stanowisko", "funkcja", "rola_w_pracowni", "rola_w_firmie"],
  },
  {
    key: "styl_odpowiedzi",
    label: "Preferowany styl odpowiedzi",
    examples: "krótko, w punktach albo szczegółowo",
    aliases: ["styl", "styl_odpowiedzi", "format_odpowiedzi", "długość_odpowiedzi", "dlugosc_odpowiedzi"],
  },
  {
    key: "obszar_pracy",
    label: "Główny obszar pracy",
    examples: "kadry, finanse, kursy, przetargi",
    aliases: ["obszar", "obszar_pracy", "główny_obszar_pracy", "glowny_obszar_pracy", "dział", "dzial"],
  },
] as const;

export type WorkPreferenceKey = (typeof WORK_PREFERENCES)[number]["key"];

export function isWorkPreferenceKey(key: string): key is WorkPreferenceKey {
  return WORK_PREFERENCES.some((p) => p.key === key);
}

/** Wartość z profilu jako tekst (starsze wpisy mogą mieć obiekt albo listę). */
export function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${displayValue(v)}`)
      .join("; ");
  }
  return value === null || value === undefined ? "" : String(value);
}

/** Czytelna nazwa faktu: „ulubione_jedzenie” → „ulubione jedzenie”. */
export function factLabel(key: string): string {
  return WORK_PREFERENCES.find((p) => p.key === key)?.label ?? key.replace(/_/g, " ");
}
