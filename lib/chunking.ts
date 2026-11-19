// Podział dokumentu bazy wiedzy na fragmenty (tabela chunks).
//   - jeden akapit (tekst oddzielony pustą linią) = jeden fragment; krótkich nie łączymy,
//   - akapit dłuższy niż MAX_CHUNK_LENGTH dzielimy na granicy zdania,
//   - zdanie dłuższe niż limit (rzadkość, np. lista bez kropek) – na granicy słowa.

export const MAX_CHUNK_LENGTH = 800;
export const MAX_DOCUMENT_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 200;

/** Akapity: tekst rozdzielony co najmniej jedną pustą linią (także z samymi spacjami). */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Zdania: koniec po . ! ? … (także z cudzysłowem/nawiasem), potem odstęp. */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?…]["”»)]?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Zbyt długie zdanie: tniemy na ostatniej spacji przed limitem (albo na sztywno). */
function splitLongSentence(sentence: string, max: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const space = rest.lastIndexOf(" ", max);
    const cut = space > 0 ? space : max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Dzieli długi akapit na kawałki ≤ max, sklejając całe zdania w kolejności. */
function splitLongParagraph(paragraph: string, max: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const sentence of splitSentences(paragraph)) {
    for (const part of sentence.length > max ? splitLongSentence(sentence, max) : [sentence]) {
      if (current && current.length + 1 + part.length > max) {
        pieces.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Fragmenty dokumentu w kolejności; każdy ma najwyżej `max` znaków. */
export function splitIntoChunks(text: string, max = MAX_CHUNK_LENGTH): string[] {
  return splitParagraphs(text).flatMap((p) => (p.length > max ? splitLongParagraph(p, max) : [p]));
}
