// Asystent podróży (lib/dashboard.ts). Serwisy zewnętrzne podmienione – bez internetu.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  _wyczyscPamiecMiast,
  brakujaceZrodla,
  danePodrozy,
  dopiszBrakujace,
  kartaPodrozy,
  pierwszeZdania,
  walutaKraju,
} from "../lib/dashboard.ts";
import { roznicaWzgledemPolski } from "../lib/tools.ts";

const oryginalnyFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = oryginalnyFetch;
  _wyczyscPamiecMiast();
});

function udawajFetch(trasy) {
  globalThis.fetch = async (url) => {
    const klucz = Object.keys(trasy).find((k) => String(url).includes(k));
    const odp = klucz ? trasy[klucz] : { status: 404, body: {} };
    if (odp === "awaria") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(odp.body), { status: odp.status ?? 200 });
  };
}

const ROME = { name: "Rzym", country: "Włochy", country_code: "IT", latitude: 41.9, longitude: 12.5, timezone: "Europe/Rome" };
const dzis = new Date().toISOString().slice(0, 10);

test("waluta kraju: strefa euro, złoty, nieznany kraj", () => {
  assert.equal(walutaKraju("IT"), "EUR");
  assert.equal(walutaKraju("gb"), "GBP");
  assert.equal(walutaKraju("PL"), "PLN");
  assert.equal(walutaKraju("ZZ"), null);
});

test("dwa pierwsze zdania", () => {
  assert.equal(pierwszeZdania("Rzym – stolica Włoch. Leży nad Tybrem. Ma 2,8 mln mieszkańców."), "Rzym – stolica Włoch. Leży nad Tybrem.");
  assert.equal(pierwszeZdania("Bez kropki na końcu"), "Bez kropki na końcu");
});

test("różnica czasu względem Polski", () => {
  const zima = new Date("2026-01-15T12:00:00Z");
  assert.equal(roznicaWzgledemPolski("Europe/Rome", zima), 0);
  assert.equal(roznicaWzgledemPolski("Asia/Tokyo", zima), 8);
  assert.equal(roznicaWzgledemPolski("America/New_York", zima), -6);
  assert.equal(roznicaWzgledemPolski("Asia/Kolkata", zima), 4.5);
});

test("pięć kart: wartość, jednostka, źródło i godzina pobrania", async () => {
  udawajFetch({
    "geocoding-api": { body: { results: [ROME] } },
    "api.open-meteo.com": { body: { daily: { time: [dzis], weather_code: [2], temperature_2m_min: [9.5], temperature_2m_max: [17.2], precipitation_sum: [0], precipitation_probability_max: [5], wind_speed_10m_max: [12] } } },
    "/rates/A/EUR/": { body: { currency: "euro", rates: [{ effectiveDate: "2026-11-12", mid: 4.4018 }] } },
    "NextPublicHolidays/IT": { body: [{ date: "2026-12-08", localName: "Immacolata Concezione", name: "Immaculate Conception", global: true }] },
    "summary/Rzym": { body: { title: "Rzym", extract: "Rzym – stolica Włoch. Leży nad Tybrem. Trzecie zdanie.", content_urls: { desktop: { page: "https://pl.wikipedia.org/wiki/Rzym" } } } },
  });
  const d = await danePodrozy("Rzym", dzis);
  assert.equal(d.miejsce.kodKraju, "IT");
  const { pogoda, waluty, swieta, wikipedia, czas } = d.karty;
  assert.equal(pogoda.wartosc, "9,5 … 17,2");
  assert.equal(pogoda.jednostka, "°C");
  assert.equal(waluty.wartosc, "4,4018");
  assert.equal(waluty.jednostka, "zł za 1 EUR");
  assert.match(swieta.wartosc, /8 grudnia 2026/);
  assert.equal(wikipedia.szczegoly, "Rzym – stolica Włoch. Leży nad Tybrem.");
  assert.equal(wikipedia.link, "https://pl.wikipedia.org/wiki/Rzym");
  assert.equal(czas.jednostka, "ta sama godzina co w Polsce");
  for (const k of Object.values(d.karty)) {
    assert.ok(k.zrodlo, `${k.tytul}: brak źródła`);
    assert.match(k.pobrano, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(czas polski\)$/);
  }
});

test("awaria jednego źródła psuje tylko jego kartę; nieznane miasto = komunikat", async () => {
  udawajFetch({
    "geocoding-api": { body: { results: [ROME] } },
    "api.nbp.pl": "awaria",
  });
  const d = await danePodrozy("Rzym", dzis);
  assert.match(d.karty.waluty.blad, /Nie udało się pobrać kursu/);
  assert.equal(d.karty.czas.blad, undefined, "karta czasu działa bez sieci");
  udawajFetch({ "geocoding-api": { body: {} } });
  assert.match((await danePodrozy("Xyzzyx", dzis)).blad, /Nie znalazłem miasta/);
});

