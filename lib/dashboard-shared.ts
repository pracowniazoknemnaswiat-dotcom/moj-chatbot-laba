// Stałe i typy asystenta podróży wspólne dla serwera i przeglądarki.
// Bez importów kodu serwerowego – ten plik trafia też do przeglądarki.

export const RODZAJE_KART = ["pogoda", "waluty", "swieta", "wikipedia", "czas"] as const;
export type RodzajKarty = (typeof RODZAJE_KART)[number];

/** Tytuł i źródło każdej karty – także wtedy, gdy danych zabrakło. */
export const OPIS_KART: Record<RodzajKarty, { tytul: string; zrodlo: string }> = {
  pogoda: { tytul: "Pogoda", zrodlo: "Open-Meteo" },
  waluty: { tytul: "Waluta", zrodlo: "NBP" },
  swieta: { tytul: "Święta", zrodlo: "Nager.Date" },
  wikipedia: { tytul: "O mieście", zrodlo: "Wikipedia (pl)" },
  czas: { tytul: "Czas na miejscu", zrodlo: "zegar serwera + strefa z Open-Meteo" },
};

export type Karta = {
  tytul: string;
  wartosc: string | null;
  jednostka?: string;
  szczegoly?: string;
  link?: string | null;
  zrodlo: string;
  pobrano: string;
  blad?: string;
};

export type MiejscePodrozy = {
  nazwa: string;
  kraj: string | null;
  kodKraju: string | null;
  strefa: string;
};

export type DanePodrozy = {
  miejsce: MiejscePodrozy;
  data: string;
  karty: Record<RodzajKarty, Karta>;
};
