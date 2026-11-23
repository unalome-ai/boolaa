import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  MENTION_CAP,
  applyEdit,
  cpIndex,
  draftToMessage,
  findTrigger,
  insertMention,
  matchCandidates,
  messageParts,
  parseMentions,
  spanRange,
  tokensToSpans,
  utf16Index,
  type Candidate,
  type DraftState,
  type MentionToken,
} from "../src/lib/mentions";
import { errorKey } from "../src/i18n/errors";
import { SUPABASE_URL, apiUser, deleteUsers, login, selectBubble, serviceRoleKey, throwaway } from "./helpers";

// Chat @mentions (docs/boolaa-spec.md "Mentions", migration 20261124200000_chat_mentions.sql): the offset
// helper vectors, token editing, filtering, rendering per case, and one end-to-end flow.

const RUN = Date.now().toString(36);
const ANA = throwaway("MenAna", RUN);
const BEN = throwaway("MenBen", RUN);

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email]);
});

// ---- offsets ---------------------------------------------------------------------------------------

const tok = (text: string, mention: string, userId = "u1"): MentionToken => {
  const start = text.indexOf(mention);
  return { start, end: start + mention.length, userId };
};

test("offset vectors: code points, not UTF-16 units or graphemes", () => {
  const pizza = "🍕 @Ana Pop, hi";
  const t1 = tok(pizza, "@Ana Pop");
  expect([t1.start, t1.end - t1.start]).toEqual([3, 8]); // UTF-16
  expect(tokensToSpans(pizza, [t1])).toEqual([{ start: 2, length: 8, user_id: "u1" }]);
  expect(spanRange(pizza, { start: 2, length: 8, user_id: "u1" })).toEqual({ start: 3, end: 11 });

  const zoe = "@Zoë hi"; // precomposed ë
  expect(tokensToSpans(zoe, [tok(zoe, "@Zoë")])).toEqual([{ start: 0, length: 4, user_id: "u1" }]);
  const zoeNfd = "@Zoë hi"; // e + combining diaeresis: never normalised
  expect(tokensToSpans(zoeNfd, [tok(zoeNfd, "@Zoë")])).toEqual([{ start: 0, length: 5, user_id: "u1" }]);

  const family = "👨‍👩‍👧 @Bo"; // 5 code points, 8 UTF-16 units
  expect(tokensToSpans(family, [tok(family, "@Bo")])).toEqual([{ start: 6, length: 3, user_id: "u1" }]);
  expect(spanRange(family, { start: 6, length: 3, user_id: "u1" })).toEqual({ start: 9, end: 12 });

  expect(cpIndex(pizza, 3)).toBe(2);
  expect(utf16Index(pizza, 2)).toBe(3);
  expect(utf16Index("ab", 3)).toBeNull();
  // A span that doesn't fit (or doesn't start with @) is ignored, never a crash.
  expect(spanRange("@Bo", { start: 1, length: 9, user_id: "u1" })).toBeNull();
  expect(spanRange("hi Bo", { start: 3, length: 2, user_id: "u1" })).toBeNull();
  // Keys read by name, in any order; uuids lower-cased; sorted by start.
  expect(parseMentions([{ user_id: "ABC", length: 3, start: 5 }, { length: 2, start: 0, user_id: "x" }, { start: "1" }, null])).toEqual([
    { start: 0, length: 2, user_id: "x" },
    { start: 5, length: 3, user_id: "abc" },
  ]);
  expect(parseMentions(null)).toEqual([]);
});

// ---- composer: trigger, filtering, insertion, token editing, trimming --------------------------------

