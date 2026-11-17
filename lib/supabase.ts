import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Jedyne miejsce, które łączy się z Supabase. Tylko serwer:
// "server-only" przerwie build, gdyby ktoś zaimportował ten plik
// w komponencie klienckim. Klucz tajny nie ma przedrostka NEXT_PUBLIC_,
// więc Next nie wstawi go do kodu dla przeglądarki.

let client: SupabaseClient | null = null;

/** Klient Supabase albo null, gdy brakuje SUPABASE_URL / SUPABASE_SECRET_KEY. */
export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;

  client ??= createClient(url, key, {
    // Serwer nie loguje użytkowników Supabase – nie przechowujemy sesji.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
