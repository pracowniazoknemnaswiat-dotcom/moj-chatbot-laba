// Wspólne zasady dla zdjęć (przeglądarka i serwer).
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_PROMPT_LENGTH = 500;

export function isAllowedImageType(mediaType: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mediaType);
}

// Komunikat dla użytkownika albo null, gdy plik jest w porządku.
export function imageFileProblem(mediaType: string, bytes: number): string | null {
  if (!isAllowedImageType(mediaType)) {
    return "Dozwolone są tylko zdjęcia JPG, PNG lub WEBP.";
  }
  if (bytes > MAX_IMAGE_BYTES) {
    return "Zdjęcie jest za duże. Maksymalny rozmiar to 4 MB.";
  }
  return null;
}

// Sprawdza zdjęcie przysłane jako data URL ("data:image/png;base64,...").
// Typ odczytujemy z samego adresu, nie z pola mediaType od przeglądarki.
export function dataUrlProblem(url: string): string | null {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!match) return "Zdjęcie ma nieprawidłowy format.";
  const [, mediaType, base64] = match;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  return imageFileProblem(mediaType, bytes);
}