test("trigger: start, whitespace or opening bracket/quote; never mid-word, over lines or after two spaces", () => {
  const at = (s: string) => findTrigger(s, s.length, []);
  expect(at("@")).toEqual({ at: 0, query: "" });
  expect(at("hi @an")).toEqual({ at: 3, query: "an" });
  expect(at("(@an")).toEqual({ at: 1, query: "an" });
  expect(at("«@an")).toEqual({ at: 1, query: "an" });
  expect(at("“@an")).toEqual({ at: 1, query: "an" });
  expect(at("hi @ana p")).toEqual({ at: 3, query: "ana p" });
  expect(at("ana@x.ro")).toBeNull();
  expect(at("1@x")).toBeNull();
  expect(at("@ana\np")).toBeNull();
  expect(at("@ana  p")).toBeNull();
  expect(at("@" + "a".repeat(30))).not.toBeNull();
  expect(at("@" + "a".repeat(31))).toBeNull();
  // The caret placed right after an @ also opens it; inside a token never.
  expect(findTrigger("x @an y", 4, [])).toEqual({ at: 2, query: "a" });
  expect(findTrigger("@Ana Pop hi", 3, [{ start: 0, end: 8, userId: "u" }])).toBeNull();
});

const C = (name: string, id = name): Candidate => ({ user_id: id, name, avatar: null });

test("filtering folds case and diacritics, word starts after name starts, each in collation order", () => {
  const list = [C("Ștefan Ionescu"), C("Ana Pop"), C("Popescu Dan"), C("Zoë"), C("Ion Popa"), C("Bogdan")];
  expect(matchCandidates(list, "stefan", "ro").map((c) => c.name)).toEqual(["Ștefan Ionescu"]);
  expect(matchCandidates(list, "pop", "en").map((c) => c.name)).toEqual(["Popescu Dan", "Ana Pop", "Ion Popa"]);
  expect(matchCandidates(list, "ZOE", "en").map((c) => c.name)).toEqual(["Zoë"]);
  expect(matchCandidates(list, "ana p", "en").map((c) => c.name)).toEqual(["Ana Pop"]);
  expect(matchCandidates(list, "ion", "en").map((c) => c.name)).toEqual(["Ion Popa", "Ștefan Ionescu"]);
  expect(matchCandidates(list, "", "en")).toHaveLength(list.length); // a bare @ lists everyone
  expect(matchCandidates(list, "xyz", "en")).toEqual([]);
});

test("insertion: @Name plus one space (none before whitespace), caret after it, later tokens shift", () => {
  const ana = C("Ana Pop", "a");
  const s1 = insertMention({ text: "hi @an", tokens: [] }, { at: 3, query: "an" }, 6, ana);
  expect(s1).toEqual({ text: "hi @Ana Pop ", tokens: [{ start: 3, end: 11, userId: "a" }], caret: 12 });
  const s2 = insertMention({ text: "@a there", tokens: [] }, { at: 0, query: "a" }, 2, ana);
  expect(s2.text).toBe("@Ana Pop there");
  expect(s2.caret).toBe(8);
  const s3 = insertMention({ text: "@b @Zo", tokens: [{ start: 3, end: 6, userId: "z" }] }, { at: 0, query: "b" }, 2, C("Bo", "b"));
  expect(s3.tokens).toEqual([
    { start: 0, end: 3, userId: "b" },
    { start: 4, end: 7, userId: "z" },
  ]);
});

