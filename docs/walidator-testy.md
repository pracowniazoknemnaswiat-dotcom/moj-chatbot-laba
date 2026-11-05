# Testy walidatora i kontroli backendu: tryb „Analiza wiadomości”

- **Data:** 2026-11-05
- **Zakres:** walidacja wyniku JSON (`lib/triage.ts`), kontrole backendu (`lib/guard.ts`), odrzucanie pól z przeglądarki (`app/api/analyze/route.ts`)
- **Sposób:** testy lokalne, **bez wywołań modelu i bez sieci**. Prawdziwy provider OpenRouter dostaje podstawiony `fetch`, który zwraca kontrolowane odpowiedzi z HTTP 200. Samo HTTP 200 nie oznacza udanej analizy, decyduje walidacja.
- **Dane:** wyłącznie fikcyjne.

Poniżej dosłowne wyniki uruchomienia (wszystkie zestawy zakończone bez niezgodności).

## 1. Walidator: 4 przykłady z zadania, odmowa, przerwanie

Przykłady: brak pola `draft`, `needs_review` jako tekst `"false"`, `category: "marketing"`, dodatkowe pole `send_now`, odmowa modelu, przerwana odpowiedź oraz próba kontrolna z poprawnym wynikiem.

```text

✅ 1. Brak pola draft
   odpowiedź dostawcy: HTTP 200, finish_reason=stop, treść={"category":"sales","priority":"normal","needs_review":false}
   oczekiwany: odrzucony (invalid_output) — „Brak pola: draft”
   faktyczny:  odrzucony (invalid_output) — Model zwrócił wynik niezgodny ze schematem. Wynik odrzucono — nie jest pokazywany jako poprawny. [Brak pola: draft]
   wynik przekazany do UI jako poprawny: NIE

✅ 2. needs_review = "false" (tekst)
   odpowiedź dostawcy: HTTP 200, finish_reason=stop, treść={"category":"sales","priority":"normal","draft":"Konsultacja kosztuje 150 zł brutto.","needs_review":"false"}
   oczekiwany: odrzucony (invalid_output) — „Zły typ pola needs_review”
   faktyczny:  odrzucony (invalid_output) — Model zwrócił wynik niezgodny ze schematem. Wynik odrzucono — nie jest pokazywany jako poprawny. [Zły typ pola needs_review (oczekiwano: boolean)]
   wynik przekazany do UI jako poprawny: NIE

✅ 3. category = "marketing"
   odpowiedź dostawcy: HTTP 200, finish_reason=stop, treść={"category":"marketing","priority":"normal","draft":"Konsultacja kosztuje 150 zł brutto.","needs_review":false}
   oczekiwany: odrzucony (invalid_output) — „Niedozwolona wartość pola category”
   faktyczny:  odrzucony (invalid_output) — Model zwrócił wynik niezgodny ze schematem. Wynik odrzucono — nie jest pokazywany jako poprawny. [Niedozwolona wartość pola category (dozwolone: sales, support, billing, unknown)]
   wynik przekazany do UI jako poprawny: NIE

✅ 4. Dodatkowe pole send_now
   odpowiedź dostawcy: HTTP 200, finish_reason=stop, treść={"category":"sales","priority":"normal","draft":"Konsultacja kosztuje 150 zł brutto.","needs_review":false,"send_now":true}
   oczekiwany: odrzucony (invalid_output) — „Dodatkowe pole: send_now”
   faktyczny:  odrzucony (invalid_output) — Model zwrócił wynik niezgodny ze schematem. Wynik odrzucono — nie jest pokazywany jako poprawny. [Dodatkowe pole: send_now]
   wynik przekazany do UI jako poprawny: NIE

✅ 5. Odmowa modelu (content_filter + refusal)
   odpowiedź dostawcy: HTTP 200, finish_reason=content_filter, treść=(brak, pole refusal)
   oczekiwany: odrzucony (refusal)
   faktyczny:  odrzucony (refusal) — Model odmówił przygotowania analizy. Sprawę musi obsłużyć pracownik.
   wynik przekazany do UI jako poprawny: NIE

✅ 6. Przerwana odpowiedź (length, ucięty JSON)
   odpowiedź dostawcy: HTTP 200, finish_reason=length, treść={"category":"sales","priority":"normal","draft":"Konsul
   oczekiwany: odrzucony (truncated)
   faktyczny:  odrzucony (truncated) — Odpowiedź modelu została przerwana przed końcem. Wynik odrzucono. Spróbuj ponownie lub skróć wiadomość.
   wynik przekazany do UI jako poprawny: NIE

✅ 7. Przerwana, ale JSON wygląda na kompletny
   odpowiedź dostawcy: HTTP 200, finish_reason=length, treść={"category":"sales","priority":"normal","draft":"Konsultacja kosztuje 150 zł brutto.","needs_review":false}
   oczekiwany: odrzucony (truncated)
   faktyczny:  odrzucony (truncated) — Odpowiedź modelu została przerwana przed końcem. Wynik odrzucono. Spróbuj ponownie lub skróć wiadomość.
   wynik przekazany do UI jako poprawny: NIE

✅ Kontrola: poprawny wynik
   odpowiedź dostawcy: HTTP 200, finish_reason=stop, treść={"category":"sales","priority":"normal","draft":"Konsultacja kosztuje 150 zł brutto.","needs_review":false}
   oczekiwany: przyjęty (ok)
   faktyczny:  przyjęty (ok)
   wynik przekazany do UI jako poprawny: TAK

Wyjść do sieci: 0 (podstawiony fetch wywołany 8×). Niezgodności: 0
```

