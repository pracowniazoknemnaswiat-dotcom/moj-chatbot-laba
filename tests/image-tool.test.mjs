// Narzędzie generujObraz: obraz trafia do przeglądarki (strumień UI),
// a do modelu wraca tylko tekst „obraz wygenerowany” (toModelOutput).
// Połączenie z OpenRouter jest podmienione – test nic nie kosztuje.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  convertToModelMessages,
  isStepCount,
  simulateReadableStream,
  streamText,
  toUIMessageStream,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createImageTool, IMAGE_MODEL } from "../lib/image-generation.ts";
import { friendlyModelError } from "../lib/model-errors.ts";

const FAKE_PNG = Buffer.from("obraz-testowy").toString("base64");
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

let realFetch;
let imageRequests;
let imageStatus;
beforeEach(() => {
  realFetch = globalThis.fetch;
  imageRequests = [];
  imageStatus = 200;
  // Atrapa endpointu /images w OpenRouter (bez pola "model", jak prawdziwe API).
  globalThis.fetch = async (url, init) => {
    imageRequests.push({ url: String(url), body: JSON.parse(init.body) });
    if (imageStatus !== 200) {
      return new Response('{"error":{"message":"No endpoints found"}}', {
        status: imageStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG }] }), {
      headers: { "content-type": "application/json" },
    });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Model-atrapa: w 1. kroku woła generujObraz, w 2. pisze krótki tekst.
// Zapisuje, co dostał jako prompt w każdym kroku.
function scriptedModel() {
  const prompts = [];
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      prompts.push(prompt);
      const chunks =
        prompts.length === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "generujObraz",
                input: JSON.stringify({ prompt: "logo kawiarni" }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
            ]
          : [
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Gotowe." },
              { type: "text-end", id: "t" },
              { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
            ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  return { model, prompts };
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test("obraz idzie do przeglądarki, model dostaje tylko „obraz wygenerowany”", async () => {
  const tools = { generujObraz: createImageTool("klucz-testowy") };
  const { model, prompts } = scriptedModel();

  const result = streamText({
    model,
    prompt: "Wygeneruj obraz: logo kawiarni",
    tools,
    stopWhen: isStepCount(5),
  });
  const ui = await collect(toUIMessageStream({ stream: result.stream }));

  // Przeglądarka: pełny obraz + model z żądania (API go nie potwierdziło).
  const output = ui.find((c) => c.type === "tool-output-available")?.output;
  assert.equal(output.image, `data:image/png;base64,${FAKE_PNG}`);
  assert.equal(output.modelId, IMAGE_MODEL);
  assert.equal(output.modelConfirmed, false);
  assert.equal(imageRequests[0].body.model, IMAGE_MODEL);
  assert.equal(imageRequests[0].body.prompt, "logo kawiarni");

  // Model w 2. kroku: wynik narzędzia to sam tekst, bez danych obrazu.
  assert.equal(prompts.length, 2);
  const toolMessage = prompts[1].find((m) => m.role === "tool");
  assert.deepEqual(toolMessage.content[0].output, {
    type: "text",
    value: "obraz wygenerowany",
  });
  assert.doesNotMatch(JSON.stringify(prompts[1]), new RegExp(FAKE_PNG));
});

test("obraz z historii rozmowy też trafia do modelu jako tekst", async () => {
  const tools = { generujObraz: createImageTool("klucz-testowy") };
  const messages = await convertToModelMessages(
    [
      { id: "1", role: "user", parts: [{ type: "text", text: "Wygeneruj obraz: kot" }] },
      {
        id: "2",
        role: "assistant",
        parts: [
          {
            type: "tool-generujObraz",
            toolCallId: "call-1",
            state: "output-available",
            input: { prompt: "kot" },
            output: { image: `data:image/png;base64,${FAKE_PNG}`, modelId: "x", modelConfirmed: false },
          },
        ],
      },
    ],
    { tools },
  );
  const tool = messages.find((m) => m.role === "tool");
  assert.deepEqual(tool.content[0].output, { type: "text", value: "obraz wygenerowany" });
  assert.doesNotMatch(JSON.stringify(messages), new RegExp(FAKE_PNG));
});

test("niedostępny model obrazów: komunikat po polsku w wyniku narzędzia", async () => {
  imageStatus = 404;
  const tools = { generujObraz: createImageTool("klucz-testowy") };
  const { model } = scriptedModel();
  const result = streamText({ model, prompt: "x", tools, stopWhen: isStepCount(5) });
  // onError jak w app/api/agent/route.ts.
  const ui = await collect(
    toUIMessageStream({ stream: result.stream, onError: friendlyModelError }),
  );
  const err = ui.find((c) => c.type === "tool-output-error");
  assert.match(err.errorText, /model jest teraz niedostępny/);
});
