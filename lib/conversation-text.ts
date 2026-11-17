import type { UIMessage } from "ai";

// Zamiana wiadomości z czatu na tekst do zapisu w bazie (bez połączenia z bazą –
// ten plik może być importowany wszędzie i łatwo go przetestować).

/** Wiadomość wczytana z bazy, gotowa do pokazania w czacie. */
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/** Zamiast obrazów (zdjęcia użytkownika, wygenerowane obrazy) zapisujemy ten dopisek. */
export const IMAGE_PLACEHOLDER = "[obraz]";

const IMAGE_TOOL_PART = "tool-generujObraz";
const TITLE_MAX = 80;

/** Tekst wiadomości: części tekstowe po kolei, obrazy jako „[obraz]”. */
export function messageText(message: Pick<UIMessage, "parts">): string {
  const pieces: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === "text") {
      if (part.text.trim()) pieces.push(part.text.trim());
    } else if (part.type === "file" && part.mediaType.startsWith("image/")) {
      pieces.push(IMAGE_PLACEHOLDER);
    } else if (
      part.type === IMAGE_TOOL_PART &&
      "state" in part &&
      part.state === "output-available"
    ) {
      pieces.push(IMAGE_PLACEHOLDER);
    }
  }
  return pieces.join("\n\n");
}

const MODEL_TITLE_MIN_WORDS = 2;
const MODEL_TITLE_MAX_WORDS = 5;
const MODEL_TITLE_MAX_CHARS = 60;

/**
 * Tytuł od modelu po oczyszczeniu: pierwsza linia, bez cudzysłowów, gwiazdek,
 * przedrostka „Tytuł:” i kropki na końcu; najwyżej 5 słów i 60 znaków.
 * null = odpowiedź nie nadaje się na tytuł (zostaje tytuł z pierwszej wiadomości).
 */
export function cleanModelTitle(raw: string): string | null {
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const words = firstLine
    .replace(/^\s*(tytuł|title)\s*:\s*/i, "")
    .replace(/["'„”“‚’«»*`#_]/g, "")
    .replace(/[.!?:;,…\s-]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length < MODEL_TITLE_MIN_WORDS) return null;
  const title = words.slice(0, MODEL_TITLE_MAX_WORDS).join(" ");
  if (title.length > MODEL_TITLE_MAX_CHARS) return null;
  return title.charAt(0).toLocaleUpperCase("pl-PL") + title.slice(1);
}

/** Tytuł rozmowy z pierwszej wiadomości: jedna linia, najwyżej 80 znaków. */
export function conversationTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "Nowa rozmowa";
  return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1)}…` : oneLine;
}
