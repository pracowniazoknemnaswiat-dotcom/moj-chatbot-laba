// Narzędzia agenta (lib/tools.ts). Zewnętrzne API są podmienione (fetch),
// więc testy nie potrzebują internetu.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  _wyczyscPamiecWojewodztw,
  aktualnyCzasWStrefie,
  biezacyRokSzkolny,
  ferie,
  createDiagnostykaTool,
  currentTimeInWarsaw,
  czas,
  kalkulator,
  listaNotatek,
  notatki,
  pogoda,
  policz,
  stanZmiennych,
  swieta,
  waluty,
  wikipedia,
} from "../lib/tools.ts";

const opcje = { toolCallId: "t1", messages: [] };
const oryginalnyFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = oryginalnyFetch;
});

/** Podmienia fetch: odpowiedź zależy od fragmentu adresu. */
function udawajFetch(trasy) {
  const wywolania = [];
  globalThis.fetch = async (url) => {
    wywolania.push(String(url));
    const klucz = Object.keys(trasy).find((k) => String(url).includes(k));
    const odp = klucz ? trasy[klucz] : { status: 404, body: {} };
    if (odp === "awaria") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(odp.body), { status: odp.status ?? 200 });
  };
  return wywolania;
}

// ── czas ──
test("czas: zimą Warszawa = UTC+1", () => {
  const r = currentTimeInWarsaw(new Date("2026-11-10T22:30:00Z"));
  assert.equal(r.data, "2026-11-10");
  assert.equal(r.dzienTygodnia, "wtorek");
  assert.equal(r.godzina, "23:30");
});

test("czas: inna strefa (Tokio)", () => {
  const r = aktualnyCzasWStrefie("Asia/Tokyo", new Date("2026-11-10T22:30:00Z"));
  assert.equal(r.data, "2026-11-11");
  assert.equal(r.godzina, "07:30");
});

test("czas: dzień tygodnia dowolnej daty i przesunięcie o dni (koniec ferii → poniedziałek)", async () => {
  const r = await czas.execute({ data: "2027-02-14" }, opcje);
  assert.equal(r.dzienTygodnia, "niedziela");
  const poFeriach = await czas.execute({ data: "2027-02-14", dniPozniej: 1 }, opcje);
  assert.equal(poFeriach.data, "2027-02-15");
  assert.equal(poFeriach.dzienTygodnia, "poniedziałek");
  // przejście przez koniec miesiąca i roku przestępnego
  assert.equal((await czas.execute({ data: "2028-02-28", dniPozniej: 1 }, opcje)).data, "2028-02-29");
  assert.match((await czas.execute({ data: "2027-02-30" }, opcje)).blad, /Nieprawidłowa data/);
});

test("czas: nieznana strefa = czytelny błąd", async () => {
  const r = await czas.execute({ strefa: "Mars/Olympus" }, opcje);
  assert.match(r.blad, /Nieznana strefa/);
  const ok = await czas.execute({}, opcje);
  assert.equal(ok.strefaCzasowa, "Europe/Warsaw");
});

// ── kalkulator ──
test("kalkulator: działania i ułamki bez „ogonów”", () => {
  assert.equal(policz("dodawanie", 0.1, 0.2).wynik, 0.3);
  assert.equal(policz("procent", 15, 2199).wynik, 329.85);
  assert.equal(policz("pierwiastek", 81).wynik, 9);
  assert.equal(policz("zaokraglanie", 3.14159, 2).wynik, 3.14);
});

test("kalkulator: dzielenie przez zero i brak drugiej liczby", async () => {
  assert.match(policz("dzielenie", 5, 0).blad, /zero/);
  assert.match((await kalkulator.execute({ operacja: "mnozenie", a: 2 }, opcje)).blad, /dwóch liczb/);
});

test("kalkulator: tekst zamiast liczby odrzuca schemat", () => {
  const r = kalkulator.inputSchema.safeParse({ operacja: "dodawanie", a: "2+2", b: 1 });
  assert.equal(r.success, false);
});

