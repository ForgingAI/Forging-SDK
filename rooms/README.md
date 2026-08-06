# @forging/rooms

Schema-first SDK for building realtime multiplayer rooms on the Forging
platform. One Zod-typed `defineRoom` declaration drives every hook your app
uses; every misuse is a TypeScript error.

> Status: **alpha / Phase 1**. The factory + type system are in place; runtime
> hook implementations (connection, state sync, mutate, presence, reconnect,
> leaderboards, components) are landing incrementally. See the
> [Status](#status) section below for the current breakdown.

## Install

```bash
pnpm add @forging/rooms zod immer react
```

Peer dependencies: `react ^19`, `react-dom ^19`. `zod` and `immer` are
declared as regular dependencies but you'll typically also import `zod` in
your app code.

## Quickstart

```tsx
// app/room.ts — the one source of truth for your room.
import { z } from "zod";
import {
  counter,
  createRoomApp,
  defineLeaderboard,
  defineRoom,
} from "@forging/rooms";

export const TriviaRoom = defineRoom({
  state: {
    phase: z.enum(["lobby", "active", "ended"]),
    currentQuestion: z.string().nullable(),
  },
  participantState: {
    answer: z.string().nullable(),
    score: counter({ min: 0, init: 0 }),
  },
  leaderboards: {
    leaderboard: defineLeaderboard({ scoring: "sum" }),
  },
  lifecycle: ["lobby", "active", "ended"] as const,
});

export const app = createRoomApp({
  app_id: "trivia",
  room: TriviaRoom,
  persistence: "checkpointed",
});

// app/components/Stage.tsx — typed hooks bound to your schema.
import { app } from "../room";

export function Stage() {
  const [phase, setPhase] = app.hooks.useRoomState("phase");
  const [score, mutateScore] = app.hooks.useParticipantState("score");
  const leaderboard = app.hooks.useLeaderboard("leaderboard");

  return (
    <button
      onClick={() => mutateScore((draft) => draft + 1)}
    >
      Phase: {phase} — Score: {score} — Top: {leaderboard.entries[0]?.score}
    </button>
  );
}
```

The key design choice: `mutateScore`'s recipe receives a **draft of the
current server state**, not a closure of render-time state. Two clicks in a
row produce two separate +1 increments correctly, even under reconnect.

## What's inside

| Entry | Purpose |
|-------|---------|
| `@forging/rooms` | Schema (`defineRoom`, `crdt`, `counter`, `defineLeaderboard`), factory (`createRoomApp`), wire-format schemas |
| `@forging/rooms/components` | `JoinFlow`, `PresenceStrip`, `Leaderboard`, `HostControlPanel`, `RoomLifecycleGate`, … |

Note: hooks like `useRoomState` are reached **only** through
`app.hooks.useRoomState(...)` — they are intentionally not exported from the
top-level package. This is what makes schema-less calls fail to compile.

## Companion worker

This SDK pairs with `@forging/rooms-worker` (Cloudflare Worker + Durable
Object `RoomServer`). The Worker enforces the same wire-format Zod schemas
on the server. For Phase 1 the wire-format is duplicated across both
packages; future work will extract it into a shared protocol package.

## Status

Phase 1 ships:

- **1.2.1** — Package scaffold, deps, configs. *Done.*
- **1.2.2** — `defineRoom` + `createRoomApp` factory with inferred typed hooks. *Done.*
- **1.2.3** — PartySocket runtime wrapper, connection state machine, store. *Pending.*
- **1.2.4** — `useRoomState` / `useParticipantState` mutation hooks. *Pending.*
- **1.2.5** — Reconnect protocol, drop-dupes, status field. *Pending.*
- **1.2.6** — Presence, host controls. *Pending.*
- **1.2.7** — Leaderboards, reactions. *Pending.*
- **1.2.8 / 1.2.9** — Component implementations. *Pending.*
- **1.2.10** — `RoomProvider`, examples, polish. *Pending.*

## Links

- [Changelog](./CHANGELOG.md)
- [Wordlist provenance](./data/WORDLIST_PROVENANCE.md)

The server-side room worker (Cloudflare Durable Objects) is a companion
package that is not yet public; this SDK targets its wire protocol.