test("a token is one unit: backspace / delete / partial selection remove it; typing or pasting inside makes it text", () => {
  const base: DraftState = { text: "hi @Ana Pop and @Bo", tokens: [{ start: 3, end: 11, userId: "a" }, { start: 16, end: 19, userId: "b" }] };
  // Backspace right after the first token: the textarea removed one char ("p"); the whole token goes.
  const bs = applyEdit(base, "hi @Ana Po and @Bo", 10);
  expect(bs.text).toBe("hi  and @Bo");
  expect(bs.tokens).toEqual([{ start: 8, end: 11, userId: "b" }]);
  expect(bs.caret).toBe(3);
  // Delete right before the second token (caret at 16 removes "@").
  const del = applyEdit(base, "hi @Ana Pop and Bo", 16);
  expect(del.text).toBe("hi @Ana Pop and ");
  expect(del.tokens).toEqual([{ start: 3, end: 11, userId: "a" }]);
  // Typing over a selection that covers part of a token ("Pop and" → "x").
  const over = applyEdit(base, "hi @Ana x @Bo", 9);
  expect(over.text).toBe("hi x @Bo");
  expect(over.tokens).toEqual([{ start: 5, end: 8, userId: "b" }]);
  // Typing inside a token (caret strictly inside): characters stay, the range goes.
  const inside = applyEdit(base, "hi @Anna Pop and @Bo", 7);
  expect(inside.text).toBe("hi @Anna Pop and @Bo");
  expect(inside.tokens).toEqual([{ start: 17, end: 20, userId: "b" }]);
  // Pasting inside a token, same; a pasted "@Ana" is just text (never a token).
  const paste = applyEdit(base, "hi @A@Anana Pop and @Bo", 9);
  expect(paste.text).toBe("hi @A@Anana Pop and @Bo");
  expect(paste.tokens).toEqual([{ start: 20, end: 23, userId: "b" }]);
  const pasteEnd = applyEdit(base, base.text + " @Ana", base.text.length + 5);
  expect(pasteEnd.tokens).toEqual(base.tokens);
  // Text typed before a token shifts it; typing right after a token keeps it.
  expect(applyEdit(base, "oh hi @Ana Pop and @Bo", 3).tokens).toEqual([
    { start: 6, end: 14, userId: "a" },
    { start: 19, end: 22, userId: "b" },
  ]);
  expect(applyEdit(base, "hi @Ana Pop! and @Bo", 12).tokens[0]).toEqual({ start: 3, end: 11, userId: "a" });
  // Typing the same character as the one after the caret ("hi @Ana Pop  and"): the diff ends at the caret.
  expect(applyEdit(base, "hi @Ana Pop  and @Bo", 12).tokens[0]).toEqual({ start: 3, end: 11, userId: "a" });
});

test("sending trims and shifts the spans to the exact text sent", () => {
  const d: DraftState = { text: "  \n🍕 @Ana Pop hi  ", tokens: [{ start: 6, end: 14, userId: "a" }] };
  expect(draftToMessage(d)).toEqual({ content: "🍕 @Ana Pop hi", mentions: [{ start: 2, length: 8, user_id: "a" }] });
  expect(draftToMessage({ text: "   ", tokens: [] })).toEqual({ content: "", mentions: [] });
  expect(MENTION_CAP).toBe(10);
  expect(errorKey({ message: "too many mentions", code: "22023" })).toBe("tooManyMentions");
  expect(errorKey({ message: "invalid mentions", code: "22023" })).toBe("generic");
});

// ---- rendering -------------------------------------------------------------------------------------

test("rendering: you → pill with your current name, member → current name, anyone else → text as written", () => {
  const text = "@Ana Pop @Ben @Gone @Blocked see http://a.ro/@Ben";
  const span = (m: string, user_id: string, from = 0) => {
    const i = text.indexOf(m, from);
    return { start: cpIndex(text, i), length: Array.from(m).length, user_id };
  };
  const spans = [span("@Ana Pop", "me"), span("@Ben", "ben"), span("@Gone", "left"), span("@Blocked", "blocked"), span("@Ben", "ben", 30)];
  const cands = new Map([["ben", C("Benjamin", "ben")]]); // renamed; "blocked" isn't a candidate (block either way)
  const parts = messageParts(text, spans, { id: "me", name: "Ana Popescu" }, cands);
  expect(parts).toEqual([
    { kind: "me", text: "@Ana Popescu", userId: "me" },
    { kind: "text", text: " " },
    { kind: "member", text: "@Benjamin", userId: "ben" },
    { kind: "text", text: " " },
    { kind: "plain-mention", text: "@Gone", userId: "left" },
    { kind: "text", text: " " },
    { kind: "plain-mention", text: "@Blocked", userId: "blocked" },
    // A URL never swallows a span: the text before it is linkified on its own.
    { kind: "text", text: " see http://a.ro/" },
    { kind: "member", text: "@Benjamin", userId: "ben" },
  ]);
  // Spans that don't fit or overlap are skipped.
  expect(messageParts("hi", [{ start: 0, length: 9, user_id: "x" }], { id: "me", name: null }, cands)).toEqual([{ kind: "text", text: "hi" }]);
});

