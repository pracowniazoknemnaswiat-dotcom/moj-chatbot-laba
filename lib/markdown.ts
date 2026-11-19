// Mały, bezpieczny parser markdownu dla odpowiedzi czatu (bez zewnętrznej biblioteki).
// Zwraca drzewo, z którego komponent buduje elementy React – nigdy surowy HTML,
// więc tekst modelu nie może wstrzyknąć znaczników ani skryptów.
// Obsługa: akapity, nagłówki (#–####), listy punktowane i numerowane (także zagnieżdżone),
// **pogrubienie**, *kursywa*, `kod`, [link](https://…), linia pozioma.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type ListItem = { c: Inline[]; children: Block[] };

export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "h"; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: "ul"; items: ListItem[] }
  | { t: "ol"; start: number; items: ListItem[] }
  | { t: "hr" };

// ───────────────────────── tekst w linii ─────────────────────────

const INLINE_RULES: { re: RegExp; build: (m: RegExpExecArray) => Inline }[] = [
  { re: /`([^`\n]+)`/, build: (m) => ({ t: "code", v: m[1] }) },
  { re: /\*\*(?=\S)(.+?)(?<=\S)\*\*/, build: (m) => ({ t: "strong", c: parseInline(m[1]) }) },
  { re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, build: (m) => ({ t: "link", href: m[2], c: parseInline(m[1]) }) },
  // *kursywa* – nie myli się z „2 * 3” (spacje) ani z **pogrubieniem**.
  { re: /(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/, build: (m) => ({ t: "em", c: parseInline(m[1]) }) },
];

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    let best: { index: number; length: number; node: Inline } | null = null;
    for (const { re, build } of INLINE_RULES) {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length, node: build(m) };
    }
    if (!best) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (best.index > 0) out.push({ t: "text", v: rest.slice(0, best.index) });
    out.push(best.node);
    rest = rest.slice(best.index + best.length);
  }
  return out;
}

// ───────────────────────── bloki ─────────────────────────

const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*•+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

type ListLine = { indent: number; ordered: boolean; num: number; text: string };

function listLine(line: string): ListLine | null {
  const b = BULLET.exec(line);
  if (b && !RULE.test(line)) return { indent: b[1].length, ordered: false, num: 0, text: b[2] };
  const n = NUMBERED.exec(line);
  if (n) return { indent: n[1].length, ordered: true, num: Number(n[2]), text: n[3] };
  return null;
}

/** Buduje (zagnieżdżone) listy z kolejnych linii listy; głębiej wcięte = podlista. */
function buildLists(lines: ListLine[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i];
    const items: ListItem[] = [];
    // Elementy tego samego poziomu i rodzaju.
    while (i < lines.length && lines[i].indent <= first.indent && lines[i].ordered === first.ordered) {
      const item: ListItem = { c: parseInline(lines[i].text), children: [] };
      i++;
      const nested: ListLine[] = [];
      while (i < lines.length && lines[i].indent > first.indent) nested.push(lines[i++]);
      if (nested.length) item.children = buildLists(nested);
      items.push(item);
    }
    blocks.push(first.ordered ? { t: "ol", start: first.num || 1, items } : { t: "ul", items });
  }
  return blocks;
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  let list: ListLine[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ t: "p", lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(...buildLists(list));
    list = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ t: "hr" });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushParagraph();
      flushList();
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3 | 4, c: parseInline(h[2]) });
      continue;
    }
    const li = listLine(line);
    if (li) {
      flushParagraph();
      list.push(li);
      continue;
    }
    if (list.length && /^\s+/.test(line)) {
      // Wcięta kontynuacja elementu listy.
      list[list.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(parseInline(line.trim()));
  }
  flushParagraph();
  flushList();
  return blocks;
}
