import { Bot, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/forging'

interface MessageProps {
  readonly message: ChatMessage
  readonly pending?: boolean
}

export function Message({ message, pending }: MessageProps) {
  const isUser = message.role === 'user'
  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser && (
        <div className="h-8 w-8 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-accent" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
          isUser ? 'bg-accent text-accent-foreground' : 'bg-elevated text-foreground',
          pending && 'opacity-70',
        )}
      >
        {message.content}
        {pending && !message.content && (
          <span className="inline-block h-3 w-3 rounded-full bg-foreground/40 animate-pulse" />
        )}
      </div>
      {isUser && (
        <div className="h-8 w-8 rounded-full bg-elevated flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