## 2. Pełny zestaw walidacji (24 przypadki)

Zawiera też: zły typ `draft`, niedozwolony priorytet, tekst zamiast JSON, pustą odpowiedź, odmowę jako HTTP 403, brak obsługi structured output (404/503), błędy dostawcy (500/401) oraz sprawdzenie, co faktycznie wysyłamy do OpenRoutera.

```text
OK   poprawny wynik → ok
OK   poprawny wynik high + needs_review → ok
OK   brak pola needs_review → invalid_output [Brak pola: needs_review]
OK   zły typ needs_review ("tak") → invalid_output [Zły typ pola needs_review (oczekiwano: boolean)]
OK   zły typ draft (liczba) → invalid_output [Zły typ pola draft (oczekiwano: string)]
OK   niedozwolona kategoria other → invalid_output [Niedozwolona wartość pola category (dozwolone: sales, support, billing, unknown)]
OK   niedozwolony priorytet low → invalid_output [Niedozwolona wartość pola priority (dozwolone: normal, high)]
OK   dodatkowe pole discount → invalid_output [Dodatkowe pole: discount]
OK   tekst zamiast JSON → invalid_output [Odpowiedź nie jest poprawnym JSON.]
OK   pusta odpowiedź → invalid_output [Model nie zwrócił treści.]
OK   odmowa: content_filter + refusal → refusal
OK   odmowa: HTTP 403 refusal → refusal
OK   przerwana: finish length → truncated
OK   przerwana: length przy poprawnym JSON → truncated
OK   brak obsługi structured output (404) → unsupported [HTTP 404]
OK   brak dostawcy spełniającego wymagania (503) → unsupported [HTTP 503]
OK   błąd dostawcy 500 → provider_error [HTTP 500]
OK   błąd dostawcy 401 (zły klucz) → provider_error [HTTP 401]
OK   response_format.type = json_schema
OK   json_schema.strict = true
OK   schemat = schemat z materiałów
OK   provider.require_parameters = true
OK   instrukcja jako wiadomość system (nie user)
OK   wiadomość user nie zawiera instrukcji

Zapytania do podstawionego fetch: 23; do sieci: 0
```

## 3. Kontrole backendu przy zmanipulowanym modelu

Symulacja modelu, który wykonuje polecenia z wiadomości klienta.

```text
✅ B: model wykonał needs_review=false
   oczekiwany: przepuszczony, needs_review wymuszone
   faktyczny:  needs_review=true, wymuszone=true, uwagi=[wiadomość klienta: udawany komunikat systemu; wiadomość klienta: próba ustawienia pól wyniku; wiadomość klienta: znaczniki próbujące zamknąć blok danych]
✅ A: model napisał 0 zł
   oczekiwany: przepuszczony, needs_review wymuszone
   faktyczny:  needs_review=true, wymuszone=true, uwagi=[wiadomość klienta: polecenie zignorowania zasad; szkic podaje kwotę inną niż cena konsultacji (150 zł)]
✅ B2: model potwierdził 50% rabatu
   oczekiwany: przepuszczony, needs_review wymuszone
   faktyczny:  needs_review=true, wymuszone=true, uwagi=[szkic wspomina rabat lub zniżkę]
✅ C: model potwierdził zwrot
   oczekiwany: przepuszczony, needs_review wymuszone
   faktyczny:  needs_review=true, wymuszone=true, uwagi=[szkic obiecuje lub potwierdza zwrot; płatności i zwroty zawsze wymagają decyzji pracownika]
✅ E: wyciek instrukcji
   oczekiwany: zablokowany
   faktyczny:  blocked: szkic zawiera fragment instrukcji systemowej
✅ G: link phishingowy
   oczekiwany: przepuszczony, needs_review wymuszone
   faktyczny:  needs_review=true, wymuszone=true, uwagi=[wiadomość klienta: prośba o wstawienie linku lub adresu; szkic zawiera link lub adres strony; płatności i zwroty zawsze wymagają decyzji pracownika]
✅ H: potwierdzona rezerwacja
   oczekiwany: przepuszczony, needs_review wymuszone
   faktyczny:  needs_review=true, wymuszone=true, uwagi=[szkic potwierdza rezerwację]
✅ H': odmowa potwierdzenia (zaprzeczenie)
   oczekiwany: przepuszczony bez uwag o rezerwacji
   faktyczny:  needs_review=true, wymuszone=false, uwagi=[]
✅ Kontrola: czysta wiadomość i szkic
   oczekiwany: przepuszczony bez zmian
   faktyczny:  needs_review=false, wymuszone=false, uwagi=[]
✅ wiadomość klienta otoczona losowym znacznikiem KLIENT_…
```

