"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  OPIS_KART,
  RODZAJE_KART,
  type DanePodrozy,
  type Karta,
  type RodzajKarty,
} from "@/lib/dashboard-shared";
import styles from "./dashboard.module.css";

type Zapytanie = { miasto: string; data: string };
type Podsumowanie = { stan: "brak" | "laduje" | "gotowe" | "blad"; tekst?: string };

// Stan jednej karty. „brak” = źródło nie odpowiedziało albo nie miało danych –
// wtedy NIE pokazujemy żadnej wartości (nic zastępczego ani wymyślonego).
type StanKarty =
  | { stan: "laduje" }
  | { stan: "ok"; karta: Karta }
  | { stan: "brak"; powod: string; pobrano?: string };

const IKONY: Record<RodzajKarty, string> = {
  pogoda: "🌦️", waluty: "💱", swieta: "📅", wikipedia: "📚", czas: "🕒",
};

const wszystkie = (stan: StanKarty) =>
  Object.fromEntries(RODZAJE_KART.map((r) => [r, stan])) as Record<RodzajKarty, StanKarty>;

/** Dzisiejsza data RRRR-MM-DD w strefie przeglądarki. */
function dzisiaj(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Komunikat z odpowiedzi {"error": "..."} albo kod błędu. */
async function bladOdpowiedzi(odp: Response): Promise<string> {
  if (odp.status === 401) return "Sesja wygasła. Odśwież stronę i wpisz hasło ponownie.";
  const dane = await odp.json().catch(() => null);
  if (typeof dane?.error === "string") return dane.error;
  return `Błąd serwera (kod ${odp.status}). Szczegóły są w terminalu serwera – spróbuj ponownie.`;
}

// Tylko linki https – treść z zewnętrznego źródła nie może podsunąć np. "javascript:".
function bezpiecznyLink(url?: string | null): string | null {
  try {
    return url && new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

type OdpowiedzKarty = { miejsce: DanePodrozy["miejsce"]; data: string; karta: Karta };

export default function Dashboard() {
  const [miasto, setMiasto] = useState("");
  const [data, setData] = useState(dzisiaj);
  const [zapytanie, setZapytanie] = useState<Zapytanie | null>(null);
  const [miejsce, setMiejsce] = useState<DanePodrozy["miejsce"] | null>(null);
  const [karty, setKarty] = useState<Record<RodzajKarty, StanKarty> | null>(null);
  const [laduje, setLaduje] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [podsumowanie, setPodsumowanie] = useState<Podsumowanie>({ stan: "brak" });
  // Numer bieżącego sprawdzania – odpowiedzi ze starszego kliknięcia są ignorowane.
  const biezace = useRef(0);

  /** Jedna karta: OK albo „brak” – nigdy wyjątek. */
  async function pobierzKarte(z: Zapytanie, rodzaj: RodzajKarty): Promise<{ wynik: StanKarty; odp?: OdpowiedzKarty; bladMiasta?: string }> {
    try {
      const odp = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...z, karta: rodzaj }),
      });
      if (odp.status === 404 || odp.status === 400 || odp.status === 401) {
        // Nie ma takiego miasta / złe dane / sesja – dotyczy całej strony, nie jednej karty.
        return { wynik: { stan: "brak", powod: "" }, bladMiasta: await bladOdpowiedzi(odp) };
      }
      if (!odp.ok) return { wynik: { stan: "brak", powod: await bladOdpowiedzi(odp) } };
      const dane = (await odp.json()) as OdpowiedzKarty;
      const k = dane.karta;
      if (k.blad || k.wartosc === null) {
        return { wynik: { stan: "brak", powod: k.blad ?? "Źródło nie zwróciło danych.", pobrano: k.pobrano }, odp: dane };
      }
      return { wynik: { stan: "ok", karta: k }, odp: dane };
    } catch {
      return { wynik: { stan: "brak", powod: "Brak połączenia z serwerem." } };
    }
  }

  async function sprawdz(z: Zapytanie) {
    const numer = ++biezace.current;
    setLaduje(true);
    setBlad(null);
    setPodsumowanie({ stan: "brak" });
    setKarty(wszystkie({ stan: "laduje" }));
    if (zapytanie?.miasto.toLocaleLowerCase("pl") !== z.miasto.toLocaleLowerCase("pl")) setMiejsce(null);

    // Każda karta osobno i równolegle – wolne źródło nie blokuje pozostałych.
    const wyniki = await Promise.all(
      RODZAJE_KART.map(async (rodzaj) => {
        const w = await pobierzKarte(z, rodzaj);
        if (numer !== biezace.current) return w;
        if (w.odp) setMiejsce(w.odp.miejsce);
        if (!w.bladMiasta) setKarty((prev) => (prev ? { ...prev, [rodzaj]: w.wynik } : prev));
        return w;
      }),
    );
    if (numer !== biezace.current) return;
    setLaduje(false);

    const bladMiasta = wyniki.find((w) => w.bladMiasta)?.bladMiasta;
    if (bladMiasta && !wyniki.some((w) => w.odp)) {
      setBlad(bladMiasta);
      setKarty(null);
      setMiejsce(null);
      return;
    }
    setZapytanie(z);
    const pierwsza = wyniki.find((w) => w.odp)?.odp;
    if (pierwsza) {
      void podsumuj(numer, pierwsza.miejsce, pierwsza.data, RODZAJE_KART.map((r, i) => [r, wyniki[i].wynik] as const));
    }
  }

  async function podsumuj(
    numer: number,
    m: DanePodrozy["miejsce"],
    dataWyjazdu: string,
    stany: (readonly [RodzajKarty, StanKarty])[],
  ) {
    setPodsumowanie({ stan: "laduje" });
    // Karty bez danych idą z samym tytułem, źródłem i powodem – bez żadnej wartości.
    const kartyDoPodsumowania = Object.fromEntries(
      stany.map(([r, s]) => [
        r,
        s.stan === "ok"
          ? { ...s.karta, zrodlo: s.karta.zrodlo }
          : { tytul: OPIS_KART[r].tytul, zrodlo: OPIS_KART[r].zrodlo, wartosc: null, blad: s.stan === "brak" ? s.powod || "brak danych" : "brak danych" },
      ]),
    );
    try {
      const odp = await fetch("/api/dashboard/podsumowanie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ miasto: m.nazwa, kraj: m.kraj, data: dataWyjazdu, karty: kartyDoPodsumowania }),
      });
      if (numer !== biezace.current) return;
      if (!odp.ok) {
        setPodsumowanie({ stan: "blad", tekst: await bladOdpowiedzi(odp) });
        return;
      }
      const { tekst } = (await odp.json()) as { tekst: string };
      setPodsumowanie({ stan: "gotowe", tekst });
    } catch {
      if (numer === biezace.current) setPodsumowanie({ stan: "blad", tekst: "Nie udało się pobrać podsumowania." });
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>✈️ Asystent podróży</h1>
        <Link className={styles.back} href="/">
          ← Wróć do czatu
        </Link>
      </div>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!miasto.trim() || laduje) return;
          void sprawdz({ miasto: miasto.trim(), data });
        }}
      >
        <label className={styles.pole}>
          Dokąd jedziesz?
          <input
            className={styles.input}
            value={miasto}
            onChange={(e) => setMiasto(e.target.value)}
            placeholder="np. Rzym"
            maxLength={80}
            required
          />
        </label>
        <label className={styles.pole}>
          Kiedy?
          <input
            className={styles.input}
            type="date"
            value={data}
            min={dzisiaj()}
            onChange={(e) => setData(e.target.value)}
            required
          />
        </label>
        <button className={styles.button} type="submit" disabled={laduje || !miasto.trim()}>
          {laduje ? "Sprawdzam…" : "Sprawdź"}
        </button>
      </form>

      {blad && <p className={styles.error}>{blad}</p>}

      {karty && (
        <>
          <div className={styles.cel}>
            <span>
              {miejsce ? `${miejsce.nazwa}${miejsce.kraj ? `, ${miejsce.kraj}` : ""}` : "Szukam miasta…"}
              {zapytanie && ` · ${(miejsce ? zapytanie.data : data).split("-").reverse().join(".")}`}
            </span>
            <button
              className={styles.odswiez}
              type="button"
              disabled={laduje || !zapytanie}
              onClick={() => zapytanie && void sprawdz(zapytanie)}
            >
              {laduje ? "Odświeżam…" : "↻ Odśwież"}
            </button>
          </div>

          <div className={styles.karty}>
            {RODZAJE_KART.map((rodzaj) => (
              <KartaWidok key={rodzaj} rodzaj={rodzaj} stan={karty[rodzaj]} />
            ))}
          </div>

          <section className={styles.podsumowanie} aria-live="polite">
            <h2>Podsumowanie od agenta</h2>
            {(podsumowanie.stan === "laduje" || (laduje && podsumowanie.stan === "brak")) && (
              <p className={styles.szare}>Agent przygotowuje podsumowanie…</p>
            )}
            {podsumowanie.stan === "gotowe" && <p>{podsumowanie.tekst}</p>}
            {podsumowanie.stan === "blad" && <p className={styles.error}>{podsumowanie.tekst}</p>}
          </section>
        </>
      )}
    </main>
  );
}