// ── notatki ──
test("notatki: zapis i odczyt", async () => {
  listaNotatek().length = 0;
  const z = await notatki.execute({ akcja: "zapisz", tresc: "Zadzwonić do Igora" }, opcje);
  assert.equal(z.zapisano.nr, 1);
  const p = await notatki.execute({ akcja: "pokaz" }, opcje);
  assert.equal(p.liczba, 1);
  assert.equal(p.notatki[0].tresc, "Zadzwonić do Igora");
  assert.match((await notatki.execute({ akcja: "zapisz" }, opcje)).blad, /treść/);
});

// ── diagnostyka ──
test("diagnostyka: tylko tak/nie, nigdy wartości", async () => {
  const stan = stanZmiennych({ OPENROUTER_API_KEY: "sk-tajne", OPENROUTER_MODEL: " " });
  assert.equal(stan.OPENROUTER_API_KEY, "tak");
  assert.equal(stan.OPENROUTER_MODEL, "nie");
  assert.equal(stan.CHAT_PASSWORD, "nie");
  const d = createDiagnostykaTool({ model: "m", narzedzia: ["a", "diagnostyka"], limitKrokow: 5 });
  const r = await d.execute({}, opcje);
  assert.equal(r.limitKrokow, 5);
  assert.ok(!JSON.stringify(r).includes("sk-"), "wynik nie może zawierać wartości klucza");
});

// ── waluty ──
test("waluty: kurs EUR i przeliczenie w obie strony", async () => {
  udawajFetch({
    "/rates/A/EUR/": { body: { currency: "euro", code: "EUR", rates: [{ effectiveDate: "2026-11-12", mid: 4.4018 }] } },
  });
  const r = await waluty.execute({ waluta: "eur", kwota: 100 }, opcje);
  assert.equal(r.kursPLN, 4.4018);
  assert.equal(r.wynik, 440.18);
  assert.match(r.pobrano, /czas polski/);
  const odwrotnie = await waluty.execute({ waluta: "EUR", kwota: 440.18, kierunek: "ze_zlotych" }, opcje);
  assert.equal(odwrotnie.wynik, 100);
});

test("waluty: nieznana waluta i awaria serwisu", async () => {
  udawajFetch({});
  assert.match((await waluty.execute({ waluta: "XYZ" }, opcje)).blad, /nie publikuje/);
  udawajFetch({ "api.nbp.pl": "awaria" });
  assert.match((await waluty.execute({ waluta: "EUR" }, opcje)).blad, /Nie udało się/);
  assert.match((await waluty.execute({ waluta: "PLN" }, opcje)).blad, /bazowa/);
});

// ── pogoda ──
test("pogoda: miasto + prognoza", async () => {
  udawajFetch({
    "geocoding-api": { body: { results: [{ name: "Kraków", country: "Polska", latitude: 50.06, longitude: 19.94, timezone: "Europe/Warsaw" }] } },
    "api.open-meteo.com": {
      body: { daily: { time: ["2026-11-13"], weather_code: [61], temperature_2m_max: [7.7], temperature_2m_min: [2.5], precipitation_sum: [10.8], precipitation_probability_max: [100], wind_speed_10m_max: [18.7] } },
    },
  });
  const dzis = aktualnyCzasWStrefie("Europe/Warsaw").data;
  const r = await pogoda.execute({ miasto: "Kraków", dzien: dzis }, opcje);
  assert.equal(r.miasto, "Kraków");
  assert.equal(r.opis, "słaby deszcz");
  assert.equal(r.temperaturaMaksC, 7.7);
  assert.ok(r.pobrano);
});

test("pogoda: nieznane miasto i zbyt odległa data", async () => {
  udawajFetch({ "geocoding-api": { body: {} } });
  assert.match((await pogoda.execute({ miasto: "Xyzzyx" }, opcje)).blad, /Nie znalazłem miasta/);
  udawajFetch({ "geocoding-api": { body: { results: [{ name: "Kraków", latitude: 1, longitude: 1, timezone: "Europe/Warsaw" }] } } });
  assert.match((await pogoda.execute({ miasto: "Kraków", dzien: "2099-01-01" }, opcje)).blad, /15 dni/);
});

