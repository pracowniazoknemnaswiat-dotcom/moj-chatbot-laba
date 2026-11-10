import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, tool } from "ai";
import { z } from "zod";
import { MAX_IMAGE_PROMPT_LENGTH } from "./images";
import { FriendlyError, friendlyModelError } from "./model-errors";

// Nano Banana 2 w OpenRouter.
export const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

export type GeneratedImageOutput = {
  /** Obraz jako data URL – trafia tylko do przeglądarki, nie do modelu. */
  image: string;
  modelId: string;
  /** true = identyfikator modelu pochodzi z odpowiedzi API. */
  modelConfirmed: boolean;
};

export async function generateImageFromPrompt(
  apiKey: string,
  prompt: string,
): Promise<GeneratedImageOutput> {
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

  const { image, calls } = await generateImage({
    model: openrouter.imageModel(IMAGE_MODEL),
    prompt,
    maxRetries: 1,
  });
  // calls[].response.modelId to miejsce, które AI SDK przewiduje na model
  // z odpowiedzi. Provider OpenRouter (3.1.0) wpisuje tam jednak model
  // z żądania, a API /images nie zwraca pola "model". Dlatego potwierdzony
  // jest tylko model odczytany z samej odpowiedzi API.
  const requestedModel = calls[0]?.response.modelId ?? IMAGE_MODEL;
  return {
    image: `data:${image.mediaType};base64,${image.base64}`,
    modelId: modelFromApi ?? requestedModel,
    modelConfirmed: modelFromApi !== undefined,
  };
}

// Narzędzie dla modelu czatu. Obraz idzie do przeglądarki (wynik narzędzia
// w strumieniu), a model dostaje tylko krótki tekst – bez pliku.
export function createImageTool(apiKey: string) {
  return tool({
    description:
      "Generuje obraz (ilustrację, logo, plakat, grafikę) na podstawie opisu. " +
      "Użyj, gdy użytkownik prosi o stworzenie, narysowanie lub wygenerowanie obrazu. " +
      "Do pola prompt przekaż opis obrazu od użytkownika, bez skracania.",
    inputSchema: z.object({
      prompt: z
        .string()
        .min(1)
        .max(MAX_IMAGE_PROMPT_LENGTH)
        .describe("Opis obrazu do wygenerowania"),
    }),
    execute: async ({ prompt }): Promise<GeneratedImageOutput> => {
      try {
        return await generateImageFromPrompt(apiKey, prompt);
      } catch (error) {
        console.error("Błąd generowania obrazu:", error);
        // Zrozumiały komunikat po polsku – zobaczy go i model, i użytkownik.
        throw new FriendlyError(friendlyModelError(error));
      }
    },
    toModelOutput: () => ({ type: "text", value: "obraz wygenerowany" }),
  });
}
