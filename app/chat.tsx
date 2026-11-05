"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import styles from "./page.module.css";

export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat();

  const isBusy = status === "submitted" || status === "streaming";
  const canSend = input.trim() !== "" && !isBusy;

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
      <div className={styles.chat} aria-label="Rozmowa">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user" ? styles.userMessage : styles.botMessage
            }
          >
            <strong>{message.role === "user" ? "Ty: " : "Bot: "}</strong>
            {message.parts.map((part, i) =>
              part.type === "text" ? (
                <span key={`${message.id}-${i}`}>{part.text}</span>
              ) : null,
            )}
          </div>
        ))}
        {status === "submitted" && (
          <div className={styles.waiting}>Bot pisze...</div>
        )}
        {error && <div className={styles.error}>{error.message}</div>}
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          sendMessage({ text: input.trim() });
          setInput("");
        }}
      >
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder="Napisz wiadomość..."
          aria-label="Wiadomość"
        />
        <button className={styles.button} type="submit" disabled={!canSend}>
          {isBusy ? "Czekaj..." : "Wyślij"}
        </button>
      </form>
    </main>
  );
}
