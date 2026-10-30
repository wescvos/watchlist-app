# Chat and Sending Movies: Design Spec

**Date:** 2026-10-30
**Status:** Draft (pending approval)
**Project location:** `C:\Users\Wesley Vos\dev\watchlist-app`
**Builds on:** `2026-10-29-multi-user-design.md` (Google sign-in, per-user `ListEntry`, shared `Title` catalog)

## 1. Purpose

Add a social layer to Watchlist for the small invite-only group of friends now using it (fewer than 10 people). A user can send a movie or show to one or more friends from any title page, and talk about it in an Instagram-style one-on-one chat that mixes movie cards and text messages.

Success looks like: Wesley opens Dune, taps **Send**, ticks Arno and Dewald, types "you'd love this", and each of them sees a red badge on the chat icon next time they open the app, opens the chat, taps the movie card, and adds it to their list. They reply, and while both have the chat open the conversation flows within a few seconds.

## 2. Goals

- A **Send** button on every title page (both `/title/[id]` and `/preview/[mediaType]/[tmdbId]`) opens a picker of everyone else on the app; the sender ticks one or more people and may add an optional text message.
- Each recipient receives the movie in their own one-on-one chat with the sender.
- One-on-one chats mixing **movie cards** and **text messages**, newest at the bottom, with a text input.
- A movie card shows poster, title, year, and, if the sender has rated it, "Wesley rated it 8/10". Tapping it opens the movie for the recipient, with an **Add to my list** path; if it is already on the recipient's list the card says so ("On your Want list" / "On your Watched list").
- **Heart reactions** on any message.
- **"Seen"** under the sender's latest message once the other person has opened the chat after it was sent.
- A **chat icon in the home header** (next to Mood) with a red badge showing the number of chats with unread messages.
- A **chats list** screen: conversations newest first, each with the other person's name and photo, a one-line preview of the latest message, time, and a blue dot when unread; plus a way to start a new chat with anyone on the app.
- **Near-live updates** without any outside service (section 7).

## 3. Non-goals

- Group chats (one-on-one only).
- Deleting or editing messages.
- Phone/push notifications or anything that updates while the app is closed.
- Friend requests, blocking, or per-user privacy settings. Everyone on the app can message everyone (the app is invite-only).
- Sharing anything from a user's list beyond the single rating shown on a card they choose to send. Lists stay private.
- Typing indicators, images/attachments, message search.

## 4. Anti-goals (failure even if it "works")

- A user can read, react to, or send into a conversation they are not part of, by guessing an id or otherwise.
- Sending or opening chat exposes any part of a user's list other than the one rating on a sent card.
- The home screen's launch speed or the existing anti-flicker work regresses (home `/` must stay a static page; no server session lookup in the root layout).
- Polling runs while the app is in the background or a chat is not visible, burning database compute.
- A message appears twice, out of order, or is lost when two people send at the same moment.

## 5. Decisions made by Wesley

| Topic | Decision |
|---|---|
| Scope | Version "B": send movies + one-on-one chat with near-live updates; no push notifications. |
| Friend requests | None. Everyone on the app can message everyone. |
| Chat type | One-on-one only. |
| Send to several | Yes: tick multiple friends in one send; each gets it in their own one-on-one chat. |
| Rating on card | Yes, show the sender's rating if they have rated the title. |
| Extras | Heart reactions and "Seen" indicator. No message deletion. |
| Entry point | A chat icon in the home header next to Mood, with an unread badge. |
| Hearts | Quiet: a heart never moves a chat up, changes its preview, or makes it unread. You see it when you next open that chat. |

## 6. Data model

All new; nothing existing changes except back-relations on `User` and `Title`.

