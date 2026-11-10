"use client";

import { useChat } from "@ai-sdk/react";
import {
  getToolName,
  isToolUIPart,
  type FileUIPart,
  type SourceUrlUIPart,
  type UIMessage,
} from "ai";
import { Fragment, useRef, useState } from "react";
import {
  ALLOWED_IMAGE_TYPES,
  imageFileProblem,
  MAX_IMAGE_PROMPT_LENGTH,
} from "@/lib/images";
import Analysis from "./analysis";
import styles from "./page.module.css";

type Mode = "chat" | "analysis";

export default function Chat() {
  const [mode, setMode] = useState<Mode>("chat");

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>Mój chatbot</h1>
        <form action="/api/logout" method="post">
          <button className={styles.logout} type="submit">
            Wyjdź
          </button>
        </form>
      </div>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          className={mode === "chat" ? styles.tabActive : styles.tab}
          onClick={() => setMode("chat")}
        >
          Czat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "analysis"}
          className={mode === "analysis" ? styles.tabActive : styles.tab}
          onClick={() => setMode("analysis")}
        >
          Analiza wiadomości
        </button>
      </div>
      {/* Oba tryby zostają zamontowane, żeby przełączanie nie kasowało treści. */}
      <div hidden={mode !== "chat"}>
        <PlainChat />
      </div>
      <div hidden={mode !== "analysis"}>
        <Analysis />
      </div>
    </main>
  );
}

// Metadane odpowiedzi bota: model, który faktycznie odpowiedział (z API).
type ChatMessage = UIMessage<{ modelId?: string | null }>;

