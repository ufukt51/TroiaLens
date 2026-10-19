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

/** Larger files are not remembered at all */
export const MAX_HISTORY_FILE = 400 * 1024 * 1024

/** Remembers an analysed file; its content too when it is small enough */
export async function saveHistory(entry: Omit<HistoryEntry, 'id' | 'hasText'>, file: Blob): Promise<string | null> {
  if (file.size > MAX_HISTORY_FILE) return null
  try {
    const id = `${entry.name}|${entry.size}|${await hash(file)}`
    const hasText = file.size <= MAX_TEXT
    await tx(['entries', 'texts'], 'readwrite', (t) => {
      t.objectStore('entries').put({ ...entry, id, hasText })
      if (hasText) t.objectStore('texts').put(file, id)
    })
    return id
  } catch {
    return null
  }
}

/** Content of a remembered file (older entries kept it as a string) */
export async function loadHistoryText(id: string): Promise<Blob | undefined> {
  try {
    const v = await tx<Blob | string>(['texts'], 'readonly', (t) => t.objectStore('texts').get(id))
    return typeof v === 'string' ? new Blob([v], { type: 'text/plain' }) : v
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

/** Of the file's first and last 64 KB: enough to tell traces of the same name and size apart */
async function hash(file: Blob): Promise<string> {
  const part = 1 << 16
  const head = new Uint8Array(await file.slice(0, part).arrayBuffer())
  const tail = file.size > part ? new Uint8Array(await file.slice(Math.max(part, file.size - part)).arrayBuffer()) : new Uint8Array(0)
  let h = 2166136261
  for (const b of [head, tail])
    for (let i = 0; i < b.length; i++) {
      h ^= b[i]
      h = Math.imul(h, 16777619)
    }
  return (h >>> 0).toString(36)
}
