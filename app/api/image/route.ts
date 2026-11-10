import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { MAX_IMAGE_PROMPT_LENGTH } from "@/lib/images";
import { friendlyModelError } from "@/lib/model-errors";

// Nano Banana 2 w OpenRouter.
const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

const bodySchema = z.strictObject({
  prompt: z.string().trim().min(1).max(MAX_IMAGE_PROMPT_LENGTH),
});

const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function POST(req: Request) {
  // 1. Sesja – zanim zrobimy cokolwiek innego.
  const authConfig = getAuthConfig();
  if (!authConfig) {
    return json({ error: "Dostęp zablokowany: brak konfiguracji hasła na serwerze." }, 503);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, authConfig)) {
    return json({ error: "Brak ważnej sesji. Odśwież stronę i wpisz hasło ponownie." }, 401);
  }

  // 2. Opis obrazu.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowe zapytanie." }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: `Wpisz opis obrazu (od 1 do ${MAX_IMAGE_PROMPT_LENGTH} znaków).` },
      400,
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({ error: "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY w pliku .env.local." }, 500);
  }

  // Biblioteka podaje w wyniku nazwę modelu, o który prosiliśmy. Żeby pokazać
  // model, którego API faktycznie użyło, odczytujemy pole "model" z odpowiedzi.
  let modelFromApi: string | undefined;
  const openrouter = createOpenRouter({
    apiKey,
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      try {
        const data = await res.clone().json();
        if (typeof data?.model === "string") modelFromApi = data.model;
      } catch {
        // Odpowiedź nie jest JSON-em – zostawiamy bez identyfikatora.
      }
      return res;
    },
  });

  try {
    const { image, calls } = await generateImage({
      model: openrouter.imageModel(IMAGE_MODEL),
      prompt: parsed.data.prompt,
      maxRetries: 1,
    });
    // calls[].response.modelId to miejsce, które AI SDK przewiduje na model
    // z odpowiedzi. Provider OpenRouter (3.1.0) wpisuje tam jednak model
    // z żądania, a API /images nie zwraca pola "model". Dlatego potwierdzony
    // jest tylko model odczytany z samej odpowiedzi API.
    const requestedModel = calls[0]?.response.modelId ?? IMAGE_MODEL;
    return json({
      image: `data:${image.mediaType};base64,${image.base64}`,
      modelId: modelFromApi ?? requestedModel,
      modelConfirmed: modelFromApi !== undefined,
    });
  } catch (error) {
    console.error("Błąd generowania obrazu:", error);
    return json({ error: friendlyModelError(error) }, 502);
  }
}
