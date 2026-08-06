import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  streamChat,
  friendlyChatError,
  type ChatMessage,
} from '@/lib/forging'
import { Message } from './Message'

interface ChatProps {
  readonly greeting?: string
  readonly placeholder?: string
}

export function Chat({ greeting, placeholder }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const send = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return
    setInput('')
    setError(null)

    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    // Insert both the user message and an empty assistant slot so
    // the streaming tokens land in-place.
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const history = [...messages, userMsg]
      let assistantBuffer = ''
      for await (const chunk of streamChat({
        messages: history,
        signal: controller.signal,
      })) {
        if (!chunk.delta) continue
        assistantBuffer += chunk.delta
        setMessages((prev) => {
          const next = [...prev]
          const lastIndex = next.length - 1
          if (lastIndex >= 0 && next[lastIndex].role === 'assistant') {
            next[lastIndex] = { role: 'assistant', content: assistantBuffer }
          }
          return next
        })
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setError(friendlyChatError(err))
      // Remove the empty assistant slot on failure.
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && !last.content) {
          return prev.slice(0, -1)
        }
        return prev
      })
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, messages, streaming])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
    },
    [send],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-auto">
        {messages.length === 0 && greeting && (
          <div className="px-4 py-8 text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {greeting}
          </div>
        )}
        <div className="max-w-3xl mx-auto">
          {messages.map((m, i) => (
            <Message
              key={i}
              message={m}
              pending={streaming && i === messages.length - 1 && m.role === 'assistant'}
            />
          ))}
        </div>
        <div ref={endRef} />
      </div>

      {error && (
        <div className="border-t border-destructive/40 bg-destructive/5 text-destructive text-xs px-4 py-2 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-destructive/70 hover:text-destructive"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="shrink-0 border-t border-border bg-surface">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Ask something…'}
            rows={1}
            disabled={streaming}
            className={cn(
              'flex-1 resize-none bg-elevated border border-border rounded-xl px-3 py-2 text-sm',
              'placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-accent',
              'max-h-40',
            )}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 h-10 px-3 rounded-xl bg-destructive/10 border border-destructive/40 text-destructive text-sm hover:bg-destructive/15"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              aria-label="Send"
              className={cn(
                'shrink-0 h-10 w-10 rounded-xl flex items-center justify-center',
                input.trim()
                  ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                  : 'bg-elevated text-muted-foreground cursor-not-allowed',
              )}
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
