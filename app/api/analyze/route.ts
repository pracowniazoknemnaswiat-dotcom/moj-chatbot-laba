import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { cookies } from "next/headers";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { z } from "zod";
import { analyzeMessage, MAX_MESSAGE_LENGTH } from "@/lib/triage";

const analyzeRequestSchema = z.strictObject({ message: z.string() });

// Tryb analizy wiadomości: structured output + walidacja po stronie serwera.
// Nic nie wysyła, nie rezerwuje i nie obsługuje płatności — zwraca tylko szkic.
export async function POST(req: Request) {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return Response.json(
      { error: "Dostęp zablokowany: brak konfiguracji hasła na serwerze." },
      { status: 503 },
    );
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, authConfig)) {
    return Response.json(
      { error: "Brak ważnej sesji. Odśwież stronę i wpisz hasło ponownie." },
      { status: 401 },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;
  if (!apiKey || !modelId) {
    return Response.json(
      {
        error:
          "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom ponownie serwer.",
      },
      { status: 500 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  // Przeglądarka może przysłać tylko treść wiadomości. Każde inne pole
  // (np. send_now, role, permissions, instructions, schema) = 400.
  const parsed = analyzeRequestSchema.safeParse(body);
  if (!parsed.success && body && typeof body === "object" && Object.keys(body).some((k) => k !== "message")) {
    return Response.json(
      { error: "Niedozwolone pola w żądaniu. Wysyłana jest tylko treść wiadomości." },
      { status: 400 },
    );
  }
  const message = parsed.success ? parsed.data.message : undefined;
  if (typeof message !== "string" || message.trim() === "") {
    return Response.json(
      { error: "Wklej treść wiadomości klienta." },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: `Wiadomość jest za długa (limit ${MAX_MESSAGE_LENGTH} znaków).` },
      { status: 400 },
    );
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter(modelId, {
    // Bez tego OpenRouter mógłby po cichu pominąć JSON Schema u dostawcy,
    // który go nie obsługuje. Z tym: brak obsługi = czytelny błąd.
    provider: { require_parameters: true },
    structuredOutputs: { strict: true },
  });

  return Response.json(await analyzeMessage(model, message.trim()));
}
