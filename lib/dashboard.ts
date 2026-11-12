// Asystent podróży (/dashboard): pięć kart z tych samych funkcji, których
// używają narzędzia agenta (lib/tools.ts). Każda karta ma wartość z jednostką,
// źródło i godzinę pobrania; błąd jednego źródła nie psuje pozostałych kart.
import {
  aktualnyCzasWStrefie,
  geokoduj,
  kursNBP,
  najblizszeSwieta,
  opisBledu,
  pobrano,
  prognozaDnia,
  roznicaWzgledemPolski,
  streszczenieWikipedii,
  sygnalNarzedzia,
  type Miejsce,
} from "./tools";
import { RODZAJE_KART, type DanePodrozy, type Karta, type RodzajKarty } from "./dashboard-shared";

export { OPIS_KART, RODZAJE_KART } from "./dashboard-shared";
export type { DanePodrozy, Karta, RodzajKarty } from "./dashboard-shared";

// Waluta kraju (kod kraju ISO 3166 → kod waluty ISO 4217). Stała tabela,
// bo darmowe API krajów (REST Countries v3) zostało wyłączone.
const STREFA_EURO = [
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PT", "SK", "SI", "ES", "AD", "MC", "SM", "VA", "ME", "XK",
];
const WALUTY_KRAJOW: Record<string, string> = {
  ...Object.fromEntries(STREFA_EURO.map((k) => [k, "EUR"])),
  PL: "PLN", GB: "GBP", US: "USD", CH: "CHF", LI: "CHF", CZ: "CZK", HU: "HUF", NO: "NOK",
  SE: "SEK", DK: "DKK", IS: "ISK", RO: "RON", UA: "UAH", TR: "TRY", JP: "JPY", CN: "CNY",
  CA: "CAD", AU: "AUD", NZ: "NZD", IL: "ILS", MX: "MXN", BR: "BRL", IN: "INR", KR: "KRW",
  TH: "THB", ZA: "ZAR", EG: "EGP", MA: "MAD", AE: "AED", GE: "GEL", RS: "RSD", MK: "MKD",
  AL: "ALL", BA: "BAM", MD: "MDL", BY: "BYN", HK: "HKD", SG: "SGD", ID: "IDR", MY: "MYR",
  PH: "PHP", VN: "VND", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", TN: "TND", TW: "TWD",
  LK: "LKR", DO: "DOP", KE: "KES", TZ: "TZS", JO: "JOD", AM: "AMD", AZ: "AZN", KZ: "KZT",
};

export function walutaKraju(kodKraju: string | null): string | null {
  return kodKraju ? WALUTY_KRAJOW[kodKraju.toUpperCase()] ?? null : null;
}

const liczba = (n: number, miejsca = 1) =>
  n.toLocaleString("pl-PL", { maximumFractionDigits: miejsca });