// ── święta ──
test("swieta: lista i nieznany kraj", async () => {
  udawajFetch({ "/PublicHolidays/2027/PL": { body: [{ date: "2027-01-01", localName: "Nowy Rok", name: "New Year's Day", global: true }] } });
  const r = await swieta.execute({ kraj: "pl", rok: 2027 }, opcje);
  assert.equal(r.liczba, 1);
  assert.equal(r.swieta[0].nazwa, "Nowy Rok");
  udawajFetch({});
  assert.match((await swieta.execute({ kraj: "XX", rok: 2027 }, opcje)).blad, /Brak danych/);
});

// ── ferie ──
const WOJ = [
  { code: "PL-MZ", shortName: "MZ", name: [{ language: "PL", text: "Mazowieckie" }] },
  { code: "PL-LB", shortName: "LB", name: [{ language: "PL", text: "Lubelskie" }] },
  { code: "PL-MA", shortName: "MA", name: [{ language: "PL", text: "Małopolskie" }] },
];
const FERIE = [
  { startDate: "2027-02-01", endDate: "2027-02-14", name: [{ language: "PL", text: "Ferie zimowe" }], nationwide: false, subdivisions: [{ code: "PL-MZ" }] },
];

test("ferie: bieżący rok szkolny liczony od września", () => {
  assert.equal(biezacyRokSzkolny(new Date("2026-11-12T10:00:00Z")), "2026/2027");
  assert.equal(biezacyRokSzkolny(new Date("2027-03-01T10:00:00Z")), "2026/2027");
  assert.equal(biezacyRokSzkolny(new Date("2027-09-01T10:00:00Z")), "2027/2028");
});

test("ferie: województwo po nazwie (z „województwo” i bez polskich znaków)", async () => {
  _wyczyscPamiecWojewodztw();
  const adresy = udawajFetch({ "/Subdivisions": { body: WOJ }, "/SchoolHolidays": { body: FERIE } });
  const r = await ferie.execute({ wojewodztwo: "Województwo mazowieckie", rokSzkolny: "2026/2027" }, opcje);
  assert.equal(r.wojewodztwo, "mazowieckie");
  assert.deepEqual(r.okresy, [{ nazwa: "Ferie zimowe", od: "2027-02-01", do: "2027-02-14" }]);
  assert.match(r.uwaga, /MEN/); // brak wakacji w danych = ostrzeżenie
  assert.ok(adresy.some((a) => a.includes("subdivisionCode=PL-MZ")));
  const bezZnakow = await ferie.execute({ wojewodztwo: "malopolskie", rokSzkolny: "2026/2027" }, opcje);
  assert.equal(bezZnakow.wojewodztwo, "małopolskie");
});

test("ferie: nieznane województwo, zły rok i awaria serwisu", async () => {
  _wyczyscPamiecWojewodztw();
  udawajFetch({ "/Subdivisions": { body: WOJ }, "/SchoolHolidays": { body: FERIE } });
  assert.match((await ferie.execute({ wojewodztwo: "bawarskie" }, opcje)).blad, /Nie znam województwa.*mazowieckie/);
  assert.match((await ferie.execute({ rokSzkolny: "2026/2028" }, opcje)).blad, /Nieprawidłowy rok/);
  _wyczyscPamiecWojewodztw();
  udawajFetch({ "openholidaysapi.org": "awaria" });
  assert.match((await ferie.execute({ wojewodztwo: "mazowieckie" }, opcje)).blad, /Nie udało się/);
});

// ── wikipedia ──
test("wikipedia: streszczenie, a gdy brak tytułu – wyszukiwanie", async () => {
  const adresy = udawajFetch({
    "summary/sklodowska": { status: 404, body: {} },
    "opensearch": { body: ["sklodowska", ["Maria Skłodowska-Curie"], [""], [""]] },
    "summary/Maria_Sk": {
      body: { title: "Maria Skłodowska-Curie", type: "standard", extract: "Polska fizyczka i chemiczka.", content_urls: { desktop: { page: "https://pl.wikipedia.org/wiki/Maria_Sk%C5%82odowska-Curie" } } },
    },
  });
  const r = await wikipedia.execute({ haslo: "sklodowska" }, opcje);
  assert.equal(r.tytul, "Maria Skłodowska-Curie");
  assert.match(r.link, /^https:\/\/pl\.wikipedia\.org/);
  assert.ok(adresy.some((a) => a.includes("opensearch")));
});
