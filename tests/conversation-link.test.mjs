import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationHref,
  NEW_CONVERSATION_HREF,
  parseConversationId,
} from "../lib/conversation-link.ts";

test("adres rozmowy i odczyt numeru z ?c=", () => {
  assert.equal(conversationHref(12), "/?c=12");
  assert.equal(parseConversationId("12"), 12);
  assert.equal(NEW_CONVERSATION_HREF, "/?new=1");
});

test("nieprawidłowy numer rozmowy = null (bez zapytania do bazy)", () => {
  for (const bad of [undefined, "", "0", "-1", "1.5", "abc", "12abc", " 12", ["1", "2"], "9".repeat(17)]) {
    assert.equal(parseConversationId(bad), null, String(bad));
  }
});
