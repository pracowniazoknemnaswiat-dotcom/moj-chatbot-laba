"use client";

import { useState, type FormEvent } from "react";
import { MAX_DOCUMENT_LENGTH, MAX_TITLE_LENGTH } from "@/lib/chunking";
import {
  fragmentsLabel,
  sameTitle,
  STAGE_LABELS,
  STAGE_NAMES,
  type DocumentSummary,
  type ImportEvent,
  type ImportStage,
} from "@/lib/knowledge-shared";
import styles from "./upload.module.css";

// Formularz importu + lista dokumentów. Puste pola sprawdzamy od razu tutaj;
// podział, embeddingi i zapis robi wyłącznie serwer (/api/documents), a postęp
// przychodzi jako kolejne linie JSON z etapem.

const liczba = (n: number) => n.toLocaleString("pl-PL");

type Failure = { stage?: ImportStage; error: string; hint?: string };

function failureFrom(data: unknown, fallback: string): Failure {
  const d = data as { error?: unknown; hint?: unknown } | null;
  return {
    error: typeof d?.error === "string" ? d.error : fallback,
    hint: typeof d?.hint === "string" ? d.hint : undefined,
  };
}

/** Czyta strumień zdarzeń importu; wywołuje onEvent dla każdej linii. */
async function readEvents(res: Response, onEvent: (e: ImportEvent) => void) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ImportEvent);
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ImportEvent);
}

