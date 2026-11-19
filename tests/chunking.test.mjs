import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHUNK_LENGTH, splitIntoChunks, splitParagraphs } from "../lib/chunking.ts";

test("akapit = fragment, krótkich nie łączymy", () => {
  const tekst = "Cennik.\n\nKurs: 2199 zł.\n\nRaty: 6.";
  assert.deepEqual(splitIntoChunks(tekst), ["Cennik.", "Kurs: 2199 zł.", "Raty: 6."]);
});

test("pusta linia ze spacjami, Windowsowe końce linii i wiele pustych linii", () => {
  const tekst = "Pierwszy\r\n   \r\nDrugi\n\n\n\nTrzeci";
  assert.deepEqual(splitParagraphs(tekst), ["Pierwszy", "Drugi", "Trzeci"]);
});

test("pojedynczy enter nie dzieli akapitu", () => {
  assert.deepEqual(splitIntoChunks("linia 1\nlinia 2"), ["linia 1\nlinia 2"]);
});

test("pusta treść = brak fragmentów", () => {
  assert.deepEqual(splitIntoChunks("  \n\n  "), []);
});

test("długi akapit dzielony na granicy zdania, każdy fragment ≤ 800", () => {
  const zdanie = "To jest zdanie testowe o kursie do egzaminu ósmoklasisty z matematyki. "; // 72 znaki
  const akapit = zdanie.repeat(30).trim(); // ok. 2150 znaków
  const fragmenty = splitIntoChunks(akapit);
  assert.ok(fragmenty.length >= 3);
  for (const f of fragmenty) {
    assert.ok(f.length <= MAX_CHUNK_LENGTH, `za długi: ${f.length}`);
    assert.ok(f.endsWith("."), "fragment kończy się na końcu zdania");
    assert.ok(f.startsWith("To jest"), "fragment zaczyna się od początku zdania");
  }
  // nic nie ginie: po sklejeniu ta sama treść
  assert.equal(fragmenty.join(" "), akapit);
});

test("akapit równo 800 znaków zostaje w całości", () => {
  const akapit = "a".repeat(MAX_CHUNK_LENGTH);
  assert.deepEqual(splitIntoChunks(akapit), [akapit]);
});

test("zdanie dłuższe niż limit – cięcie na granicy słowa", () => {
  const zdanie = Array.from({ length: 300 }, (_, i) => `słowo${i}`).join(" ");
  const fragmenty = splitIntoChunks(zdanie);
  assert.ok(fragmenty.length > 1);
  for (const f of fragmenty) {
    assert.ok(f.length <= MAX_CHUNK_LENGTH);
    assert.match(f, /^słowo\d+/);
    assert.match(f, /słowo\d+$/);
  }
  assert.equal(fragmenty.join(" "), zdanie);
});

test("krótkie akapity obok długiego zostają osobno i w kolejności", () => {
  const dlugi = "Zdanie numer jeden jest dość długie i opisuje zasady. ".repeat(20).trim();
  const fragmenty = splitIntoChunks(`Wstęp.\n\n${dlugi}\n\nKoniec.`);
  assert.equal(fragmenty[0], "Wstęp.");
  assert.equal(fragmenty.at(-1), "Koniec.");
  assert.ok(fragmenty.length >= 4);
});