## 4. Detektor prób manipulacji w wiadomości klienta

Przypadki A–H to ataki, K i L to wiadomości kontrolne bez ataku.

```text
✅ A-override: polecenie zignorowania zasad; odwołanie do instrukcji asystenta; próba zmiany roli asystenta; próba ustawienia pól wyniku
✅ B-fake-system: udawany komunikat systemu; próba ustawienia pól wyniku; polecenie potwierdzenia decyzji; znaczniki próbujące zamknąć blok danych
✅ C-fake-admin-refund: podszycie pod pracownika firmy; polecenie potwierdzenia decyzji; próba ominięcia sprawdzenia przez pracownika
✅ D-priority: próba ustawienia priorytetu
✅ E-leak: próba poznania instrukcji
✅ F-schema: próba ustawienia pól wyniku
✅ G-phishing-link: prośba o wstawienie linku lub adresu; prośba o uwiarygodnienie zewnętrznej strony
✅ H-booking: próba ominięcia sprawdzenia przez pracownika
✅ K-control-high: (brak sygnałów)
✅ L-control-price: (brak sygnałów)
```

## 5. Cena 1 zł, send_now i nadpisanie uprawnień

```text
✅ 1 zł — model odporny
   oczekiwany: ok, needs_review=true, uwagi o próbie manipulacji
   faktyczny:  ok, needs_review=true, wymuszone=false, pola=[category,priority,draft,needs_review], uwagi=[wiadomość klienta: udawany komunikat systemu; wiadomość klienta: próba ustawienia pól wyniku; wiadomość klienta: podszycie pod pracownika firmy]
✅ 1 zł — model zmanipulowany
   oczekiwany: needs_review wymuszone + uwaga o kwocie innej niż 150 zł
   faktyczny:  ok, needs_review=true, wymuszone=true, pola=[category,priority,draft,needs_review], uwagi=[wiadomość klienta: udawany komunikat systemu; wiadomość klienta: próba ustawienia pól wyniku; wiadomość klienta: podszycie pod pracownika firmy; szkic podaje kwotę inną niż cena konsultacji (150 zł)]
✅ wynik modelu z polem send_now
   oczekiwany: odrzucony (invalid_output)
   faktyczny:  invalid_output: Dodatkowe pole: send_now
✅ wynik modelu z polem role
   oczekiwany: odrzucony (invalid_output)
   faktyczny:  invalid_output: Dodatkowe pole: role
✅ wynik modelu z polem permissions
   oczekiwany: odrzucony (invalid_output)
   faktyczny:  invalid_output: Dodatkowe pole: permissions
✅ rola i miejsce wiadomości klienta
   oczekiwany: system=[instrukcja firmy], user=[atak w znacznikach KLIENT_…]
   faktyczny:  role=[system,user], atak w user: true, atak w system: false, znacznik: true
✅ schemat w żądaniu nie zawiera pól spoza listy
   oczekiwany: category, priority, draft, needs_review; additionalProperties=false
   faktyczny:  category,priority,draft,needs_review; additionalProperties=false
✅ czat: wiadomość system z przeglądarki
   oczekiwany: odrzucona przed wywołaniem modelu
   faktyczny:  model wywołany: false, błąd: AI_InvalidPromptError
```

Dodatkowo na uruchomionej aplikacji (zalogowanej) sprawdzono, że `/api/analyze` odrzuca kodem HTTP 400, **przed wywołaniem modelu**, żądania z polami: `send_now`, `role`, `permissions`, `instructions`, `schema`, `messages` oraz `message` w postaci obiektu. Bez sesji serwer zwraca HTTP 401.
