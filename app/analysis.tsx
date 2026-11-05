"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/triage";
import styles from "./page.module.css";

const CATEGORY_LABELS = {
  sales: "sales — oferta i cena",
  support: "support — problem techniczny",
  billing: "billing — płatność lub zwrot",
  unknown: "unknown — brak rozpoznanej sprawy",
} as const;

const PRIORITY_LABELS = { normal: "normal", high: "high — pilne" } as const;

export default function Analysis() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    setResult(null);
    setRequestError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRequestError(data?.error ?? `Błąd serwera (HTTP ${res.status}).`);
      } else {
        setResult(data as AnalysisResult);
      }
    } catch {
      setRequestError("Brak połączenia z serwerem.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <form
        className={styles.analysisForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && message.trim()) analyze();
        }}
      >
        <textarea
          className={styles.textarea}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          placeholder="Wklej wiadomość od klienta..."
          aria-label="Wiadomość klienta"
          rows={5}
        />
        <button
          className={styles.button}
          type="submit"
          disabled={busy || !message.trim()}
        >
          {busy ? "Analizuję..." : "Analizuj"}
        </button>
      </form>

      {requestError && <div className={styles.error}>{requestError}</div>}

      {result && !result.ok && (
        <div className={styles.error}>
          <strong>Analiza nieudana.</strong> {result.message}
          {result.details.length > 0 && (
            <ul>
              {result.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result?.ok && (
        <div className={styles.triage}>
          <dl className={styles.fields}>
            <dt>Kategoria</dt>
            <dd>{CATEGORY_LABELS[result.result.category]}</dd>
            <dt>Priorytet</dt>
            <dd>{PRIORITY_LABELS[result.result.priority]}</dd>
            <dt>Status sprawdzenia</dt>
            <dd>
              {result.result.needs_review
                ? "⚠ Wymaga sprawdzenia przez pracownika"
                : "Bez decyzji pracownika — nadal tylko szkic, przeczytaj przed wysłaniem"}
            </dd>
          </dl>
          {result.checks.length > 0 && (
            <div className={styles.warning}>
              <strong>
                {result.forcedReview
                  ? "Kontrola backendu wymusiła sprawdzenie (model ustawił needs_review = false):"
                  : "Uwagi kontroli backendu:"}
              </strong>
              <ul>
                {result.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <strong>Szkic odpowiedzi (nie został wysłany):</strong>
            <p className={styles.draft}>{result.result.draft}</p>
          </div>
          <details>
            <summary>JSON</summary>
            <pre className={styles.json}>
              {JSON.stringify(result.result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