const dataSlownie = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("pl-PL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

/** Pierwsze zdania tekstu (prosty podział po kropce, wykrzykniku, pytajniku). */
export function pierwszeZdania(tekst: string, ile = 2): string {
  const zdania = tekst.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [tekst];
  return zdania.slice(0, ile).join("").trim();
}

function kartaBledu(tytul: string, zrodlo: string, e: unknown, co: string): Karta {
  return { tytul, wartosc: null, zrodlo, pobrano: pobrano(), blad: `Nie udało się pobrać ${co}: ${opisBledu(e)}.` };
}

// ── karty ──

async function kartaPogody(miejsce: Miejsce, data: string, przerwanie?: AbortSignal): Promise<Karta> {
  const tytul = "Pogoda";
  try {
    const p = await prognozaDnia(miejsce, data, sygnalNarzedzia(przerwanie));
    if ("blad" in p) return { tytul, wartosc: null, zrodlo: "Open-Meteo", pobrano: pobrano(), blad: p.blad };
    // Bez temperatury nie ma czego pokazać – żadnych wartości zastępczych.
    if (p.temperaturaMinC === null || p.temperaturaMaksC === null) {
      return { tytul, wartosc: null, zrodlo: p.zrodlo, pobrano: p.pobrano, blad: "Źródło nie podało temperatury." };
    }
    const temp = `${liczba(p.temperaturaMinC)} … ${liczba(p.temperaturaMaksC)}`;
    const szczegoly = [
      p.opis,
      p.opadyMm !== null ? `opady ${liczba(p.opadyMm)} mm` : null,
      p.szansaOpadowProc !== null ? `szansa opadów ${p.szansaOpadowProc}%` : null,
      p.wiatrMaksKmh !== null ? `wiatr do ${liczba(p.wiatrMaksKmh)} km/h` : null,
    ].filter(Boolean).join(" · ");
    return { tytul, wartosc: temp, jednostka: "°C", szczegoly, zrodlo: p.zrodlo, pobrano: p.pobrano };
  } catch (e) {
    return kartaBledu(tytul, "Open-Meteo", e, "prognozy");
  }
}

async function kartaWalut(miejsce: Miejsce, przerwanie?: AbortSignal): Promise<Karta> {
  const tytul = "Waluta";
  const kod = walutaKraju(miejsce.kodKraju);
  if (!kod) {
    return {
      tytul, wartosc: null, zrodlo: "NBP", pobrano: pobrano(),
      blad: `Nie wiem, jaka waluta obowiązuje w kraju: ${miejsce.kraj ?? "nieznany"}.`,
    };
  }
  if (kod === "PLN") {
    return {
      tytul, wartosc: "1", jednostka: "PLN", szczegoly: "Na miejscu płacisz złotówkami.",
      zrodlo: "NBP", pobrano: pobrano(),
    };
  }
  try {
    const k = await kursNBP(kod, sygnalNarzedzia(przerwanie));
    if ("blad" in k) return { tytul, wartosc: null, zrodlo: "NBP", pobrano: pobrano(), blad: k.blad };
    return {
      tytul,
      wartosc: liczba(k.kursPLN, 4),
      jednostka: `zł za 1 ${k.kod}`,
      szczegoly: `${k.waluta} · kurs średni z dnia ${k.dataKursu.split("-").reverse().join(".")}`,
      zrodlo: k.zrodlo,
      pobrano: k.pobrano,
    };
  } catch (e) {
    return kartaBledu(tytul, "NBP", e, "kursu");
  }
}

async function kartaSwiat(miejsce: Miejsce, data: string, przerwanie?: AbortSignal): Promise<Karta> {
  const tytul = "Święta";
  if (!miejsce.kodKraju) {
    return { tytul, wartosc: null, zrodlo: "Nager.Date", pobrano: pobrano(), blad: "Nie znam kraju tego miasta." };
  }
  try {
    const s = await najblizszeSwieta(miejsce.kodKraju, sygnalNarzedzia(przerwanie));
    if ("blad" in s) return { tytul, wartosc: null, zrodlo: "Nager.Date", pobrano: pobrano(), blad: s.blad };
    const wCalymKraju = s.swieta.filter((x) => x.wCalymKraju);
    const lista = (wCalymKraju.length ? wCalymKraju : s.swieta).slice(0, 3);
    if (!lista.length) {
      return { tytul, wartosc: "brak", szczegoly: "W najbliższym roku nie ma świąt państwowych.", zrodlo: s.zrodlo, pobrano: s.pobrano };
    }
    const dzis = aktualnyCzasWStrefie(miejsce.strefa).data;
    const zaIle = Math.round((Date.parse(lista[0].data) - Date.parse(dzis)) / 86_400_000);
    const wDniuWyjazdu = s.swieta.find((x) => x.data === data);
    const szczegoly = [
      wDniuWyjazdu ? `⚠️ W dniu wyjazdu święto: ${wDniuWyjazdu.nazwa}.` : null,
      lista.map((x) => `${dataSlownie(x.data)} – ${x.nazwa}`).join("; "),
    ].filter(Boolean).join(" ");
    return {
      tytul,
      wartosc: dataSlownie(lista[0].data),
      jednostka: zaIle === 0 ? "(dziś)" : `(za ${zaIle} ${zaIle === 1 ? "dzień" : "dni"})`,
      szczegoly,
      zrodlo: s.zrodlo,
      pobrano: s.pobrano,
    };
  } catch (e) {
    return kartaBledu(tytul, "Nager.Date", e, "świąt");
  }
}

async function kartaWikipedii(miejsce: Miejsce, przerwanie?: AbortSignal): Promise<Karta> {
  const tytul = "O mieście";
  try {
    const w = await streszczenieWikipedii(miejsce.nazwa, sygnalNarzedzia(przerwanie));
    if ("blad" in w) return { tytul, wartosc: null, zrodlo: "Wikipedia (pl)", pobrano: pobrano(), blad: w.blad };
    return {
      tytul,
      wartosc: w.tytul,
      szczegoly: pierwszeZdania(w.streszczenie, 2),
      link: w.link,
      zrodlo: w.zrodlo,
      pobrano: w.pobrano,
    };
  } catch (e) {
    return kartaBledu(tytul, "Wikipedia (pl)", e, "opisu miasta");
  }
}

function kartaCzasu(miejsce: Miejsce, now: Date = new Date()): Karta {
  const c = aktualnyCzasWStrefie(miejsce.strefa, now);
  const roznica = roznicaWzgledemPolski(miejsce.strefa, now);
  const opisRoznicy =
    roznica === 0
      ? "ta sama godzina co w Polsce"
      : `${roznica > 0 ? "+" : "−"}${liczba(Math.abs(roznica))} h względem Polski`;
  return {
    tytul: "Czas na miejscu",
    wartosc: c.godzina,
    jednostka: opisRoznicy,
    szczegoly: `${c.dzienTygodnia}, ${c.dataSlownie} · strefa ${miejsce.strefa}`,
    zrodlo: "zegar serwera + strefa z Open-Meteo",
    pobrano: pobrano(now),
  };
}

// ── miasto (z pamięcią), pojedyncza karta, wszystkie karty ──

// Strona pobiera 5 kart osobnymi zapytaniami – miasto szukamy raz i pamiętamy 10 minut.
// Zapamiętujemy tylko udane wyszukiwania (błąd sieci nie „przykleja się” na 10 minut).
const PAMIEC_MIAST_MS = 10 * 60_000;
const pamiecMiast = new Map<string, { miejsce: Miejsce | null; kiedy: number }>();

async function znajdzMiasto(miasto: string, przerwanie?: AbortSignal) {
  // Wielkość liter nie ma znaczenia: „lizbona”, „Lizbona” i „LIZBONA” to ten sam klucz
  // i to samo miasto w Open-Meteo; dalej używamy jego oficjalnej nazwy.
  const klucz = miasto.trim().toLocaleLowerCase("pl");
  const zPamieci = pamiecMiast.get(klucz);
  if (zPamieci && Date.now() - zPamieci.kiedy < PAMIEC_MIAST_MS) return zPamieci.miejsce;
  const miejsce = await geokoduj(miasto, sygnalNarzedzia(przerwanie));
  pamiecMiast.set(klucz, { miejsce, kiedy: Date.now() });
  return miejsce;
}

/** Tylko do testów. */
export function _wyczyscPamiecMiast() {
  pamiecMiast.clear();
}

type WynikMiasta = { miejsce: Miejsce } | { blad: string };

async function miejsceLubBlad(miasto: string, przerwanie?: AbortSignal): Promise<WynikMiasta> {
  try {
    const miejsce = await znajdzMiasto(miasto, przerwanie);
    if (!miejsce) return { blad: `Nie znalazłem miasta „${miasto}”. Sprawdź pisownię.` };
    return { miejsce };
  } catch (e) {
    return { blad: `Nie udało się wyszukać miasta: ${opisBledu(e)}.` };
  }
}

const opisMiejsca = (m: Miejsce): DanePodrozy["miejsce"] => ({
  nazwa: m.nazwa, kraj: m.kraj, kodKraju: m.kodKraju, strefa: m.strefa,
});

function zbudujKarte(rodzaj: RodzajKarty, m: Miejsce, data: string, przerwanie?: AbortSignal) {
  switch (rodzaj) {
    case "pogoda": return kartaPogody(m, data, przerwanie);
    case "waluty": return kartaWalut(m, przerwanie);
    case "swieta": return kartaSwiat(m, data, przerwanie);
    case "wikipedia": return kartaWikipedii(m, przerwanie);
    case "czas": return Promise.resolve(kartaCzasu(m));
  }
}

/** Jedna karta (strona pobiera każdą osobno, żeby wolne źródło nie blokowało reszty). */
export async function kartaPodrozy(
  rodzaj: RodzajKarty,
  miasto: string,
  data: string,
  przerwanie?: AbortSignal,
): Promise<{ miejsce: DanePodrozy["miejsce"]; data: string; karta: Karta } | { blad: string }> {
  const m = await miejsceLubBlad(miasto, przerwanie);
  if ("blad" in m) return m;
  return { miejsce: opisMiejsca(m.miejsce), data, karta: await zbudujKarte(rodzaj, m.miejsce, data, przerwanie) };
}

/** Wszystkie karty naraz. Zwraca { blad }, gdy nie znaleziono miasta. */
export async function danePodrozy(
  miasto: string,
  data: string,
  przerwanie?: AbortSignal,
): Promise<DanePodrozy | { blad: string }> {
  const m = await miejsceLubBlad(miasto, przerwanie);
  if ("blad" in m) return m;
  const karty = await Promise.all(RODZAJE_KART.map((r) => zbudujKarte(r, m.miejsce, data, przerwanie)));
  return {
    miejsce: opisMiejsca(m.miejsce),
    data,
    karty: Object.fromEntries(RODZAJE_KART.map((r, i) => [r, karty[i]])) as DanePodrozy["karty"],
  };
}

// ── podsumowanie: których źródeł zabrakło ──

type KartaDoPodsumowania = { tytul: string; zrodlo?: string; wartosc: string | null; blad?: string };

/** „Pogoda (Open-Meteo)” dla każdej karty bez danych. */
export function brakujaceZrodla(karty: Record<string, KartaDoPodsumowania>): string[] {
  return Object.values(karty)
    .filter((k) => k.blad || k.wartosc === null)
    .map((k) => (k.zrodlo ? `${k.tytul} (${k.zrodlo})` : k.tytul));
}

/**
 * Gwarancja, że podsumowanie wymienia brakujące źródła: jeśli model któregoś
 * nie wspomniał, dopisujemy jedno zdanie. Nic poza tym nie zmieniamy.
 */
export function dopiszBrakujace(tekst: string, brakujace: string[]): string {
  if (!brakujace.length) return tekst;
  const maly = tekst.toLocaleLowerCase("pl");
  const pominiete = brakujace.filter((b) => !maly.includes(b.split(" (")[0].toLocaleLowerCase("pl")));
  if (!pominiete.length) return tekst;
  return `${tekst.trim()} Brak danych z: ${pominiete.join(", ")}.`.trim();
}
