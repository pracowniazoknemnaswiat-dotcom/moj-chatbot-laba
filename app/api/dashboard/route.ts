import { z } from "zod";
import { danePodrozy, kartaPodrozy, RODZAJE_KART } from "@/lib/dashboard";
import { brakSesji } from "@/lib/session-guard";

// Asystent podróży: karty (pogoda, waluta, święta, Wikipedia, czas) z tych samych
// funkcji co narzędzia agenta. Bez modelu – same dane.
// Z polem "karta" zwraca jedną kartę (strona pobiera każdą osobno, żeby wolne
// źródło nie blokowało pozostałych); bez niego – wszystkie naraz.

const zapytanieSchema = z.strictObject({
  miasto: z.string().trim().min(2, "Wpisz nazwę miasta.").max(80, "Nazwa miasta jest za długa."),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Wybierz datę."),
  karta: z.enum(RODZAJE_KART).optional(),
});

export async function POST(req: Request) {
  // 1. Sesja – zanim przeczytamy treść i pobierzemy dane.
  const odmowa = await brakSesji();
  if (odmowa) return odmowa;

  const parsed = zapytanieSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe zapytanie." },
      { status: 400 },
    );
  }
  const { miasto, data, karta } = parsed.data;

  try {
    const wynik = karta
      ? await kartaPodrozy(karta, miasto, data, req.signal)
      : await danePodrozy(miasto, data, req.signal);
    if ("blad" in wynik) return Response.json({ error: wynik.blad }, { status: 404 });
    return Response.json(wynik);
  } catch (e) {
    // Nieprzewidziany błąd: pełny opis w terminalu serwera, czytelny komunikat w przeglądarce.
    console.error("Błąd /api/dashboard:", e);
    return Response.json(
      { error: "Błąd serwera przy pobieraniu danych podróży. Szczegóły są w terminalu serwera." },
      { status: 500 },
    );
  }
}