// Obraz wygenerowany przez /api/image. "after" = po ilu wiadomościach czatu
// go pokazać, żeby stał w rozmowie we właściwym miejscu.
type GeneratedImage = {
  id: string;
  after: number;
  prompt: string;
  status: "loading" | "done" | "error";
  image?: string;
  modelId?: string | null;
  modelConfirmed?: boolean;
  error?: string;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function PlainChat() {
  const [input, setInput] = useState("");
  // Kiedy pobrano odpowiedź (a z nią źródła), osobno dla każdej wiadomości.
  const [fetchedAt, setFetchedAt] = useState<Record<string, Date>>({});
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    onFinish: ({ message }) =>
      setFetchedAt((prev) => ({ ...prev, [message.id]: new Date() })),
  });

  // Blokada od razu przy kliknięciu: stan Reacta odświeża się dopiero po
  // chwili, więc szybkie podwójne kliknięcie mogłoby wysłać dwa zlecenia.
  const generatingLock = useRef(false);

  const isBusy = status === "submitted" || status === "streaming";
  const isGenerating = images.some((img) => img.status === "loading");
  // Podczas generowania obrazu wszystkie przyciski są zablokowane.
  const locked = isBusy || isGenerating;
  const canSend = (input.trim() !== "" || photo !== null) && !locked;
  const canGenerate =
    input.trim() !== "" &&
    input.trim().length <= MAX_IMAGE_PROMPT_LENGTH &&
    !locked &&
    photo === null;

  // Sprawdzenie pliku w całości w przeglądarce – zły plik nie trafia na serwer.
  async function onPhotoChosen(file: File | undefined) {
    setPhotoError(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    const problem = imageFileProblem(file.type, file.size);
    if (problem) {
      setPhotoError(`${file.name}: ${problem}`);
      setPhoto(null);
      return;
    }
    try {
      const url = await readAsDataUrl(file);
      setPhoto({ type: "file", mediaType: file.type, filename: file.name, url });
    } catch {
      setPhotoError("Nie udało się odczytać pliku. Wybierz inne zdjęcie.");
    }
  }

  async function generate() {
    const prompt = input.trim();
    if (!canGenerate || generatingLock.current) return;
    generatingLock.current = true;
    const id = crypto.randomUUID();
    setImages((prev) => [
      ...prev,
      { id, after: messages.length, prompt, status: "loading" },
    ]);
    setInput("");

    const update = (patch: Partial<GeneratedImage>) =>
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch } : img)));

    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.image !== "string") {
        update({
          status: "error",
          error: data.error ?? "Nie udało się wygenerować obrazu. Spróbuj ponownie.",
        });
        return;
      }
      update({
        status: "done",
        image: data.image,
        modelId: data.modelId,
        modelConfirmed: data.modelConfirmed === true,
      });
    } catch {
      update({
        status: "error",
        error: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
      });
    } finally {
      generatingLock.current = false;
    }
  }

  const imagesAfter = (count: number) =>
    images
      .filter((img) => img.after === count)
      .map((img) => <GeneratedImageView key={img.id} item={img} />);

  return (
    <div className={styles.stack}>
      <div className={styles.chat} aria-label="Rozmowa">
        {imagesAfter(0)}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const aboutPhoto =
            message.role === "assistant" &&
            previous?.parts.some((p) => p.type === "file");
          return (
            <Fragment key={message.id}>
              <div
                className={
                  message.role === "user" ? styles.userMessage : styles.botMessage
                }
              >
                {message.role === "assistant" && (
                  <ToolBadges parts={message.parts} />
                )}
                <strong>{message.role === "user" ? "Ty: " : "Bot: "}</strong>
                {message.parts.map((part, i) =>
                  part.type === "text" ? (
                    <span key={`${message.id}-${i}`}>{part.text}</span>
                  ) : null,
                )}
                {message.parts.map((part, i) =>
                  part.type === "file" && part.mediaType.startsWith("image/") ? (
                    // Miniatura dołączonego zdjęcia (data URL z przeglądarki).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${message.id}-file-${i}`}
                      className={styles.thumbnail}
                      src={part.url}
                      alt={part.filename ?? "Dołączone zdjęcie"}
                    />
                  ) : null,
                )}
                <Sources
                  sources={message.parts.filter((p) => p.type === "source-url")}
                  fetchedAt={fetchedAt[message.id]}
                />
                {aboutPhoto && message.metadata && (
                  <ModelNote modelId={message.metadata.modelId} />
                )}
              </div>
              {imagesAfter(index + 1)}
            </Fragment>
          );
        })}
        {status === "submitted" && (
          <div className={styles.waiting}>Bot pisze...</div>
        )}
        {error && <div className={styles.error}>{error.message}</div>}
      </div>

      {photo && (
        <div className={styles.attachment}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.thumbnail} src={photo.url} alt="Wybrane zdjęcie" />
          <span>{photo.filename}</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setPhoto(null)}
          >
            Usuń
          </button>
        </div>
      )}
      {photoError && <div className={styles.error}>{photoError}</div>}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          const text = input.trim() || "Co jest na tym zdjęciu?";
          sendMessage(photo ? { text, files: [photo] } : { text });
          setInput("");
          setPhoto(null);
        }}
      >
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder="Napisz wiadomość albo opis obrazu..."
          aria-label="Wiadomość"
        />
        <button className={styles.button} type="submit" disabled={!canSend}>
          {isBusy ? "Czekaj..." : "Wyślij"}
        </button>
      </form>

      <div className={styles.imageActions}>
        <input
          ref={fileInput}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          hidden
          onChange={(e) => onPhotoChosen(e.currentTarget.files?.[0])}
        />
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => fileInput.current?.click()}
          disabled={locked}
        >
          📎 Dodaj zdjęcie
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={generate}
          disabled={!canGenerate}
          aria-busy={isGenerating}
          title={
            photo
              ? "Najpierw wyślij albo usuń wybrane zdjęcie"
              : "Wygeneruj obraz z wpisanego opisu"
          }
        >
          {isGenerating ? "Generuję obraz…" : "🎨 Wygeneruj obraz"}
        </button>
        {input.trim().length > MAX_IMAGE_PROMPT_LENGTH && (
          <small>
            Opis obrazu może mieć najwyżej {MAX_IMAGE_PROMPT_LENGTH} znaków.
          </small>
        )}
      </div>

      <div className={styles.suggestions}>
        <span>Podpowiedzi obrazów:</span>
        {IMAGE_SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            className={styles.suggestion}
            disabled={locked}
            title={s.prompt}
            onClick={() => setInput(s.prompt)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelNote({
  modelId,
  confirmed = true,
}: {
  modelId?: string | null;
  confirmed?: boolean;
}) {
  return (
    <small className={styles.modelNote}>
      {!modelId
        ? "model: API nie podało identyfikatora"
        : confirmed
          ? `model: ${modelId}`
          : `model: ${modelId} (żądany, API nie potwierdziło)`}
    </small>
  );
}

// Podpowiedzi opisów obrazu dla Pracowni z Oknem na Świat. Kliknięcie wpisuje
// opis do pola, żeby można go było jeszcze poprawić przed wygenerowaniem.
const IMAGE_SUGGESTIONS = [
  {
    label: "📚 Plakat kursu ósmoklasisty",
    prompt:
      "Kolorowy plakat zachęcający do kursu przygotowującego do egzaminu ósmoklasisty: uczniowie przy stole z książkami, okno z widokiem na świat, ciepłe kolory, bez napisów",
  },
  {
    label: "🪟 Logo Pracowni",
    prompt:
      "Minimalistyczne logo pracowni edukacyjnej: otwarte okno, przez które widać kulę ziemską i otwartą książkę, dwa kolory, białe tło",
  },
  {
    label: "🧮 Ilustracja do korepetycji",
    prompt:
      "Przyjazna ilustracja do zajęć online z matematyki: nastolatek przy laptopie, wokół unoszą się wzory i figury geometryczne, styl płaski, pastelowe kolory",
  },
];

function downloadName(item: GeneratedImage): string {
  const ext = item.image?.match(/^data:image\/(\w+)/)?.[1] ?? "png";
  const slug =
    item.prompt
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "obraz";
  return `${slug}.${ext === "jpeg" ? "jpg" : ext}`;
}

function GeneratedImageView({ item }: { item: GeneratedImage }) {
  return (
    <>
      <div className={styles.userMessage}>
        <strong>Ty: </strong>🎨 {item.prompt}
      </div>
      <div className={styles.botMessage}>
        <strong>Obraz: </strong>
        {item.status === "loading" && (
          <span className={styles.waiting}>Generuję obraz…</span>
        )}
        {item.status === "error" && (
          <div className={styles.error}>{item.error}</div>
        )}
        {item.status === "done" && item.image && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.generated}
              src={item.image}
              alt={`Wygenerowany obraz: ${item.prompt}`}
            />
            <a
              className={styles.secondaryButton}
              href={item.image}
              download={downloadName(item)}
            >
              ⬇️ Pobierz
            </a>
            <ModelNote modelId={item.modelId} confirmed={item.modelConfirmed} />
          </>
        )}
      </div>
    </>
  );
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "🔎 wyszukiwanie",
  aktualnyCzas: "🕒 aktualnyCzas",
};

