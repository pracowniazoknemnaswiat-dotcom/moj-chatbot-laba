"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type FileUIPart,
  type SourceUrlUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GeneratedImageOutput } from "@/lib/image-generation";
import {
  komunikatZatrzymania,
  krokiZNarzedziami,
  opisKrokow,
  opisStatystyk,
  type PowodZatrzymania,
} from "@/lib/steps";
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
        <Link className={styles.navLink} href="/dashboard">
          ✈️ Asystent podróży
        </Link>
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

// Metadane odpowiedzi bota (z serwera): model, który faktycznie odpowiedział,
// statystyki zadania i powód zatrzymania (limit kroków / wywołań / czasu).
type ChatMessage = UIMessage<{
  modelId?: string | null;
  liczbaKrokow?: number;
  liczbaWywolan?: number;
  czasMs?: number;
  powodZatrzymania?: PowodZatrzymania | null;
}>;

// Przycisk „Wygeneruj obraz” wysyła wiadomość z tym początkiem;
// model wywołuje wtedy narzędzie generujObraz.
const IMAGE_REQUEST_PREFIX = "Wygeneruj obraz: ";
const IMAGE_TOOL_PART = "tool-generujObraz";

// Wynik narzędzia generujObraz (lib/image-generation.ts).
type ImageToolOutput = Partial<GeneratedImageOutput>;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Wygenerowane obrazy są już na ekranie, a model i tak dostaje zamiast nich
// tekst „obraz wygenerowany” (toModelOutput). Nie odsyłamy więc na serwer
// danych obrazu – zapytania nie rosną z każdym obrazem.
function withoutGeneratedImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === IMAGE_TOOL_PART &&
      "state" in part &&
      part.state === "output-available"
        ? { ...part, output: { ...(part.output as ImageToolOutput), image: "" } }
        : part,
    ),
  }));
}

// Serwer zwraca błędy jako JSON {"error": "..."}; pokazujemy sam komunikat.
function errorText(message: string): string {
  try {
    const data = JSON.parse(message);
    if (typeof data?.error === "string") return data.error;
  } catch {
    // To nie JSON – komunikat ze strumienia.
  }
  return message;
}

function PlainChat() {
  const [input, setInput] = useState("");
  // Kiedy pobrano odpowiedź (a z nią źródła), osobno dla każdej wiadomości.
  const [fetchedAt, setFetchedAt] = useState<Record<string, Date>>({});
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/agent",
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
          body: {
            mode: "chat",
            id,
            trigger,
            messageId,
            messages: withoutGeneratedImages(messages),
          },
        }),
      }),
  );

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport,
    onFinish: ({ message }) =>
      setFetchedAt((prev) => ({ ...prev, [message.id]: new Date() })),
  });

  // Blokada od razu przy kliknięciu: stan Reacta odświeża się dopiero po
  // chwili, więc szybkie podwójne kliknięcie mogłoby wysłać dwa zlecenia.
  const sendLock = useRef(false);
  const isBusy = status === "submitted" || status === "streaming";
  useEffect(() => {
    if (!isBusy) sendLock.current = false;
  }, [isBusy]);

  const lastUserText =
    [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.parts.find((p) => p.type === "text")?.text ?? "";
  const isGenerating = isBusy && lastUserText.startsWith(IMAGE_REQUEST_PREFIX);

  // Podczas odpowiedzi (także generowania obrazu) przyciski są zablokowane.
  const locked = isBusy;
  const canSend = (input.trim() !== "" || photo !== null) && !locked;
  const canGenerate =
    input.trim() !== "" &&
    input.trim().length <= MAX_IMAGE_PROMPT_LENGTH &&
    !locked &&
    photo === null;

  function send(message: Parameters<typeof sendMessage>[0]) {
    if (sendLock.current) return;
    sendLock.current = true;
    sendMessage(message);
  }

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

  function generate() {
    if (!canGenerate) return;
    send({ text: `${IMAGE_REQUEST_PREFIX}${input.trim()}` });
    setInput("");
  }

  return (
    <div className={styles.stack}>
      <div className={styles.chat} aria-label="Rozmowa">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const aboutPhoto =
            message.role === "assistant" &&
            previous?.parts.some((p) => p.type === "file");
          return (
            <div
              key={message.id}
              className={
                message.role === "user" ? styles.userMessage : styles.botMessage
              }
            >
              {message.role === "assistant" && (
                <>
                  <StepsList parts={message.parts} />
                  <ToolBadges parts={message.parts} />
                  {message.metadata?.powodZatrzymania && (
                    <div className={styles.limitNote}>
                      {komunikatZatrzymania(message.metadata.powodZatrzymania)} Poniżej to, co
                      udało się ustalić.
                    </div>
                  )}
                </>
              )}
              <strong>{message.role === "user" ? "Ty: " : "Bot: "}</strong>
              {message.role === "assistant" &&
                message.metadata?.powodZatrzymania &&
                !message.parts.some((p) => p.type === "text" && p.text.trim()) && (
                  <span>
                    Nie zdążyłem przygotować podsumowania. Zadaj pytanie w mniejszych
                    częściach albo dopytaj o konkretną rzecz.
                  </span>
                )}
              {message.parts.map((part, i) => {
                const key = `${message.id}-${i}`;
                if (part.type === "text") {
                  return <span key={key}>{part.text}</span>;
                }
                if (part.type === "file" && part.mediaType.startsWith("image/")) {
                  return (
                    // Miniatura dołączonego zdjęcia (data URL z przeglądarki).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={key}
                      className={styles.thumbnail}
                      src={part.url}
                      alt={part.filename ?? "Dołączone zdjęcie"}
                    />
                  );
                }
                if (part.type === IMAGE_TOOL_PART && isToolUIPart(part)) {
                  return <ImageToolView key={key} part={part} />;
                }
                return null;
              })}
              <Sources
                sources={message.parts.filter((p) => p.type === "source-url")}
                fetchedAt={fetchedAt[message.id]}
              />
              {aboutPhoto && message.metadata && (
                <ModelNote modelId={message.metadata.modelId} />
              )}
              {message.role === "assistant" && message.metadata && (
                <div className={styles.stats}>{opisStatystyk(message.metadata)}</div>
              )}
            </div>
          );
        })}
        {status === "submitted" && (
          <div className={styles.waiting}>
            {isGenerating ? "Generuję obraz…" : "Bot pisze..."}
          </div>
        )}
        {error && <div className={styles.error}>{errorText(error.message)}</div>}
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
          send(photo ? { text, files: [photo] } : { text });
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

