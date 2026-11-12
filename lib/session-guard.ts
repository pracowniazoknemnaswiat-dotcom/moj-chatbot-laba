import { cookies } from "next/headers";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "./auth";

/**
 * Wspólna kontrola sesji dla endpointów API. Wywołaj NA POCZĄTKU, zanim
 * przeczytasz treść żądania czy wywołasz model. Zwraca odpowiedź z błędem
 * (503 / 401) albo null, gdy sesja jest ważna.
 */
export async function brakSesji(): Promise<Response | null> {
  const config = getAuthConfig();
  if (!config) {
    return Response.json(
      { error: "Dostęp zablokowany: brak konfiguracji hasła na serwerze." },
      { status: 503 },
    );
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, config)) {
    return Response.json(
      { error: "Brak ważnej sesji. Odśwież stronę i wpisz hasło ponownie." },
      { status: 401 },
    );
  }
  return null;
}
