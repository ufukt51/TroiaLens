export interface HistoryEntry {
  id: string
  name: string
  size: number
  addedAt: number
  transaction?: string
  user?: string
  score: number
  statements: number
  sql: number
  hasText: boolean
}

const DB_NAME = 'troialens'
const MAX_TEXT = 60 * 1024 * 1024

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('entries', { keyPath: 'id' })
      db.createObjectStore('texts')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode)
        const req = fn(t)
        t.oncomplete = () => resolve(req ? req.result : undefined)
        t.onerror = () => reject(t.error)
      }),
  )
}

export async function listHistory(): Promise<HistoryEntry[]> {
  try {
    const all = (await tx<HistoryEntry[]>(['entries'], 'readonly', (t) => t.objectStore('entries').getAll())) ?? []
    return all.sort((a, b) => b.addedAt - a.addedAt)
  } catch {
    return []
  }
}

export async function saveHistory(entry: Omit<HistoryEntry, 'id' | 'hasText'>, text: string): Promise<string | null> {
  try {
    const id = `${entry.name}|${entry.size}|${hash(text)}`
    const hasText = text.length <= MAX_TEXT
    await tx(['entries', 'texts'], 'readwrite', (t) => {
      t.objectStore('entries').put({ ...entry, id, hasText })
      if (hasText) t.objectStore('texts').put(text, id)
    })
    return id
  } catch {
    return null
  }
}

export async function loadHistoryText(id: string): Promise<string | undefined> {
  try {
    return await tx<string>(['texts'], 'readonly', (t) => t.objectStore('texts').get(id))
  } catch {
    return undefined
  }
}

export async function deleteHistory(id?: string): Promise<void> {
  try {
    await tx(['entries', 'texts'], 'readwrite', (t) => {
      if (id) {
        t.objectStore('entries').delete(id)
        t.objectStore('texts').delete(id)
      } else {
        t.objectStore('entries').clear()
        t.objectStore('texts').clear()
      }
    })
  } catch {
    /* storage unavailable */
  }
}

function hash(s: string): string {
  let h = 2166136261
  const step = Math.max(1, Math.floor(s.length / 200000))
  for (let i = 0; i < s.length; i += step) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
