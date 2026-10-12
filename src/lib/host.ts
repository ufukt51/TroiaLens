/** Bridge to the Notepad++ plugin (WebView2). Falls back to a no-op outside the host. */

export type HostMessage =
  | { type: 'load'; name: string; text: string }
  | { type: 'loadUrl'; name: string; url: string }
  | { type: 'notTrace'; name: string }
  | { type: 'empty' }
  | { type: 'theme'; dark: boolean }

interface WebView {
  postMessage(msg: unknown): void
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void
  removeEventListener(type: 'message', fn: (e: { data: unknown }) => void): void
}

function webview(): WebView | undefined {
  return (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview
}

export const inHost = (): boolean => !!webview()

export function postToHost(msg: { type: 'ready' } | { type: 'gotoLine'; line: number; focus: boolean } | { type: 'reload' }) {
  webview()?.postMessage(msg)
}

export function onHostMessage(fn: (msg: HostMessage) => void): () => void {
  const wv = webview()
  if (!wv) return () => {}
  const handler = (e: { data: unknown }) => {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    if (data && typeof data === 'object' && 'type' in data) fn(data as HostMessage)
  }
  wv.addEventListener('message', handler)
  return () => wv.removeEventListener('message', handler)
}

export function setTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
}
