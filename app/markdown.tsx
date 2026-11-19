import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import styles from "./page.module.css";

// Odpowiedź czatu z formatowaniem markdown. Tylko elementy React (bez innerHTML);
// linki wyłącznie http(s), otwierane w nowej karcie.

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "strong":
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.c)}</em>;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((b, i) => {
    switch (b.t) {
      case "p":
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      case "h": {
        // Nagłówki w dymku czatu: zawsze mniejsze niż tytuł strony.
        const Tag = (["h3", "h4", "h5", "h6"] as const)[b.level - 1];
        return <Tag key={i}>{renderInline(b.c)}</Tag>;
      }
      case "ul":
      case "ol": {
        const items = b.items.map((item, j) => (
          <li key={j}>
            {renderInline(item.c)}
            {item.children.length > 0 && renderBlocks(item.children)}
          </li>
        ));
        return b.t === "ul" ? (
          <ul key={i}>{items}</ul>
        ) : (
          <ol key={i} start={b.start}>
            {items}
          </ol>
        );
      }
      case "hr":
        return <hr key={i} />;
    }
  });
}

export default function Markdown({ text }: { text: string }) {
  return <div className={styles.markdown}>{renderBlocks(parseMarkdown(text))}</div>;
}
