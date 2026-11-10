// Narzędzie aktualnyCzas: data, dzień tygodnia i godzina w strefie Europe/Warsaw.
import assert from "node:assert/strict";
import { test } from "node:test";
import { aktualnyCzas, currentTimeInWarsaw } from "../lib/tools.ts";

test("zimą Warszawa = UTC+1", () => {
  const r = currentTimeInWarsaw(new Date("2026-11-10T22:30:00Z"));
  assert.equal(r.data, "2026-11-10");
  assert.equal(r.dzienTygodnia, "wtorek");
  assert.equal(r.godzina, "23:30");
  assert.equal(r.strefaCzasowa, "Europe/Warsaw");
});

test("latem Warszawa = UTC+2, data przechodzi na następny dzień", () => {
  const r = currentTimeInWarsaw(new Date("2027-05-09T22:15:00Z"));
  assert.equal(r.data, "2027-05-10");
  assert.equal(r.dzienTygodnia, "poniedziałek");
  assert.equal(r.godzina, "00:15");
  assert.equal(r.dataSlownie, "10 maja 2027");
});

test("narzędzie ma opis i działa bez argumentów", async () => {
  assert.match(aktualnyCzas.description, /dziś/);
  assert.match(aktualnyCzas.description, /jutro/);
  assert.match(aktualnyCzas.description, /za ile dni/);
  const r = await aktualnyCzas.execute({}, { toolCallId: "t1", messages: [] });
  assert.match(r.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.godzina, /^\d{2}:\d{2}$/);
});
