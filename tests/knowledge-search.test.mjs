import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// "server-only" działa tylko w Next – w testach podmieniamy go na pusty moduł.
registerHooks({
  resolve: (s, c, n) => (s === "server-only" ? { url: "data:text/javascript,", shortCircuit: true } : n(s, c)),
});
const { toFragments, searchKnowledge, KNOWLEDGE_MATCH_COUNT } = await import("../lib/knowledge-search.ts");

test("fragmenty: tytuł, treść, podobieństwo zaokrąglone do 3 miejsc", () => {
  const f = toFragments([
    { id: 1, document_id: 2, title: "Regulamin", content: "Lekcję można odwołać do 10:00.", similarity: 0.612345 },
  ]);
  assert.deepEqual(f, [{ tytul: "Regulamin", tresc: "Lekcję można odwołać do 10:00.", podobienstwo: 0.612 }]);
});

test("fragmenty: pomija niepełne wiersze, pusty tytuł dostaje opis", () => {
  const f = toFragments([
    { title: "", content: "Treść", similarity: 0.5 },
    { title: "X", content: null, similarity: 0.9 },
    { title: "Y", content: "Treść", similarity: "0.9" },
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].tytul, "(dokument bez tytułu)");
});

test("narzędzie: opis mówi, kiedy go używać; zwraca 3 fragmenty", () => {
  assert.match(searchKnowledge.description, /firmę, ofertę, ceny, zasady i regulamin/);
  assert.equal(KNOWLEDGE_MATCH_COUNT, 3);
});

test("narzędzie: bez Supabase zwraca błąd, nie zgaduje", async () => {
  const zapas = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const wynik = await searchKnowledge.execute({ pytanie: "Ile kosztuje kurs?" }, { toolCallId: "t", messages: [] });
    assert.ok("blad" in wynik);
  } finally {
    if (zapas.url) process.env.SUPABASE_URL = zapas.url;
    if (zapas.key) process.env.SUPABASE_SECRET_KEY = zapas.key;
  }
});
