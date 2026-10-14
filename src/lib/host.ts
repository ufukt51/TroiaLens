/** Bridge to the Notepad++ plugin (WebView2). Falls back to a no-op outside the host. */

import type { Mark } from './locate.ts'

export type HostMessage =
  | { type: 'load'; name: string; text: string }
  | { type: 'loadUrl'; name: string; url: string }
  | { type: 'notTrace'; name: string }
  | { type: 'empty' }
  | { type: 'theme'; dark: boolean }
  /** User preferences from the plugin menu */
  | { type: 'prefs'; detailSlideOver: boolean }
  /** The editor caret moved to another line of the analysed document */
  | { type: 'caret'; line: number }

interface WebView {
  postMessage(msg: unknown): void
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void
  removeEventListener(type: 'message', fn: (e: { data: unknown }) => void): void
}

function webview(): WebView | undefined {
  return (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview
}

export const inHost = (): boolean => !!webview()

export type PageMessage =
  | { type: 'ready' }
  | { type: 'gotoLine'; line: number; focus: boolean }
  /** Highlights a scope span, the selected row's lines and the method name inside the span (see markFor) */
  | ({ type: 'mark' } & Mark)
  | { type: 'clearMarks' }
  | { type: 'reload' }
  /** The user changed a preference in the page; the plugin saves it and answers with prefs */
  | { type: 'setPrefs'; detailSlideOver: boolean }

export function postToHost(msg: PageMessage) {
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
