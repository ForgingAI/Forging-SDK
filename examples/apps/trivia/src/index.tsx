// Trivia — reference multiplayer app validating the @forging/rooms SDK and
// the polymorphic room shell.
//
// Contract with the shell (Forging/social `/r/:code`):
//   - default export is a React component
//   - props: { roomCode: string }
//   - shell has already minted the participant cookie before this mounts,
//     so the SDK's WS upgrade carries identity automatically
//
// The schema is intentionally minimal — this is a validation harness for the
// platform, not a polished trivia game. Phase 4's LLM builder will generate
// richer apps with the same shape.

import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import {
  createRoomApp,
  defineRoom,
  counter,
  RoomAppProvider,
} from '@forging/rooms'
import { QUESTIONS } from './questions'

// ─── Room schema ──────────────────────────────────────────────────────────

const TriviaRoom = defineRoom({
  state: {
    phase: z.enum(['lobby', 'question', 'reveal', 'ended']),
    current_question_idx: z.number().int().min(0),
  },
  participantState: {
    score: counter({ init: 0 }),
    answer_idx: z.number().int().nullable(),
  },
  leaderboards: {},
  lifecycle: ['lobby', 'active', 'paused', 'ended'] as const,
})

// ─── Top-level component ──────────────────────────────────────────────────

interface TriviaAppProps {
  readonly roomCode: string
}

function TriviaApp({ roomCode }: TriviaAppProps) {
  const app = useMemo(
    () =>
      createRoomApp({
        app_id: 'trivia',
        room: TriviaRoom,
        persistence: 'checkpointed',
        roomId: roomCode,
        getAuthToken: async () => {
          // Participant cookie is on .forging.dev; the WS upgrade carries it.
          // The SDK still wants a token string — we return an empty marker
          // and let the cookie carry the identity.
          return ''
        },
      }),
    [roomCode],
  )

  useEffect(() => {
    void app.connect()
    return () => app.disconnect()
  }, [app])

  return (
    <RoomAppProvider app={app}>
      <TriviaShell roomCode={roomCode} app={app} />
    </RoomAppProvider>
  )
}

// ─── Render phases ────────────────────────────────────────────────────────

interface TriviaShellProps {
  readonly roomCode: string
  readonly app: ReturnType<typeof createRoomApp<typeof TriviaRoom>>
}

function TriviaShell({ roomCode, app }: TriviaShellProps) {
  const [phase] = app.hooks.useRoomState('phase')
  const [questionIdx] = app.hooks.useRoomState('current_question_idx')
  const presence = app.hooks.useRoomPresence()
  const host = app.hooks.useHostControls({
    start: ['phase'],
    next: ['phase', 'current_question_idx'],
    end: ['phase'],
  })

  const question = QUESTIONS[questionIdx ?? 0]

  return (
    <div className="trivia-root">
      <header className="trivia-header">
        <h1>Trivia</h1>
        <RoomCodeBadge code={roomCode} />
      </header>

      <section className="trivia-body">
        {phase === 'lobby' && (
          <Lobby
            participants={presence}
            isHost={host.isHost}
            onStart={() =>
              host.invoke('start', async (draft) => {
                draft.phase = 'question'
              })
            }
          />
        )}

        {phase === 'question' && question && (
          <QuestionView
            question={question}
            app={app}
            onReveal={
              host.isHost
                ? () =>
                    host.invoke('next', async (draft) => {
                      draft.phase = 'reveal'
                    })
                : undefined
            }
          />
        )}

        {phase === 'reveal' && question && (
          <Reveal
            question={question}
            isHost={host.isHost}
            hasNext={(questionIdx ?? 0) < QUESTIONS.length - 1}
            onNext={() =>
              host.invoke('next', async (draft) => {
                draft.current_question_idx = (draft.current_question_idx ?? 0) + 1
                draft.phase = 'question'
              })
            }
            onEnd={() =>
              host.invoke('end', async (draft) => {
                draft.phase = 'ended'
              })
            }
          />
        )}

        {phase === 'ended' && <EndScreen />}
      </section>
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function RoomCodeBadge({ code }: { readonly code: string }) {
  return (
    <div className="trivia-code">
      <span className="trivia-code-label">Room</span>
      <span className="trivia-code-value">{code}</span>
    </div>
  )
}

function Lobby({
  participants,
  isHost,
  onStart,
}: {
  readonly participants: readonly { id: string; displayName: string | null }[]
  readonly isHost: boolean
  readonly onStart: () => void
}) {
  return (
    <div className="trivia-lobby">
      <h2>Waiting for players…</h2>
      <ul className="trivia-presence">
        {participants.map((p) => (
          <li key={p.id}>{p.displayName ?? 'Anonymous'}</li>
        ))}
      </ul>
      {isHost && (
        <button onClick={onStart} className="trivia-primary">
          Start game
        </button>
      )}
    </div>
  )
}

function QuestionView({
  question,
  app,
  onReveal,
}: {
  readonly question: (typeof QUESTIONS)[number]
  readonly app: ReturnType<typeof createRoomApp<typeof TriviaRoom>>
  readonly onReveal?: () => void
}) {
  const [answerIdx, setAnswerIdx] = app.hooks.useParticipantState('answer_idx')
  const [chosen, setChosen] = useState<number | null>(answerIdx ?? null)

  const submit = async (idx: number) => {
    setChosen(idx)
    await setAnswerIdx(() => idx)
  }

  return (
    <div className="trivia-question">
      <h2>{question.prompt}</h2>
      <div className="trivia-options">
        {question.options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => submit(idx)}
            disabled={chosen !== null}
            className={chosen === idx ? 'trivia-option chosen' : 'trivia-option'}
          >
            {opt}
          </button>
        ))}
      </div>
      {onReveal && (
        <button onClick={onReveal} className="trivia-secondary">
          Reveal answer
        </button>
      )}
    </div>
  )
}

function Reveal({
  question,
  isHost,
  hasNext,
  onNext,
  onEnd,
}: {
  readonly question: (typeof QUESTIONS)[number]
  readonly isHost: boolean
  readonly hasNext: boolean
  readonly onNext: () => void
  readonly onEnd: () => void
}) {
  return (
    <div className="trivia-reveal">
      <h2>Answer: {question.options[question.correctIdx]}</h2>
      {isHost &&
        (hasNext ? (
          <button onClick={onNext} className="trivia-primary">
            Next question
          </button>
        ) : (
          <button onClick={onEnd} className="trivia-primary">
            End game
          </button>
        ))}
    </div>
  )
}

function EndScreen() {
  return (
    <div className="trivia-end">
      <h2>Game over</h2>
      <p>Thanks for playing.</p>
    </div>
  )
}

export default TriviaApp
