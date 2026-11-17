import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanModelTitle,
  conversationTitle,
  IMAGE_PLACEHOLDER,
  messageText,
} from "../lib/conversation-text.ts";

test("tytuł od modelu: czyszczenie cudzysłowów, przedrostka i kropki", () => {
  assert.equal(cleanModelTitle("„Cena kursu ósmoklasisty”."), "Cena kursu ósmoklasisty");
  assert.equal(cleanModelTitle("Tytuł: raty za zajęcia indywidualne"), "Raty za zajęcia indywidualne");
  assert.equal(cleanModelTitle("**Problem z linkiem do zajęć**\nDruga linia"), "Problem z linkiem do zajęć");
});

test("tytuł od modelu: najwyżej 5 słów, za krótki = null", () => {
  assert.equal(
    cleanModelTitle("Plakat kursu maturalnego z matematyki dla liceum"),
    "Plakat kursu maturalnego z matematyki",
  );
  assert.equal(cleanModelTitle("Kurs"), null);
  assert.equal(cleanModelTitle("   "), null);
  assert.equal(cleanModelTitle("Bardzodługiesłowo".repeat(10) + " drugie"), null);
});

test("tekst wiadomości: części tekstowe po kolei", () => {
  const text = messageText({
    parts: [
      { type: "step-start" },
      { type: "text", text: "Sprawdzam kurs." },
      { type: "step-start" },
      { type: "text", text: "  Kurs kosztuje 2199 zł.  " },
    ],
  });
  assert.equal(text, "Sprawdzam kurs.\n\nKurs kosztuje 2199 zł.");
});

test("zdjęcie użytkownika: zamiast danych obrazu dopisek [obraz]", () => {
  const text = messageText({
    parts: [
      { type: "file", mediaType: "image/png", url: "data:image/png;base64,AAAA" },
      { type: "text", text: "Co jest na zdjęciu?" },
    ],
  });
  assert.equal(text, `${IMAGE_PLACEHOLDER}\n\nCo jest na zdjęciu?`);
  assert.ok(!text.includes("base64"));
});

test("wygenerowany obraz: [obraz], bez danych obrazu", () => {
  const text = messageText({
    parts: [
      {
        type: "tool-generujObraz",
        toolCallId: "t1",
        state: "output-available",
        input: { prompt: "logo" },
        output: { image: "data:image/png;base64,BBBB" },
      },
      { type: "text", text: "Gotowe." },
    ],
  });
  assert.equal(text, `${IMAGE_PLACEHOLDER}\n\nGotowe.`);
});

test("nieudane generowanie obrazu nie dodaje [obraz]", () => {
  const text = messageText({
    parts: [
      {
        type: "tool-generujObraz",
        toolCallId: "t1",
        state: "output-error",
        input: { prompt: "logo" },
        errorText: "błąd",
      },
    ],
  });
  assert.equal(text, "");
});

test("tytuł rozmowy: jedna linia, najwyżej 80 znaków", () => {
  assert.equal(conversationTitle("  Ile kosztuje\n kurs?  "), "Ile kosztuje kurs?");
  assert.equal(conversationTitle(""), "Nowa rozmowa");
  const long = conversationTitle("a".repeat(200));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
});
