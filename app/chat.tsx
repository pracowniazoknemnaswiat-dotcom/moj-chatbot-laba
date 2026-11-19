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
// Bez połączenia z bazą – to jest wyłącznie w lib/supabase.ts (tylko serwer).
import { conversationHref, NEW_CONVERSATION_HREF } from "@/lib/conversation-link";
import type { StoredMessage } from "@/lib/conversation-text";
import type { GeneratedImageOutput } from "@/lib/image-generation";
import {
  similarityPercent,
  usedSources,
  withoutSourceLine,
  type SourceFragment,
} from "@/lib/knowledge-shared";
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
import Markdown from "./markdown";
import styles from "./page.module.css";

type Mode = "chat" | "analysis";

type ChatProps = {
  /** Ostatnia rozmowa z bazy (null = brak rozmów albo błąd bazy). */
  initialConversationId: number | null;
  initialMessages: StoredMessage[];
  /** Komunikat, gdy nie udało się wczytać rozmowy z bazy. */
  storageError: string | null;
};

export default function Chat(props: ChatProps) {
  const [mode, setMode] = useState<Mode>("chat");

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>Mój chatbot</h1>
        <Link className={styles.navLink} href="/history">
          🗂️ Historia
        </Link>
        <Link className={styles.navLink} href="/profile">
          👤 Profil
        </Link>
        <Link className={styles.navLink} href="/upload">
          📚 Baza wiedzy
        </Link>
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
        <PlainChat {...props} />
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
  /** Numer rozmowy w bazie (serwer wysyła go na początku odpowiedzi). */
  conversationId?: number;
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

// Wiadomości z bazy (sam tekst) w formacie czatu.
function fromStored(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.text }],
  }));
}

function PlainChat({ initialConversationId, initialMessages, storageError }: ChatProps) {
  const [input, setInput] = useState("");
  // Numer bieżącej rozmowy w bazie; null = następna wiadomość założy nową.
  // Czytany przy wysłaniu wiadomości (send), nie podczas renderowania.
  const conversationId = useRef<number | null>(initialConversationId);
  // Kiedy pobrano odpowiedź (a z nią źródła), osobno dla każdej wiadomości.
  const [fetchedAt, setFetchedAt] = useState<Record<string, Date>>({});
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/agent",
        // body = opcje z sendMessage (numer rozmowy podany przy wysłaniu).
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => ({
          body: {
            mode: "chat",
            id,
            trigger,
            messageId,
            conversationId: (body?.conversationId as number | null | undefined) ?? null,
            messages: withoutGeneratedImages(messages),
          },
        }),
      }),
  );

  const [startMessages] = useState(() => fromStored(initialMessages));
  const { messages, sendMessage, setMessages, clearError, status, error } =
    useChat<ChatMessage>({
      transport,
      messages: startMessages,
      onFinish: ({ message }) =>
        setFetchedAt((prev) => ({ ...prev, [message.id]: new Date() })),
    });

  // Serwer podaje numer rozmowy na początku odpowiedzi – zapamiętujemy go,
  // żeby kolejne wiadomości trafiły do tej samej rozmowy, i wpisujemy do adresu
  // (/?c=12), żeby odświeżenie strony (F5) otworzyło tę samą rozmowę.
  useEffect(() => {
    const fromServer = [...messages]
      .reverse()
      .find((m) => m.metadata?.conversationId)?.metadata?.conversationId;
    const id = fromServer ?? conversationId.current;
    if (fromServer) conversationId.current = fromServer;
    if (id) {
      const href = conversationHref(id);
      if (`${window.location.pathname}${window.location.search}` !== href) {
        window.history.replaceState(null, "", href);
      }
    }
  }, [messages]);

  // Pusta rozmowa; poprzednia zostaje w bazie. Nowy wpis w bazie
  // powstanie dopiero przy pierwszej wiadomości.
  function newConversation() {
    conversationId.current = null;
    window.history.replaceState(null, "", NEW_CONVERSATION_HREF);
    setMessages([]);
    clearError();
    setFetchedAt({});
    setPhoto(null);
    setPhotoError(null);
  }

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
    sendMessage(message, { body: { conversationId: conversationId.current } });
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
      <div className={styles.imageActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={newConversation}
          disabled={locked || messages.length === 0}
          title="Zacznij pustą rozmowę – poprzednia zostaje zapisana"
        >
          ➕ Nowa rozmowa
        </button>
      </div>
      {storageError && <div className={styles.error}>{storageError}</div>}
      <div className={styles.chat} aria-label="Rozmowa">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const aboutPhoto =
            message.role === "assistant" &&
            previous?.parts.some((p) => p.type === "file");
          // Źródła z bazy wiedzy – gdy są, linia „📎 Źródło” z tekstu zamienia się w listę.
          const knowledge = message.role === "assistant" ? knowledgeSourcesOf(message.parts) : [];
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
                  if (message.role !== "assistant") return <span key={key}>{part.text}</span>;
                  const text = knowledge.length ? withoutSourceLine(part.text) : part.text;
                  return text.trim() ? <Markdown key={key} text={text} /> : null;
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
              <KnowledgeSources sources={knowledge} />
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
  wikipedia: "📖 wikipedia",
  searchKnowledge: "📚 baza wiedzy",
  kalkulator: "🧮 kalkulator",
  czas: "🕒 czas",
  notatki: "📝 notatki",
  diagnostyka: "🩺 diagnostyka",
  zapiszProfil: "🧠 zapamiętuję",
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
const STEP_NAMES: Record<string, string> = {
  web_search: "wyszukiwanie",
  searchKnowledge: "baza wiedzy",
};

/** Fragmenty bazy wiedzy użyte w odpowiedzi (wyniki searchKnowledge + linia „📎 Źródło”). */
function knowledgeSourcesOf(parts: UIMessage["parts"]): SourceFragment[] {
  const outputs = parts
    .filter(
      (p): p is ToolUIPart =>
        isToolUIPart(p) && getToolName(p) === "searchKnowledge" && p.state === "output-available",
    )
    .map((p) => p.output);
  const answer = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  return usedSources(outputs, answer);
}

// Lista źródeł z bazy wiedzy: tytuł, podobieństwo i rozwijany dokładny tekst fragmentu.
function KnowledgeSources({ sources }: { sources: SourceFragment[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (sources.length === 0) return null;
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className={styles.sources}>
      <strong>📎 Źródła z bazy wiedzy</strong>
      <ul className={styles.knowledgeList}>
        {sources.map((s, i) => (
          <li key={`${s.tytul}-${i}`}>
            <span className={styles.knowledgeTitle}>{s.tytul}</span>{" "}
            <span className={styles.similarity} title="Podobieństwo fragmentu do pytania">
              {similarityPercent(s.podobienstwo)}
            </span>{" "}
            <button
              type="button"
              className={styles.fragmentToggle}
              onClick={() => toggle(i)}
              aria-expanded={open.has(i)}
            >
              {open.has(i) ? "Ukryj fragment" : "Pokaż fragment"}
            </button>
            {open.has(i) && <blockquote className={styles.fragmentText}>{s.tresc}</blockquote>}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