// ---- end to end ------------------------------------------------------------------------------------

async function openChat(page: Page, bubble: string) {
  await selectBubble(page, bubble);
  await page.goto("/chat");
  await expect(page.getByTestId("chat-status")).toHaveAttribute("data-live", "true");
}

test("pick a member with the keyboard, send, and the other side sees a mention of them", async ({ browser }) => {
  test.setTimeout(120_000);
  const key = serviceRoleKey();
  test.skip(!key, "needs the local service-role key");
  const admin = createClient(SUPABASE_URL, key!, { auth: { persistSession: false } });
  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const { data: bubble } = await ana.sb.rpc("create_bubble", { p_name: `Mentions ${RUN}` });
  const { data: req } = await ben.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
  expect((await ana.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);

  const a = await browser.newContext();
  const pa = await a.newPage();
  await login(pa, ANA.email);
  await openChat(pa, bubble!.name);
  const b = await browser.newContext();
  const pb = await b.newPage();
  await login(pb, BEN.email);
  await openChat(pb, bubble!.name);

  // Ana: an e-mail-like @ never opens the list.
  const input = pa.getByTestId("chat-input");
  await expect(input).toHaveAttribute("role", "combobox");
  await input.click();
  await input.pressSequentially("mail ana@x");
  await expect(pa.getByTestId("mention-list")).toHaveCount(0);
  await input.fill("");

  // "@menb" matches a word of Ben's name; the list is a labelled listbox; Escape closes and keeps the text.
  await input.pressSequentially("hi @menb");
  const list = pa.getByRole("listbox", { name: "Members to mention" });
  await expect(list).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const option = list.getByRole("option", { name: `Mention ${BEN.name}` });
  await expect(option).toHaveAttribute("aria-selected", "true");
  expect(await input.getAttribute("aria-activedescendant")).toBe(await option.getAttribute("id"));
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(pa.getByTestId("mention-announcer")).toHaveText("1 member");
  await input.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(input).toHaveValue("hi @menb");
  // Nothing matches → the "No members match" row; Enter neither picks nor sends.
  await input.fill("");
  await input.fill("hi @");
  await input.pressSequentially("zz");
  await expect(pa.getByTestId("mention-none")).toHaveText("No members match");
  await input.press("Enter");
  await expect(input).toHaveValue("hi @zz");

  // Pick with Enter: the token, then the rest of the message; Enter (list closed) sends.
  await input.fill("hi ");
  await input.pressSequentially("@menb");
  await expect(option).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue(`hi @${BEN.name} `);
  await expect(pa.getByTestId("mention-token")).toHaveAttribute("data-user-id", ben.id);
  // Backspace right after the token (after removing the space) removes it whole.
  await input.press("Backspace");
  await input.press("Backspace");
  await expect(input).toHaveValue("hi ");
  await expect(pa.getByTestId("mention-token")).toHaveCount(0);
  await input.pressSequentially("@menb");
  await input.press("Tab");
  await input.pressSequentially("can you buy milk?");
  await input.press("Enter");
  const sent = `hi @${BEN.name} can you buy milk?`;
  await expect(input).toHaveValue("");

  // The server row carries the span (code points); the sender sees the member style.
  await expect
    .poll(async () => (await admin.from("chat_messages").select("mentions").eq("bubble_id", bubble!.id).eq("content", sent).maybeSingle()).data?.mentions)
    .toEqual([{ start: 3, length: BEN.name.length + 1, user_id: ben.id }]);
  const mine = pa.getByTestId("chat-message").filter({ hasText: sent });
  await expect(mine.getByTestId("mention")).toHaveAttribute("data-kind", "member");
  await expect(mine.getByTestId("mention-bar")).toHaveCount(0);

  // Ben: a filled pill, the leading bar, and a spoken label that starts with "Ana mentioned you".
  const theirs = pb.getByTestId("chat-message").filter({ hasText: "can you buy milk?" });
  await expect(theirs.getByTestId("mention")).toHaveAttribute("data-kind", "me");
  await expect(theirs.getByTestId("mention")).toHaveText(`@${BEN.name}`);
  await expect(theirs.getByTestId("mention-bar")).toBeVisible();
  await expect(theirs).toHaveAttribute("aria-label", new RegExp(`^${ANA.name} mentioned you, ${ANA.name}, `));

  // Ben replies with a mention of Ana (arrives live): a pill for Ana, the member style for Ben.
  expect((await ben.sb.from("chat_messages").insert({ bubble_id: bubble!.id, sender_id: ben.id, content: `@${ANA.name} ok`, mentions: [{ start: 0, length: ANA.name.length + 1, user_id: ana.id }] })).error).toBeNull();
  const reply = pa.getByTestId("chat-message").filter({ hasText: " ok" }).last();
  await expect(reply.getByTestId("mention")).toHaveAttribute("data-kind", "me");
  await expect(pb.getByTestId("chat-message").filter({ hasText: " ok" }).last().getByTestId("mention")).toHaveAttribute("data-kind", "member");

  // "Ask in chat" draft: starts with a real token for the owner when they are a candidate.
  await pa.evaluate(
    ({ bubbleId, name, id }) => {
      sessionStorage.setItem("boolaa_chat_draft", JSON.stringify({ bubbleId, text: `@${name}, is “Lamp” still available?`, mention: { userId: id, name } }));
      window.dispatchEvent(new Event("boolaa:chat-draft"));
    },
    { bubbleId: bubble!.id, name: BEN.name, id: ben.id },
  );
  await expect(input).toHaveValue(`@${BEN.name}, is “Lamp” still available?`);
  await expect(pa.getByTestId("mention-token")).toHaveAttribute("data-user-id", ben.id);
  await input.press("Enter");
  await expect
    .poll(async () => (await admin.from("chat_messages").select("mentions").eq("bubble_id", bubble!.id).like("content", "%Lamp%").maybeSingle()).data?.mentions)
    .toEqual([{ start: 0, length: BEN.name.length + 1, user_id: ben.id }]);

  // Offline: the outbox keeps the mention with the text ("Sending…" shows it) and sends it unchanged.
  await a.setOffline(true);
  await expect(pa.getByTestId("offline-banner")).toBeVisible();
  await input.pressSequentially("later @menb");
  await input.press("Enter");
  await input.pressSequentially("ok");
  await input.press("Enter");
  const queued = pa.getByTestId("chat-pending").filter({ hasText: "later" });
  await expect(queued).toHaveAttribute("data-state", "sending");
  await expect(queued.getByTestId("mention")).toHaveAttribute("data-kind", "member");
  await a.setOffline(false);
  await expect
    .poll(async () => (await admin.from("chat_messages").select("mentions").eq("bubble_id", bubble!.id).eq("content", `later @${BEN.name} ok`).maybeSingle()).data?.mentions)
    .toEqual([{ start: 6, length: BEN.name.length + 1, user_id: ben.id }]);
  await expect(pa.getByTestId("chat-pending")).toHaveCount(0);

  // More than 10 spans: refused with "too many mentions" (mapped to tooManyMentions above).
  const many = Array.from({ length: 11 }, () => ({ start: 0, length: BEN.name.length + 1, user_id: ben.id }));
  const { error } = await ana.sb.from("chat_messages").insert({ bubble_id: bubble!.id, sender_id: ana.id, content: `@${BEN.name}`, mentions: many });
  expect(error?.message).toContain("too many mentions");

  await a.close();
  await b.close();
});