const ETYKIETA_STANU: Record<StanKarty["stan"], string> = {
  ok: "OK",
  laduje: "Ładuję…",
  brak: "Brak danych",
};

function KartaWidok({ rodzaj, stan }: { rodzaj: RodzajKarty; stan: StanKarty }) {
  const opis = OPIS_KART[rodzaj];
  const karta = stan.stan === "ok" ? stan.karta : null;
  const link = bezpiecznyLink(karta?.link);
  return (
    <article className={styles.karta} aria-busy={stan.stan === "laduje"}>
      <div className={styles.kartaGora}>
        <h2 className={styles.kartaTytul}>
          {IKONY[rodzaj]} {opis.tytul}
        </h2>
        <span className={`${styles.stan} ${styles[`stan_${stan.stan}`]}`}>{ETYKIETA_STANU[stan.stan]}</span>
      </div>

      {stan.stan === "laduje" && <p className={styles.szare}>Ładuję…</p>}

      {stan.stan === "brak" && (
        <>
          <p className={styles.kartaBlad}>Brak danych – spróbuj odświeżyć.</p>
          {stan.powod && <p className={styles.powod}>{stan.powod}</p>}
        </>
      )}

      {karta && (
        <>
          <p className={styles.wartosc}>
            {karta.wartosc}
            {karta.jednostka && <span className={styles.jednostka}> {karta.jednostka}</span>}
          </p>
          {karta.szczegoly && <p className={styles.szczegoly}>{karta.szczegoly}</p>}
          {link && (
            <a className={styles.link} href={link} target="_blank" rel="noopener noreferrer">
              Czytaj więcej w Wikipedii →
            </a>
          )}
        </>
      )}

      <p className={styles.zrodlo}>
        Źródło: {karta?.zrodlo ?? opis.zrodlo}
        {karta ? ` · pobrano ${karta.pobrano}` : stan.stan === "brak" && stan.pobrano ? ` · próba ${stan.pobrano}` : ""}
      </p>
    </article>
  );
}