- **`Conversation`**: `id`, `userAId`, `userBId`, `createdAt`, `lastMessageAt`. Exactly one conversation per pair of users: store the two ids in sorted order (`userAId < userBId`) with `@@unique([userAId, userBId])`, so "find or create the chat between X and Y" is a single upsert and can't produce duplicates.
- **`ConversationRead`** (or two columns on Conversation; builder's call): per user per conversation, `lastReadAt`. Drives the unread badge (a conversation is unread for me if its latest message from the other person is newer than my `lastReadAt`) and "Seen" (my latest message is seen if its time is not after the other person's `lastReadAt`).
- **`Message`**: `id`, `conversationId`, `senderId`, `createdAt`, `text` (nullable), `titleId` (nullable, FK to shared `Title`, `ON DELETE RESTRICT`), `senderRating` (nullable Int, a snapshot of the sender's rating at send time). At least one of `text` / `titleId` is set. Indexed by `(conversationId, createdAt)`.
- **`Reaction`**: `messageId`, `userId`, `createdAt`, `@@unique([messageId, userId])` (one heart per person per message; tapping again removes it).

**Rating snapshot (Claude's call):** the card shows the rating the sender had when they sent it, so a later re-rating does not silently rewrite past messages.

**Sending from a preview page:** the title may not yet be in the shared catalog. Sending upserts it into the catalog first (same fetch-and-upsert the add path uses, without creating a `ListEntry` for anyone).

**Message ordering:** by `createdAt`, then `id` as a tiebreaker. Polling uses "messages after the last one I have" so nothing is duplicated or skipped.

**Who counts as "on the app":** users with a `User` row (created on first sign-in) whose email is on `ALLOWED_EMAILS`. A friend who is on the allowlist but has not signed in yet cannot be picked until they do. Display names are the first word of Google's `name`, falling back to the email's local part (Claude's call).

**Send with a message (Claude's call):** the movie card and the optional text are two separate messages (card first, then the text bubble), matching the approved sketch.

**Removed friends:** an existing conversation with someone no longer on the allowlist stays readable but read-only (the input is hidden with a short note).

## 7. How "live" works (Claude's call)

Vercel runs short request handlers, so there is no persistent socket. Instead the client polls, only while it is visible:

- **Open chat:** fetch new messages about every **3 seconds**. Reaction and "Seen" changes must also show up, including a removed heart, so the poll cannot be only "messages after the last one I have" (builder designs how, e.g. returning reactions for the loaded window plus the other person's `lastReadAt`).
- **Chats list:** refresh about every **10 seconds** while open.
- **Home header badge:** fetch the unread count about every **30 seconds** while the app is open and visible, and immediately when the home screen mounts or the app returns to the foreground.
- All polling stops when the page is hidden (`document.visibilityState`) and resumes on return. This bounds Neon compute (the free tier scales to zero when idle).
- Opening a chat marks it read (updates `lastReadAt`) and keeps doing so while new messages arrive and the chat is visible.
- Sending shows the message immediately (optimistic) and reconciles with the server response.

The header badge must not make the home page dynamic or add a server round-trip before first paint: it is a client component that fetches after mount and renders nothing (and takes no layout space beyond the icon) until it has a count.

## 8. Screens

Rough sketches were approved in the visual companion (`.superpowers/brainstorm/`, `chat-flow.html`). Styling follows the existing app (dark/light Tailwind patterns, focus rings, the header's `shrink-0 whitespace-nowrap` controls; the header must still fit on one line at 375px with the new icon).

1. **Send sheet** (from a title page): list of everyone else on the app (name + photo), multi-select ticks, optional message box, "Send to N people" button. On success, a brief confirmation; the sheet closes. If the user is the only person on the app, show "Nobody else is on Watchlist yet."
2. **Chats list** (`/chats`): conversations newest first; row = photo, name, latest-message preview ("You sent Dune: Part Two", "Dewald sent The Wailing", or the text). Hearts never appear here (section 5), relative time, blue dot when unread. A "Start a new chat" entry listing everyone the user has no conversation with yet.
3. **Chat** (`/chats/[id]`): header with back arrow and the other person's name/photo; messages bottom-anchored; movie cards and text bubbles (mine right, theirs left); a small heart under a hearted message; "Seen" under my latest message when applicable; a text input with Send. Long-press or double-tap a message to heart/un-heart it (builder picks the gesture that works on iOS Safari standalone; a visible fallback such as a small heart button on tap is fine).
4. **Movie card tap:** if the viewer has the title on their list, open `/title/[id]`; otherwise open `/preview/[mediaType]/[tmdbId]`, where the existing Want/Watched buttons add it.

## 9. Authorization and privacy

Follows AGENTS.md "Auth" rules:

- Every chat route and page resolves the user via `getCurrentUserId`/`requireUserId`, and every query is scoped so a user only reaches conversations where they are `userA` or `userB`. A conversation or message id the user is not part of returns 404, never 403.
- The "everyone on the app" list exposes only `id`, first name and photo of users, never emails or anything from their lists.
- A user removed from `ALLOWED_EMAILS` cannot sign in, so cannot read or send. They do not appear in the send picker or "Start a new chat" (filter the people list through the allowlist). Existing conversations with them remain readable by the other person (Claude's call).
- Message text is rendered as plain text (React escaping); no HTML or link previews. A length cap of 2000 characters per message (Claude's call).
- The rating on a card is only ever the sender's own snapshot.

## 10. Constraints

- Next.js 16 (read `node_modules/next/dist/docs/` before writing code), Prisma 7, Neon Postgres, Auth.js v5, deployed on Vercel. No new outside services or paid tiers.
- Migrations are additive only and generated with `prisma migrate diff ... --script` (never `migrate dev`), per AGENTS.md.
- Home `/` stays static; root layout stays free of `auth()`/`cookies()`.
- Verify gates per AGENTS.md (`tsc`, `eslint`, `next build`, tests as separate steps) before pushing.

## 11. Testing

- Authorization: user C gets 404 for A and B's conversation on every chat endpoint and page; cannot send into it, react in it, or mark it read.
- Find-or-create: two concurrent sends between the same pair produce one conversation.
- Sending to several people creates one message per recipient conversation; each carries the rating snapshot and optional text.
- Sending from preview creates the catalog `Title` without creating any `ListEntry`.
- Unread count and "Seen" logic, including "my own messages never make a chat unread for me".
- Polling cursor: messages after a given one are returned in order with no duplicates when timestamps tie.
- Reactions toggle on and off; one per user per message.
- The people list excludes the current user and anyone not on the allowlist, and contains no emails.
- The home cold-launch tests still pass and the header fits at 375px.

## 12. Left to the builder

- Exact component structure, API route shapes, and polling hook implementation (subject to section 7's intervals and visibility rule).
- Whether read state lives in its own table or as two columns on `Conversation`.
- Relative-time formatting, empty states, and exact copy beyond what is quoted here (no em dashes).
- The heart gesture details (section 8.3).
