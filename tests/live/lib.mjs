// Wspólne funkcje testów na żywo (prawdziwy model, płatne wywołania).
// Wymagają uruchomionej aplikacji (npm run build && npm start) i .env.local.
// Hasło jest czytane z .env.local i nigdzie nie jest wypisywane.
import { readFileSync } from "node:fs";

export async function login(base) {
  const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const password = env.match(/^CHAT_PASSWORD=(.*)$/m)?.[1]?.trim();
  if (!password) throw new Error("Brak CHAT_PASSWORD w .env.local");
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || cookie === "chat_session=") throw new Error("Logowanie nieudane");
  return cookie;
}

// Nowa, osobna rozmowa w zwykłym czacie: jedna wiadomość, bez historii.
export async function askChat(base, cookie, text) {
  const res = await fetch(`${base}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      mode: "chat",
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }],
    }),
  });
  const raw = await res.text();
  let answer = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const chunk = JSON.parse(line.slice(6));
    if (chunk.type === "text-delta") answer += chunk.delta;
    if (chunk.type === "error") answer += `[BŁĄD: ${chunk.errorText}]`;
  }
  return { http: res.status, answer: answer.trim() };
}

export async function analyze(base, cookie, message) {
  const res = await fetch(`${base}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mode: "analyze", message }),
  });
  return { http: res.status, body: await res.json() };
}
