// Frontend renderer for the haiku-poem plugin.
//
// This ES module is served via GET /api/plugins/haiku-poem/frontend
// and dynamically imported by the frontend registry.

export function register(registerContentType) {
  registerContentType({
    type: 'haiku',
    label: 'Haiku',
    // Use a simple text icon — plugins can import from lucide-react
    // when bundled with the full frontend build system
    icon: function HaikuIcon(props) {
      return null // Placeholder — rendered server-side
    },
    renderer: function HaikuRenderer({ post }) {
      const lines = (post.caption || '').split('\n')
      return {
        type: 'div',
        props: {
          className: 'haiku-renderer',
          style: {
            fontFamily: 'Georgia, serif',
            fontSize: '1.25rem',
            lineHeight: '2',
            textAlign: 'center',
            padding: '2rem',
            fontStyle: 'italic',
          },
          children: lines.map(function(line, i) {
            return {
              type: 'p',
              props: { key: i, children: line },
            }
          }),
        },
      }
    },
    previewRenderer: function HaikuPreview({ post }) {
      return {
        type: 'p',
        props: {
          style: { fontStyle: 'italic' },
          children: post.caption || 'Haiku loading...',
        },
      }
    },
    createConfig: {
      tokenCost: 2,
      estimatedTime: '10-15s',
      stages: [
        { name: 'compose', label: 'Composing', description: 'Writing the haiku' },
        { name: 'polish', label: 'Polishing', description: 'Refining syllable count' },
      ],
      placeholder: 'Describe a scene or feeling for your haiku...',
    },
  })
}
