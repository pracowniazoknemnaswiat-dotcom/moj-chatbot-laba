import { tool } from "ai";
import { z } from "zod";

const TIME_ZONE = "Europe/Warsaw";

// Bieżąca data i godzina w Polsce. Osobna funkcja, żeby dało się ją testować
// z dowolną datą.
export function currentTimeInWarsaw(now: Date = new Date()) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pl-PL", { timeZone: TIME_ZONE, ...options }).format(now);

  // Data w formacie RRRR-MM-DD (sv-SE daje właśnie taki układ).
  const isoDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return {
    data: isoDate,
    dataSlownie: part({ day: "numeric", month: "long", year: "numeric" }),
    dzienTygodnia: part({ weekday: "long" }),
    godzina: part({ hour: "2-digit", minute: "2-digit", hour12: false }),
    strefaCzasowa: TIME_ZONE,
  };
}

export const aktualnyCzas = tool({
  description:
    "Zwraca dzisiejszą datę, dzień tygodnia i aktualną godzinę w Polsce " +
    "(strefa Europe/Warsaw). Użyj zawsze, gdy odpowiedź zależy od dzisiejszej " +
    "daty lub godziny: pytania o „dziś”, „jutro”, „wczoraj”, „w ten weekend”, " +
    "„za ile dni”, „ile zostało do” (np. do egzaminu), jaki jest dzień tygodnia " +
    "albo która godzina. Nie zgaduj daty – najpierw wywołaj to narzędzie.",
  inputSchema: z.object({}),
  execute: async () => currentTimeInWarsaw(),
});
