import { Chat } from '@/components/Chat'

// The builder's `register_ai_app` tool replaces these at generation
// time with the app's real name and greeting.
const APP_NAME = import.meta.env.VITE_FORGING_APP_NAME ?? 'AI Assistant'
const APP_GREETING =
  import.meta.env.VITE_FORGING_APP_GREETING ??
  'Ask me anything — I can help you think through problems, draft text, or work through ideas.'

export function App() {
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-accent/15 flex items-center justify-center">
            <span className="text-sm font-semibold text-accent">A</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{APP_NAME}</h1>
            <p className="text-[11px] text-muted-foreground">
              Powered by{' '}
              <a
                href="https://www.forging.dev"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Forging
              </a>
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Chat greeting={APP_GREETING} />
      </main>
    </div>
  )
}