// Etykiety użytych narzędzi (każde raz). Wyszukiwanie OpenRouter działa po
// stronie serwera i nie zawsze wysyła osobny wpis o wywołaniu – wtedy
// poznajemy je po tym, że przyszły źródła.
function ToolBadges({ parts }: { parts: UIMessage["parts"] }) {
  const names = new Set<string>();
  for (const part of parts) {
    if (isToolUIPart(part)) names.add(getToolName(part));
    if (part.type === "source-url") names.add("web_search");
  }
  if (names.size === 0) return null;

  return (
    <div className={styles.toolBadges}>
      {[...names].map((name) => (
        <span key={name} className={styles.toolBadge}>
          {TOOL_LABELS[name] ?? `🛠️ ${name}`}
        </span>
      ))}
    </div>
  );
}

// Dopuszczamy tylko linki http(s), żeby źródło nie mogło podsunąć np. "javascript:".
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function Sources({
  sources,
  fetchedAt,
}: {
  sources: SourceUrlUIPart[];
  fetchedAt?: Date;
}) {
  // To samo źródło może przyjść kilka razy (kilka kroków wyszukiwania).
  const unique = sources.filter(
    (s, i) => sources.findIndex((o) => o.url === s.url) === i,
  );
  if (unique.length === 0) return null;

  return (
    <div className={styles.sources}>
      <strong>Źródła</strong>
      <ul>
        {unique.map((s) => {
          const href = safeHref(s.url);
          const label = s.title || s.url;
          return (
            <li key={s.sourceId}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ul>
      {fetchedAt && (
        <small>
          pobrano:{" "}
          {fetchedAt.toLocaleString("pl-PL", {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </small>
      )}
    </div>
  );
}
