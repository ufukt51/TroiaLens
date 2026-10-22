/**
 * Per-document view state for the Notepad++ panel. While a document is shown its views keep their state here as
 * plain values; when the user moves to another document the state is packed into a small compressed snapshot, and
 * coming back restores it into the freshly analysed page. Outside a provider (the browser) the hooks are useState.
 */

import { createContext, useContext, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction, type UIEvent } from 'react'

export class DocStore {
  readonly values: Map<string, unknown>
  constructor(values = new Map<string, unknown>()) {
    this.values = values
  }
}

export const DocStateContext = createContext<DocStore | null>(null)

export const useDocStore = () => useContext(DocStateContext)

/** useState that survives a document switch. Only values the user changed are stored. */
export function usePersisted<T>(key: string, init: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const store = useDocStore()
  const [value, setValue] = useState<T>(() =>
    store?.values.has(key) ? (store.values.get(key) as T) : typeof init === 'function' ? (init as () => T)() : init,
  )
  const first = useRef(value)
  // Once changed it stays stored, even when set back to where it started
  const changed = useRef(store?.values.has(key) ?? false)
  if (value !== first.current) changed.current = true
  if (store && changed.current) store.values.set(key, value)
  return [value, setValue]
}

/**
 * Scroll position that survives a document switch: restored when the element mounts or the key changes, saved as
 * the user scrolls. Without a key (or outside a provider) it does nothing.
 */
export function useSavedScroll<E extends HTMLElement>(key: string | undefined) {
  const store = useDocStore()
  const ref = useRef<E>(null)
  const saved = key && store ? ((store.values.get(key) as number | undefined) ?? 0) : 0
  useLayoutEffect(() => {
    if (key && store && ref.current) ref.current.scrollTop = saved
    // Only a new element or key restores; later renders leave the reader's place alone
  }, [key, store])
  const onScroll = (e: UIEvent<E>) => {
    if (!key || !store) return
    const top = Math.round(e.currentTarget.scrollTop)
    if (top) store.values.set(key, top)
    else store.values.delete(key)
  }
  return { ref, onScroll, saved }
}

// ---- Snapshots ----

/** Packed state: deflated JSON, or the JSON bytes themselves when deflating would not make them smaller */
export interface Packed {
  deflated: boolean
  bytes: Uint8Array
}

/**
 * JSON-ready form. Number sets are sorted and delta coded (tree rows opened by level are runs of near ids, so the
 * deltas are mostly 1 and deflate to almost nothing); "nonce" fields, which only tell requests apart, are dropped.
 */
function toPlain(v: unknown): unknown {
  if (v instanceof Set) {
    const items = [...v]
    if (items.every((x) => typeof x === 'number')) {
      const sorted = (items as number[]).sort((a, b) => a - b)
      return { $n: sorted.map((x, i) => (i ? x - sorted[i - 1] : x)) }
    }
    return { $s: items.map(toPlain).sort() }
  }
  if (Array.isArray(v)) return v.map(toPlain)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (k !== 'nonce' && x !== undefined) out[k] = toPlain(x)
    return out
  }
  return v
}

function fromPlain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromPlain)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.$n)) {
      let at = 0
      return new Set((o.$n as number[]).map((d, i) => (at = i ? at + d : d)))
    }
    if (Array.isArray(o.$s)) return new Set(o.$s.map(fromPlain))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) out[k] = fromPlain(x)
    return out
  }
  return v
}

export function encodeState(values: Map<string, unknown>): string {
  const out: Record<string, unknown> = {}
  for (const [k, v] of values) if (v !== undefined) out[k] = toPlain(v)
  return JSON.stringify(out)
}

export function decodeState(json: string): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const [k, v] of Object.entries(JSON.parse(json) as Record<string, unknown>)) map.set(k, fromPlain(v))
  return map
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())
}

/** Encodes now (the values may change right after) and deflates in the background. */
export function packState(values: Map<string, unknown>): Promise<Packed> {
  const raw = new TextEncoder().encode(encodeState(values))
  if (typeof CompressionStream === 'undefined') return Promise.resolve({ deflated: false, bytes: raw })
  return pipe(raw, new CompressionStream('deflate-raw')).then(
    (z) => (z.length < raw.length ? { deflated: true, bytes: z } : { deflated: false, bytes: raw }),
    () => ({ deflated: false, bytes: raw }),
  )
}

export async function unpackState(p: Packed): Promise<Map<string, unknown>> {
  const raw = p.deflated ? await pipe(p.bytes, new DecompressionStream('deflate-raw')) : p.bytes
  return decodeState(new TextDecoder().decode(raw))
}