test("wielkość liter w nazwie miasta nie ma znaczenia – karty dostają oficjalną nazwę", async () => {
  const zapytania = [];
  const LIZBONA = { name: "Lizbona", country: "Portugalia", country_code: "PT", latitude: 38.7, longitude: -9.1, timezone: "Europe/Lisbon" };
  globalThis.fetch = async (url) => {
    zapytania.push(String(url));
    if (String(url).includes("geocoding-api")) return new Response(JSON.stringify({ results: [LIZBONA] }));
    return new Response("{}", { status: 404 });
  };
  for (const wpis of ["lizbona", "LIZBONA", "Lizbona"]) {
    const d = await danePodrozy(wpis, dzis);
    assert.equal(d.miejsce.nazwa, "Lizbona", wpis);
    assert.equal(d.miejsce.kodKraju, "PT", wpis);
  }
  // Wikipedia pytana o oficjalną nazwę, nie o to, co wpisał użytkownik.
  assert.ok(zapytania.filter((u) => u.includes("wikipedia")).every((u) => u.includes("Lizbona")));
});

test("pojedyncza karta: źródło nie odpowiada → tylko ta karta bez danych, bez wartości zastępczej", async () => {
  udawajFetch({
    "geocoding-api": { body: { results: [ROME] } },
    "api.nbp.pl": "awaria",
    "NextPublicHolidays/IT": { body: [{ date: "2026-12-08", localName: "Immacolata", name: "Immaculate Conception", global: true }] },
  });
  const waluta = await kartaPodrozy("waluty", "Rzym", dzis);
  assert.equal(waluta.karta.wartosc, null, "żadnej wartości zastępczej");
  assert.match(waluta.karta.blad, /Nie udało się pobrać kursu/);
  const swieto = await kartaPodrozy("swieta", "Rzym", dzis);
  assert.match(swieto.karta.wartosc, /8 grudnia/);
  assert.equal(swieto.miejsce.nazwa, "Rzym");
});

test("pogoda bez temperatury = brak danych (nie „–”)", async () => {
  udawajFetch({
    "geocoding-api": { body: { results: [ROME] } },
    "api.open-meteo.com": { body: { daily: { time: [dzis], weather_code: [2], temperature_2m_min: [null], temperature_2m_max: [null] } } },
  });
  const p = await kartaPodrozy("pogoda", "Rzym", dzis);
  assert.equal(p.karta.wartosc, null);
  assert.match(p.karta.blad, /temperatury/);
});

test("miasto szukane raz dla 5 kart (pamięć bez względu na wielkość liter)", async () => {
  let geokodowania = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("geocoding-api")) {
      geokodowania += 1;
      return new Response(JSON.stringify({ results: [ROME] }));
    }
    return new Response("{}", { status: 404 });
  };
  await Promise.all(["pogoda", "waluty"].map((r) => kartaPodrozy(r, "rzym", dzis)));
  await kartaPodrozy("czas", "RZYM", dzis);
  await kartaPodrozy("swieta", "Rzym", dzis);
  assert.ok(geokodowania <= 2, `geokodowań: ${geokodowania}`); // 2 równoległe pierwsze zapytania mogą się minąć
});

test("podsumowanie zawsze wymienia brakujące źródła", () => {
  const karty = {
    pogoda: { tytul: "Pogoda", zrodlo: "Open-Meteo", wartosc: null, blad: "źródło nie odpowiada" },
    waluty: { tytul: "Waluta", zrodlo: "NBP", wartosc: "4,4" },
    czas: { tytul: "Czas na miejscu", zrodlo: "zegar", wartosc: "12:00" },
  };
  const brak = brakujaceZrodla(karty);
  assert.deepEqual(brak, ["Pogoda (Open-Meteo)"]);
  // model zapomniał → dopisujemy
  assert.equal(
    dopiszBrakujace("Weź parasol.", brak),
    "Weź parasol. Brak danych z: Pogoda (Open-Meteo).",
  );
  // model napisał sam → bez zmian
  const juzJest = "Weź euro. Brak danych z: Pogoda (Open-Meteo) – sprawdź prognozę.";
  assert.equal(dopiszBrakujace(juzJest, brak), juzJest);
  assert.equal(dopiszBrakujace("Wszystko gra.", []), "Wszystko gra.");
});

test("Polska: waluta lokalna bez pytania NBP", async () => {
  udawajFetch({ "geocoding-api": { body: { results: [{ ...ROME, name: "Gdańsk", country: "Polska", country_code: "PL", timezone: "Europe/Warsaw" }] } } });
  const d = await danePodrozy("Gdańsk", dzis);
  assert.equal(d.karty.waluty.jednostka, "PLN");
  assert.match(d.karty.waluty.szczegoly, /złotówkami/);
});
