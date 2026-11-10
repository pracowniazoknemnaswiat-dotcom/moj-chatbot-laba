// Zdjęcia (walidacja) i komunikaty błędów modelu po polsku.
import assert from "node:assert/strict";
import { test } from "node:test";
import { APICallError, NoImageGeneratedError } from "ai";
import { dataUrlProblem, imageFileProblem, MAX_IMAGE_BYTES } from "../lib/images.ts";
import { friendlyModelError } from "../lib/model-errors.ts";

const dataUrl = (mediaType, bytes) =>
  `data:${mediaType};base64,${Buffer.alloc(bytes).toString("base64")}`;

test("zdjęcie JPG/PNG/WEBP do 4 MB jest przyjmowane", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(imageFileProblem(type, 1000), null);
    assert.equal(dataUrlProblem(dataUrl(type, 1000)), null);
  }
  assert.equal(dataUrlProblem(dataUrl("image/png", MAX_IMAGE_BYTES)), null);
});

test("za duże zdjęcie jest odrzucane", () => {
  assert.match(dataUrlProblem(dataUrl("image/png", MAX_IMAGE_BYTES + 1)), /4 MB/);
  assert.match(imageFileProblem("image/png", MAX_IMAGE_BYTES + 1), /4 MB/);
});

test("inne typy plików i linki zamiast data URL są odrzucane", () => {
  assert.match(dataUrlProblem(dataUrl("image/gif", 10)), /JPG, PNG lub WEBP/);
  assert.match(dataUrlProblem(dataUrl("image/svg+xml", 10)), /JPG, PNG lub WEBP/);
  assert.match(dataUrlProblem(dataUrl("application/pdf", 10)), /JPG, PNG lub WEBP/);
  assert.match(dataUrlProblem("https://example.com/kot.png"), /nieprawidłowy format/);
  assert.match(dataUrlProblem("data:image/png,surowe-dane"), /nieprawidłowy format/);
});

const apiError = (statusCode, responseBody = "") =>
  new APICallError({
    message: "błąd",
    url: "https://openrouter.ai/api/v1/x",
    requestBodyValues: {},
    statusCode,
    responseBody,
  });

test("niedostępny model daje zrozumiały komunikat po polsku", () => {
  assert.match(friendlyModelError(apiError(404)), /model jest teraz niedostępny/);
  assert.match(
    friendlyModelError(apiError(400, '{"error":{"message":"x is not a valid model ID"}}')),
    /niedostępny/,
  );
  assert.match(friendlyModelError(apiError(503)), /chwilowo niedostępny/);
  assert.match(friendlyModelError(apiError(429)), /Spróbuj za chwilę/);
  assert.match(friendlyModelError(apiError(402)), /środki/);
  assert.match(
    friendlyModelError(new NoImageGeneratedError({ responses: [] })),
    /nie zwrócił obrazu/,
  );
  assert.match(friendlyModelError(new Error("cokolwiek")), /Spróbuj ponownie/);
});

test("komunikat nie przekazuje surowej treści błędu z API", () => {
  const msg = friendlyModelError(apiError(500, "sekretny-szczegół-serwera"));
  assert.doesNotMatch(msg, /sekretny/);
});
