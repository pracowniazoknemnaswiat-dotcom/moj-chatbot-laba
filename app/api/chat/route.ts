import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { cookies } from "next/headers";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { FEW_SHOT_EXAMPLES, STUDIO_NOVA_BASE } from "@/lib/studio-nova";

// Instrukcja systemowa zwykłego czatu: dodawana tylko na serwerze.
const INSTRUCTIONS = `${STUDIO_NOVA_BASE}

W trybie czatu odpowiadaj krótko: propozycja odpowiedzi do klienta oraz
informacja, co wymaga sprawdzenia przez pracownika.

${FEW_SHOT_EXAMPLES}`;

export async function POST(req: Request) {
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return new Response(
      "Dostęp zablokowany: brak konfiguracji hasła na serwerze.",
      { status: 503 },
    );
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, authConfig)) {
    return new Response(
      "Brak ważnej sesji. Odśwież stronę i wpisz hasło ponownie.",
      { status: 401 },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;

  if (!apiKey || !modelId) {
    return new Response(
      "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom ponownie serwer.",
      { status: 500 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const openrouter = createOpenRouter({ apiKey });

  const result = streamText({
    model: openrouter(modelId),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) =>
        error instanceof Error
          ? `Błąd modelu: ${error.message}`
          : "Wystąpił nieznany błąd modelu.",
    }),
  });
}
