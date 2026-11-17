import { cookies } from "next/headers";
import { z } from "zod";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import {
  clearProfile,
  currentProfile,
  ProfileError,
  removeProfileFact,
  setProfileFact,
  setProfileName,
} from "@/lib/profile";
import {
  checkFactEdit,
  checkName,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_VALUE_LENGTH,
  type UserProfile,
} from "@/lib/profile-rules";
import { isWorkPreferenceKey } from "@/lib/work-preferences";

// Edycja profilu ze strony /profile. Zawsze ten sam wiersz w user_profiles.
//   PATCH  – zmiana albo usunięcie imienia lub jednego faktu
//   DELETE – wyczyszczenie całego profilu

const json = (data: unknown, status = 200) => Response.json(data, { status });

const keySchema = z.string().min(1).max(MAX_KEY_LENGTH);
const patchSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("setName"), value: z.string().max(MAX_NAME_LENGTH) }),
  z.strictObject({ action: z.literal("removeName") }),
  z.strictObject({
    action: z.literal("setFact"),
    key: keySchema,
    value: z.string().max(MAX_VALUE_LENGTH),
  }),
  z.strictObject({ action: z.literal("removeFact"), key: keySchema }),
]);

async function sessionError(): Promise<Response | null> {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return json({ error: "Dostęp zablokowany: brak konfiguracji hasła na serwerze." }, 503);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, authConfig)) {
    return json({ error: "Brak ważnej sesji. Odśwież stronę i wpisz hasło ponownie." }, 401);
  }
  return null;
}

async function run(action: () => Promise<UserProfile>): Promise<Response> {
  try {
    return json({ profile: await action() });
  } catch (error) {
    if (error instanceof ProfileError) return json({ error: error.message }, 503);
    throw error;
  }
}

export async function PATCH(req: Request) {
  // 1. Sesja – zanim przeczytamy treść i dotkniemy bazy.
  const denied = await sessionError();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Nieprawidłowe zapytanie." }, 400);
  const body = parsed.data;

  if (body.action === "setName") {
    const checked = checkName(body.value);
    if ("powod" in checked) return json({ error: `Nie zapisano: ${checked.powod}.` }, 400);
    return run(() => setProfileName(checked.name));
  }
  if (body.action === "removeName") return run(() => setProfileName(null));

  // Fakty: tylko istniejące pozycje albo stałe preferencje pracy (nowe pozycje dodaje agent).
  let exists: boolean;
  try {
    exists = body.key in (await currentProfile()).preferences;
  } catch (error) {
    if (error instanceof ProfileError) return json({ error: error.message }, 503);
    throw error;
  }
  if (!exists && !isWorkPreferenceKey(body.key)) {
    return json({ error: "Nie ma takiej pozycji w profilu." }, 404);
  }

  if (body.action === "removeFact") return run(() => removeProfileFact(body.key));

  const checked = checkFactEdit(body.key, body.value);
  if ("powod" in checked) return json({ error: `Nie zapisano: ${checked.powod}.` }, 400);
  return run(() => setProfileFact(checked.key, checked.value));
}

export async function DELETE() {
  const denied = await sessionError();
  if (denied) return denied;
  return run(() => clearProfile());
}
