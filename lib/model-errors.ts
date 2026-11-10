import { APICallError, NoImageGeneratedError } from "ai";

// Zamienia błąd modelu na zrozumiały komunikat po polsku.
// Nie przekazujemy użytkownikowi surowej treści błędu z API.
export function friendlyModelError(error: unknown): string {
  if (NoImageGeneratedError.isInstance(error)) {
    return "Model nie zwrócił obrazu. Spróbuj inaczej opisać, co ma się znaleźć na obrazie.";
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const body = (error.responseBody ?? "").toLowerCase();

    if (status === 401 || status === 403) {
      return "Serwer nie ma dostępu do modelu (problem z kluczem API). Daj znać osobie, która konfiguruje aplikację.";
    }
    if (status === 402) {
      return "Na koncie OpenRouter skończyły się środki. Model jest chwilowo niedostępny.";
    }
    if (
      status === 404 ||
      body.includes("no endpoints") ||
      body.includes("not a valid model") ||
      body.includes("model not found")
    ) {
      return "Ten model jest teraz niedostępny. Spróbuj później albo poproś o zmianę modelu w konfiguracji.";
    }
    if (body.includes("image") && (status === 400 || status === 415)) {
      return "Ten model nie obsługuje zdjęć. Spróbuj bez zdjęcia albo poproś o zmianę modelu.";
    }
    if (status === 429) {
      return "Model jest teraz przeciążony albo przekroczono limit zapytań. Spróbuj za chwilę.";
    }
    if (status !== undefined && status >= 500) {
      return "Model jest chwilowo niedostępny (błąd po stronie dostawcy). Spróbuj za chwilę.";
    }
    if (status === 400) {
      return "Model odrzucił zapytanie. Spróbuj zmienić treść wiadomości.";
    }
  }

  return "Nie udało się uzyskać odpowiedzi modelu. Spróbuj ponownie za chwilę.";
}
