import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "../lib/markdown.ts";

test("pogrubienie, kursywa, kod – bez gwiazdek w tekście", () => {
  assert.deepEqual(parseInline("Cena: **2199 zł** i *raty*, `kod`"), [
    { t: "text", v: "Cena: " },
    { t: "strong", c: [{ t: "text", v: "2199 zł" }] },
    { t: "text", v: " i " },
    { t: "em", c: [{ t: "text", v: "raty" }] },
    { t: "text", v: ", " },
    { t: "code", v: "kod" },
  ]);
});

test("mnożenie 2 * 3 * 4 to nie kursywa", () => {
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "text", v: "2 * 3 * 4" }]);
});

test("listy punktowane z pogrubieniem i zagnieżdżeniem", () => {
  const b = parseMarkdown("Zasady:\n\n* **Termin:** do 10:00\n* **Płatność:** po 10:00\n  - lekcja płatna");
  assert.equal(b[0].t, "p");
  assert.equal(b[1].t, "ul");
  assert.equal(b[1].items.length, 2);
  assert.equal(b[1].items[0].c[0].t, "strong");
  assert.equal(b[1].items[1].children[0].t, "ul");
});

test("lista numerowana zachowuje numer początkowy", () => {
  const [ol] = parseMarkdown("3. trzeci\n4. czwarty");
  assert.equal(ol.t, "ol");
  assert.equal(ol.start, 3);
  assert.equal(ol.items.length, 2);
});

test("nagłówek, linia pozioma i akapit z nowymi liniami", () => {
  const b = parseMarkdown("## Cennik\n---\nlinia 1\nlinia 2");
  assert.deepEqual(b.map((x) => x.t), ["h", "hr", "p"]);
  assert.equal(b[2].lines.length, 2);
});

test("linki tylko http(s); javascript: zostaje zwykłym tekstem", () => {
  assert.equal(parseInline("[strona](https://okno.edu.pl)")[0].t, "link");
  assert.ok(parseInline("[klik](javascript:alert(1))").every((n) => n.t === "text"));
});

test("HTML z odpowiedzi to zwykły tekst, nie znaczniki", () => {
  const [p] = parseMarkdown("<script>alert(1)</script>");
  assert.deepEqual(p.lines[0], [{ t: "text", v: "<script>alert(1)</script>" }]);
});
