// Fetches the shared wordlist from the backend's content-addressed
// /dictionary/* routes (see backend/src/routes/dictionary.ts) and caches it
// in IndexedDB so a redeploy of the frontend bundle never re-downloads it --
// only an actual wordlist change (a new hash) does. Not part of api.ts's
// request() helper since these routes are unauthenticated.
import { useEffect, useState } from "react";
import { loadDictionaryFromText, type Dictionary } from "@wordplay/shared";
import { BASE } from "./api";

const DB_NAME = "wordplay-dictionary";
const STORE_NAME = "dictionary";
const RECORD_KEY = "current";

interface CachedDictionary {
  hash: string;
  text: string;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCached(): Promise<CachedDictionary | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      req.onsuccess = () => resolve(req.result as CachedDictionary | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function writeCached(record: CachedDictionary): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

interface DictionaryVersion {
  hash: string;
  size: number;
  wordCount: number;
}

async function fetchDictionaryText(): Promise<string> {
  const versionRes = await fetch(`${BASE}/dictionary/version`);
  if (!versionRes.ok) throw new Error(`dictionary version fetch failed: ${versionRes.status}`);
  const version = (await versionRes.json()) as DictionaryVersion;

  const cached = await readCached();
  if (cached?.hash === version.hash) return cached.text;

  const textRes = await fetch(`${BASE}/dictionary/${version.hash}.txt`);
  if (!textRes.ok) throw new Error(`dictionary body fetch failed: ${textRes.status}`);
  const text = await textRes.text();
  await writeCached({ hash: version.hash, text, cachedAt: Date.now() });
  return text;
}

let dictionaryPromise: Promise<Dictionary> | null = null;

/** Memoized: only the first call actually hits IndexedDB/network. */
export function getDictionary(): Promise<Dictionary> {
  if (!dictionaryPromise) {
    dictionaryPromise = fetchDictionaryText()
      .then(loadDictionaryFromText)
      .catch((e) => {
        dictionaryPromise = null; // allow retry on next call
        throw e;
      });
  }
  return dictionaryPromise;
}

export function useDictionary(): { dictionary: Dictionary | null; loading: boolean; error: unknown } {
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    getDictionary()
      .then((d) => {
        if (!cancelled) setDictionary(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { dictionary, loading, error };
}