export default function KnowledgeBase({
  initialDocuments,
  initialError,
}: {
  initialDocuments: DocumentSummary[];
  initialError: string | null;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [documents, setDocuments] = useState(initialDocuments);
  const [listError, setListError] = useState(initialError);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function refreshList() {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) return setListError(failureFrom(data, "Nie udało się odświeżyć listy dokumentów.").error);
      setDocuments((data as { documents: DocumentSummary[] }).documents);
      setListError(null);
    } catch {
      setListError("Brak połączenia z serwerem – lista może być nieaktualna.");
    }
  }

  function confirmReplace(existing: { title: string; date: string; chunkCount: number }): boolean {
    return window.confirm(
      `Dokument „${existing.title}” już jest w bazie (wersja z ${existing.date}, ${fragmentsLabel(existing.chunkCount)}).\n\n` +
        "Zastąpić go nową wersją? Stare fragmenty zostaną usunięte, zostaną tylko nowe.",
    );
  }

  async function send(replace: boolean): Promise<void> {
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content, replace }),
    });

    // Ktoś w międzyczasie dodał dokument o tym tytule – pytamy i wysyłamy jeszcze raz.
    if (res.status === 409 && !replace) {
      const data = (await res.json().catch(() => null)) as {
        conflict?: { title: string; date: string; chunkCount: number };
      } | null;
      if (data?.conflict && confirmReplace(data.conflict)) return send(true);
      setFailure({ error: "Nie dodano: dokument o tym tytule już jest w bazie.", hint: "Zmień tytuł albo potwierdź zastąpienie." });
      return;
    }
    if (!res.ok || !res.body) {
      setFailure(failureFrom(await res.json().catch(() => null), "Nie udało się zapisać dokumentu."));
      return;
    }

    let finished = false;
    await readEvents(res, (e) => {
      if (e.type === "stage") setStage(e.stage);
      else if (e.type === "error") {
        finished = true;
        setFailure({ stage: e.stage, error: e.error, hint: e.hint });
      } else {
        finished = true;
        const extra = [
          e.replaced ? "Poprzednia wersja została zastąpiona." : "",
          e.backfilled ? `Uzupełniono też embeddingi starszych fragmentów: ${e.backfilled}.` : "",
        ].filter(Boolean);
        setNotice(`Zapisano dokument „${e.title}”: ${fragmentsLabel(e.chunks)}.${extra.length ? ` ${extra.join(" ")}` : ""}`);
        setWarnings(e.warnings);
        setTitle("");
        setContent("");
      }
    });
    if (!finished) {
      setFailure({
        error: "Połączenie z serwerem urwało się w trakcie importu.",
        hint: "Sprawdź listę poniżej – jeśli dokumentu na niej nie ma, dodaj go ponownie.",
      });
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setNotice(null);
    setWarnings([]);
    if (!title.trim()) return setFailure({ error: "Wpisz tytuł dokumentu." });
    if (!content.trim()) return setFailure({ error: "Wklej treść dokumentu." });

    const existing = documents.find((d) => sameTitle(d.title, title));
    if (existing && !confirmReplace(existing)) return;

    setFailure(null);
    setBusy(true);
    setStage("split");
    try {
      await send(Boolean(existing));
    } catch {
      setFailure({
        error: "Brak połączenia z serwerem.",
        hint: "Sprawdź internet i czy serwer działa (npm run dev), potem spróbuj ponownie.",
      });
    } finally {
      setBusy(false);
      setStage(null);
      await refreshList();
    }
  }

  async function remove(doc: DocumentSummary) {
    const ok = window.confirm(
      `Usunąć dokument „${doc.title}” (wersja z ${doc.date}, ${fragmentsLabel(doc.chunkCount)})?\n\n` +
        "Agent przestanie z niego korzystać. Tego nie da się cofnąć.",
    );
    if (!ok) return;
    setDeleting(doc.id);
    setListError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      // 404 = dokumentu już nie ma – też znika z listy.
      if (!res.ok && res.status !== 404) {
        const f = failureFrom(await res.json().catch(() => null), "Nie udało się usunąć dokumentu.");
        setListError(`${f.error} ${f.hint ?? "Spróbuj ponownie."}`);
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch {
      setListError("Brak połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <label className={styles.field}>
          <span className={styles.label}>Tytuł</span>
          <input
            className={styles.input}
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="np. Cennik 2026/2027"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Treść</span>
          <textarea
            className={styles.textarea}
            value={content}
            maxLength={MAX_DOCUMENT_LENGTH}
            disabled={busy}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Wklej treść dokumentu. Akapity oddziel pustą linią."
          />
          <span className={styles.hint}>
            {liczba(content.length)} / {liczba(MAX_DOCUMENT_LENGTH)} znaków
          </span>
        </label>

        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? "Trwa import…" : "Dodaj do bazy wiedzy"}
          </button>
          {busy && stage && (
            <span className={styles.progress} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              {STAGE_LABELS[stage]}
            </span>
          )}
        </div>

        {failure && (
          <div className={styles.failure} role="alert">
            <p className={styles.failureTitle}>
              {failure.stage
                ? `Import nie udał się na etapie: ${STAGE_NAMES[failure.stage]}.`
                : failure.error}
            </p>
            {failure.stage && <p>{failure.error}</p>}
            {failure.hint && (
              <p>
                <b>Co możesz zrobić:</b> {failure.hint}
              </p>
            )}
          </div>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className={styles.error}>
            {w}
          </p>
        ))}
      </form>

      <section className={styles.documents} aria-labelledby="lista-dokumentow">
        <h2 id="lista-dokumentow">Dokumenty w bazie ({documents.length})</h2>
        {listError && <p className={styles.error}>{listError}</p>}
        {documents.length === 0 ? (
          <p className={styles.empty}>Baza wiedzy jest pusta – dodaj pierwszy dokument powyżej.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Źródło (tytuł)</th>
                <th scope="col">Wersja (dodano)</th>
                <th scope="col">Fragmenty</th>
                <th scope="col">
                  <span className={styles.srOnly}>Akcje</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className={styles.docTitle}>{d.title}</td>
                  <td>{d.date}</td>
                  <td>{d.chunkCount}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => remove(d)}
                      disabled={deleting !== null || busy}
                      aria-label={`Usuń dokument: ${d.title}`}
                    >
                      {deleting === d.id ? "Usuwam…" : "Usuń"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
