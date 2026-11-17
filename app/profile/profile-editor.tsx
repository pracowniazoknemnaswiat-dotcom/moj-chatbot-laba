"use client";

import { useState } from "react";
import {
  displayValue,
  factLabel,
  isWorkPreferenceKey,
  WORK_PREFERENCES,
} from "@/lib/work-preferences";
import styles from "./profile.module.css";

// Edycja profilu w przeglądarce. Dane zmienia wyłącznie serwer (/api/profile),
// po sprawdzeniu sesji i tych samych reguł co przy zapisie przez agenta.

export type ProfileData = { name: string | null; preferences: Record<string, unknown> };

type Target = { kind: "name" } | { kind: "fact"; key: string };

const targetId = (t: Target) => (t.kind === "name" ? "name" : `fact:${t.key}`);

function errorFrom(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

export default function ProfileEditor({ initial }: { initial: ProfileData }) {
  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  async function send(id: string, method: "PATCH" | "DELETE", body?: object): Promise<boolean> {
    setBusy(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    setNotice(null);
    try {
      const res = await fetch("/api/profile", {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [id]: errorFrom(data, "Nie udało się zapisać. Spróbuj ponownie.") }));
        return false;
      }
      setProfile((data as { profile: ProfileData }).profile);
      return true;
    } catch {
      setErrors((prev) => ({ ...prev, [id]: "Brak połączenia z serwerem. Spróbuj ponownie." }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function startEdit(target: Target, current: string) {
    setEditing(targetId(target));
    setDraft(current);
  }

  async function save(target: Target) {
    const id = targetId(target);
    const ok =
      target.kind === "name"
        ? await send(id, "PATCH", { action: "setName", value: draft })
        : await send(id, "PATCH", { action: "setFact", key: target.key, value: draft });
    if (ok) setEditing(null);
  }

  async function remove(target: Target) {
    const id = targetId(target);
    if (target.kind === "name") await send(id, "PATCH", { action: "removeName" });
    else await send(id, "PATCH", { action: "removeFact", key: target.key });
    if (editing === id) setEditing(null);
  }

  async function clearAll() {
    const ok = window.confirm(
      "Wyczyścić cały profil?\n\nAsystent zapomni imię, preferencje pracy i wszystkie zapamiętane fakty. Tego nie da się cofnąć.",
    );
    if (!ok) return;
    if (await send("all", "DELETE")) {
      setEditing(null);
      setNotice("Profil wyczyszczony. Asystent dopyta o preferencje przy następnej rozmowie.");
    }
  }

  function Row({ target, label, value, hint }: { target: Target; label: string; value: string; hint?: string }) {
    const id = targetId(target);
    const isEditing = editing === id;
    const locked = busy !== null;
    return (
      <div className={styles.row}>
        <dt>{label}</dt>
        <dd>
          {isEditing ? (
            <form
              className={styles.editForm}
              onSubmit={(e) => {
                e.preventDefault();
                void save(target);
              }}
            >
              <input
                className={styles.input}
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                maxLength={target.kind === "name" ? 60 : 200}
                placeholder={hint}
                aria-label={`Nowa wartość: ${label}`}
                autoFocus
              />
              <button className={styles.primary} type="submit" disabled={locked || !draft.trim()}>
                {busy === id ? "Zapisuję…" : "Zapisz"}
              </button>
              <button className={styles.secondary} type="button" onClick={() => setEditing(null)} disabled={locked}>
                Anuluj
              </button>
            </form>
          ) : (
            <div className={styles.valueLine}>
              <span className={value ? undefined : styles.missing}>
                {value || (hint ? `brak – asystent zapyta (${hint})` : "nie podano")}
              </span>
              <span className={styles.actions}>
                <button className={styles.secondary} type="button" onClick={() => startEdit(target, value)} disabled={locked}>
                  Edytuj
                </button>
                <button
                  className={styles.danger}
                  type="button"
                  onClick={() => void remove(target)}
                  disabled={locked || !value}
                >
                  {busy === id ? "Usuwam…" : "Usuń"}
                </button>
              </span>
            </div>
          )}
          {errors[id] && <p className={styles.error}>{errors[id]}</p>}
        </dd>
      </div>
    );
  }

  const prefs = profile.preferences;
  const otherFacts = Object.entries(prefs).filter(([key]) => !isWorkPreferenceKey(key));

  return (
    <>
      {notice && <p className={styles.notice}>{notice}</p>}

      <section className={styles.card}>
        <h2>Imię</h2>
        <dl className={styles.list}>
          {Row({ target: { kind: "name" }, label: "Imię", value: profile.name ?? "" })}
        </dl>
      </section>

      <section className={styles.card}>
        <h2>Preferencje pracy</h2>
        <dl className={styles.list}>
          {WORK_PREFERENCES.map((p) => (
            <div key={p.key}>
              {Row({
                target: { kind: "fact", key: p.key },
                label: p.label,
                value: displayValue(prefs[p.key]),
                hint: p.examples,
              })}
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.card}>
        <h2>Inne zapamiętane fakty</h2>
        {otherFacts.length === 0 ? (
          <p className={styles.missing}>Brak. Nowe fakty dodaje asystent, gdy powiesz mu coś o sobie.</p>
        ) : (
          <dl className={styles.list}>
            {otherFacts.map(([key, value]) => (
              <div key={key}>
                {Row({ target: { kind: "fact", key }, label: factLabel(key), value: displayValue(value) })}
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className={styles.clearBox}>
        <button className={styles.danger} type="button" onClick={() => void clearAll()} disabled={busy !== null}>
          {busy === "all" ? "Czyszczę…" : "Wyczyść profil"}
        </button>
        {errors.all && <p className={styles.error}>{errors.all}</p>}
      </div>
    </>
  );
}
