/**
 * Forging AI-app client — streams a chat completion from the platform
 * proxy using same-origin authenticated cookies.
 *
 * The proxy lives at `/api/user-apps/<APP_ID>/ai/chat` and requires
 * the end user to be logged in on forging.dev. Credits are deducted
 * from that end user's account — there is no API key in this
 * bundle to leak.
 *
 * Set `VITE_FORGING_APP_ID` at build time (the builder's
 * `deploy_ai_app` tool writes it into .env.production before running
 * `npm run build`). Override the proxy host via
 * `VITE_FORGING_PROXY_BASE` only for local development.
 */

export interface ChatMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

export interface ChatOptions {
  readonly messages: ChatMessage[]
  readonly signal?: AbortSignal
  readonly model?: string
  readonly maxTokens?: number
}

export interface ChatDelta {
  readonly delta: string
  readonly finishReason?: string
}

const APP_ID = import.meta.env.VITE_FORGING_APP_ID as string | undefined
const PROXY_BASE =
  (import.meta.env.VITE_FORGING_PROXY_BASE as string | undefined) ?? ''

if (!APP_ID) {
  console.warn(
    '[forging] VITE_FORGING_APP_ID not set — chat calls will 404.',
  )
}

/**
 * Stream a chat completion. Yields `{delta}` objects for each token
 * chunk from the server. On network or proxy error, throws.
 */
export async function* streamChat(options: ChatOptions): AsyncGenerator<ChatDelta> {
  if (!APP_ID) {
    throw new Error(
      'VITE_FORGING_APP_ID is not set. Forging Builder normally writes ' +
        'this into .env when it calls register_ai_app — confirm the ' +
        'file exists and that the Vite dev server was restarted after ' +
        'the tool ran.',
    )
  }

  // Forging's auth is JWT-in-localStorage with a Bearer header —
  // NOT cookie-based. The generated app runs in a same-origin iframe
  // under forging.dev, so it can read the parent's localStorage
  // and forward the token. Without this the proxy returns 401 on
  // every call even when the end user is logged in.
  const token = readForgingToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const url = `${PROXY_BASE}/api/user-apps/${encodeURIComponent(APP_ID)}/ai/chat`
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      messages: options.messages,
      stream: true,
      model: options.model,
      max_tokens: options.maxTokens ?? 1024,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ChatError(response.status, text || response.statusText)
  }
  if (!response.body) {
    throw new ChatError(0, 'no response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let lineEnd: number
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd).trim()
        buffer = buffer.slice(lineEnd + 1)
        if (!line) continue
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue

        try {
          const parsed = JSON.parse(payload) as OpenRouterChunk
          const choice = parsed.choices?.[0]
          const delta = choice?.delta?.content ?? ''
          const finishReason = choice?.finish_reason ?? undefined
          if (delta || finishReason) {
            yield { delta, finishReason }
          }
        } catch {
          // Malformed data line — ignore and keep reading.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function readForgingToken(): string | null {
  try {
    return window.localStorage.getItem('forging_token')
  } catch {
    // Blocked by sandbox, private-mode, etc. The proxy will 401
    // and the user will see the friendly sign-in message.
    return null
  }
}

export class ChatError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ChatError'
  }
}

interface OpenRouterChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: { readonly content?: string }
    readonly finish_reason?: string | null
  }>
}

/** Human-readable message from a ChatError for UI display. */
export function friendlyChatError(err: unknown): string {
  if (err instanceof ChatError) {
    if (err.status === 401) return 'Please sign in to use this app.'
    if (err.status === 402) return "You're out of credits."
    if (err.status === 403) return "This app isn't published yet."
    if (err.status === 404) return "This app wasn't found."
    if (err.status === 503) return 'The AI service is unavailable right now.'
    return `Error ${err.status}. ${err.message}`
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