function downloadName(prompt: string, image: string): string {
  const ext = image.match(/^data:image\/(\w+)/)?.[1] ?? "png";
  const slug =
    prompt
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "obraz";
  return `${slug}.${ext === "jpeg" ? "jpg" : ext}`;
}

// Obraz z narzędzia generujObraz, w miejscu wywołania w odpowiedzi bota.
function ImageToolView({ part }: { part: ToolUIPart }) {
  const prompt = (part.input as { prompt?: string } | undefined)?.prompt ?? "";

  if (part.state === "output-error") {
    return <div className={styles.error}>{part.errorText}</div>;
  }
  if (part.state !== "output-available") {
    return (
      <div className={styles.waiting}>
        Generuję obraz…
      </div>
    );
  }

  const output = part.output as ImageToolOutput;
  if (!output.image) return null;

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.generated}
        src={output.image}
        alt={`Wygenerowany obraz: ${prompt}`}
      />
      <a
        className={styles.secondaryButton}
        href={output.image}
        download={downloadName(prompt, output.image)}
      >
        ⬇️ Pobierz
      </a>
      <ModelNote modelId={output.modelId} confirmed={output.modelConfirmed} />
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "🔎 wyszukiwanie",
  generujObraz: "🎨 generujObraz",
  pogoda: "🌦️ pogoda",
  waluty: "💱 waluty",
  swieta: "📅 swieta",
  wikipedia: "📚 wikipedia",
  kalkulator: "🧮 kalkulator",
  czas: "🕒 czas",
  notatki: "📝 notatki",
  diagnostyka: "🩺 diagnostyka",
  ferie: "🏖️ ferie",
};

// Kroki agenta po kolei: „1. pogoda → 2. waluty → 3. kalkulator”.
function StepsList({ parts }: { parts: UIMessage["parts"] }) {
  const kroki = krokiZNarzedziami(parts);
  if (kroki.length === 0) return null;
  return (
    <div className={styles.steps} aria-label="Kroki agenta">
      Kroki: {opisKrokow(kroki, STEP_NAMES)}
    </div>
  );
}

// Nazwy narzędzi w liście kroków (bez emoji – emoji są na plakietkach).
const STEP_NAMES: Record<string, string> = { web_search: "wyszukiwanie" };

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
