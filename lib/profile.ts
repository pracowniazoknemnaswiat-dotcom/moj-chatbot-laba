import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  MAX_FACTS,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_VALUE_LENGTH,
  mergePreferences,
  prepareProfileUpdate,
  type UserProfile,
} from "./profile-rules";
import { getSupabase } from "./supabase";

// Pamięć o użytkowniku: tabela user_profiles (name, preferences jsonb).
// Do lekcji 7 aplikacja ma jednego właściciela – profil to jeden wiersz
// (najstarszy); zapis go aktualizuje, a nowy wiersz powstaje tylko, gdy tabela jest pusta.

export class ProfileError extends Error {}

function db() {
  const supabase = getSupabase();
  if (!supabase) throw new ProfileError("Brak konfiguracji bazy (SUPABASE_URL / SUPABASE_SECRET_KEY).");
  return supabase;
}

type ProfileRow = { id: number; name: string | null; preferences: unknown };

async function loadRow(): Promise<ProfileRow | null> {
  const { data, error } = await db()
    .from("user_profiles")
    .select("id, name, preferences")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Supabase – odczyt profilu:", error.message);
    throw new ProfileError("Nie udało się odczytać profilu z bazy.");
  }
  return data ? { ...data, id: Number(data.id) } : null;
}

/** Profil właściciela albo null, gdy jeszcze nic nie zapamiętano. */
export async function loadProfile(): Promise<UserProfile | null> {
  const row = await loadRow();
  if (!row) return null;
  return {
    name: row.name,
    preferences: mergePreferences(row.preferences, {}),
  };
}

/** Zapis do jedynego wiersza: aktualizacja, a nowy wiersz tylko gdy tabela jest pusta. */
async function writeRow(
  row: ProfileRow | null,
  values: { preferences?: Record<string, unknown>; name?: string | null },
): Promise<void> {
  const supabase = db();
  const { error } = row
    ? await supabase.from("user_profiles").update(values).eq("id", row.id)
    : await supabase.from("user_profiles").insert(values);
  if (error) {
    console.error("Supabase – zapis profilu:", error.message);
    throw new ProfileError("Nie udało się zapisać profilu w bazie.");
  }
}

function toProfile(row: ProfileRow | null): UserProfile {
  return { name: row?.name ?? null, preferences: mergePreferences(row?.preferences, {}) };
}

/** Dopisuje imię i fakty do jedynego wiersza profilu (stare fakty zostają). */
export async function saveProfile(update: {
  name?: string;
  facts: Record<string, string>;
}): Promise<{ liczbaFaktow: number }> {
  const row = await loadRow();
  const preferences = mergePreferences(row?.preferences, update.facts);
  if (Object.keys(preferences).length > MAX_FACTS) {
    throw new ProfileError(`Profil jest pełny (limit ${MAX_FACTS} faktów).`);
  }
  const values: { preferences: Record<string, unknown>; name?: string } = { preferences };
  if (update.name) values.name = update.name;
  await writeRow(row, values);
  return { liczbaFaktow: Object.keys(preferences).length };
}

// ── Zmiany ze strony /profile (zawsze ten sam wiersz) ──

/** Nowe imię albo null = usunięcie imienia. */
export async function setProfileName(name: string | null): Promise<UserProfile> {
  const row = await loadRow();
  if (!row && name === null) return toProfile(null);
  await writeRow(row, { name });
  return toProfile({ ...(row ?? { id: 0, preferences: {} }), name });
}

/** Zmiana wartości faktu (istniejącego albo preferencji pracy). */
export async function setProfileFact(key: string, value: string): Promise<UserProfile> {
  const row = await loadRow();
  const preferences = mergePreferences(row?.preferences, { [key]: value });
  if (Object.keys(preferences).length > MAX_FACTS) {
    throw new ProfileError(`Profil jest pełny (limit ${MAX_FACTS} faktów).`);
  }
  await writeRow(row, { preferences });
  return toProfile({ ...(row ?? { id: 0, name: null }), preferences });
}

/** Usunięcie jednego faktu; pozostałe zostają. */
export async function removeProfileFact(key: string): Promise<UserProfile> {
  const row = await loadRow();
  if (!row) return toProfile(null);
  const preferences = mergePreferences(row.preferences, {});
  delete preferences[key];
  await writeRow(row, { preferences });
  return toProfile({ ...row, preferences });
}

/** Wyczyszczenie profilu: ten sam wiersz zostaje, bez imienia i faktów. */
export async function clearProfile(): Promise<UserProfile> {
  const row = await loadRow();
  if (row) await writeRow(row, { name: null, preferences: {} });
  return toProfile(null);
}

/** Aktualny profil z bazy (do sprawdzenia, czy fakt istnieje). */
export async function currentProfile(): Promise<UserProfile> {
  return toProfile(await loadRow());
}

/** Narzędzie agenta: zapis imienia i faktów o użytkowniku. */
export function createProfileTool() {
  return tool({
    description:
      "Zapamiętuje w profilu imię użytkownika i fakty, które użytkownik WPROST powiedział " +
      "o sobie (np. miasto, ulubione jedzenie, preferowany styl odpowiedzi). Używaj tylko " +
      "wtedy, gdy użytkownik mówi coś o sobie wprost. Nie zapisuj domysłów, planów, żartów " +
      "ani informacji o innych osobach (klientach, uczniach, trenerach). Nigdy nie zapisuj " +
      "haseł, kluczy, numerów dokumentów, kont i kart, danych o zdrowiu ani innych danych " +
      "wrażliwych. Nowy fakt nie kasuje starych; ta sama nazwa nadpisuje wartość. " +
      "Preferencje pracy zapisuj pod nazwami: rola_w_firmie (np. właścicielka, koordynatorka " +
      "biura), styl_odpowiedzi (krótko, w punktach / szczegółowo), obszar_pracy (kadry, " +
      "finanse, kursy, przetargi).",
    inputSchema: z.object({
      imie: z
        .string()
        .max(MAX_NAME_LENGTH)
        .optional()
        .describe("Imię użytkownika – tylko gdy sam je podał."),
      fakty: z
        .array(
          z.object({
            nazwa: z
              .string()
              .min(1)
              .max(MAX_KEY_LENGTH)
              .describe("Krótka nazwa faktu, np. miasto, ulubione_jedzenie, styl_odpowiedzi."),
            wartosc: z.string().min(1).max(MAX_VALUE_LENGTH).describe("Wartość, np. Warszawa."),
          }),
        )
        .max(10)
        .optional()
        .describe("Fakty o użytkowniku jako pary nazwa–wartość."),
    }),
    execute: async ({ imie, fakty }) => {
      const { name, facts, rejected } = prepareProfileUpdate({ imie, fakty });
      const nothingToSave = !name && Object.keys(facts).length === 0;
      if (nothingToSave) {
        return { zapisano: null, odrzucono: rejected, uwaga: "Nic nie zapisano." };
      }
      try {
        const { liczbaFaktow } = await saveProfile({ name, facts });
        return {
          zapisano: { ...(name ? { imie: name } : {}), fakty: facts },
          odrzucono: rejected,
          liczbaFaktowWProfilu: liczbaFaktow,
        };
      } catch (error) {
        if (error instanceof ProfileError) return { blad: error.message, odrzucono: rejected };
        throw error;
      }
    },
  });
}
