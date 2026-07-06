// DOM-free per CLAUDE.md: IndexedDB comes from fake-indexeddb, `window` is a
// minimal manual stub (api.ts's BASE reads window.location.origin), no
// jsdom/testing-library involved.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DB_NAME = "wordplay-dictionary";

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function mockFetch(version: { hash: string; size: number; wordCount: number }, text: string) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/dictionary/version")) {
      return new Response(JSON.stringify(version), { status: 200 });
    }
    if (url.endsWith(`/dictionary/${version.hash}.txt`)) {
      return new Response(text, { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  await deleteDb();
});

describe("getDictionary", () => {
  it("cold start fetches the version and body and caches it", async () => {
    const fetchMock = mockFetch({ hash: "hash-a", size: 4, wordCount: 1 }, "CAT\n");
    vi.stubGlobal("fetch", fetchMock);

    const { getDictionary } = await import("./dictionary");
    const dict = await getDictionary();

    expect(dict.isWord("cat")).toBe(true);
    expect(dict.isWord("dog")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("warm start with a matching cached hash skips the body fetch entirely", async () => {
    vi.stubGlobal("fetch", mockFetch({ hash: "hash-a", size: 4, wordCount: 1 }, "CAT\n"));
    const first = await import("./dictionary");
    await first.getDictionary();

    vi.resetModules();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/dictionary/version")) {
        return new Response(JSON.stringify({ hash: "hash-a", size: 4, wordCount: 1 }), { status: 200 });
      }
      throw new Error(`unexpected fetch (body should be cached): ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const second = await import("./dictionary");
    const dict = await second.getDictionary();

    expect(dict.isWord("cat")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("warm start with a stale cached hash re-fetches the body and updates the cache", async () => {
    vi.stubGlobal("fetch", mockFetch({ hash: "hash-a", size: 4, wordCount: 1 }, "CAT\n"));
    const first = await import("./dictionary");
    await first.getDictionary();

    vi.resetModules();
    const fetchMock = mockFetch({ hash: "hash-b", size: 4, wordCount: 1 }, "DOG\n");
    vi.stubGlobal("fetch", fetchMock);

    const second = await import("./dictionary");
    const dict = await second.getDictionary();

    expect(dict.isWord("dog")).toBe(true);
    expect(dict.isWord("cat")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Cache should now hold hash-b, so a subsequent warm start skips the body fetch.
    vi.resetModules();
    const thirdFetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/dictionary/version")) {
        return new Response(JSON.stringify({ hash: "hash-b", size: 4, wordCount: 1 }), { status: 200 });
      }
      throw new Error(`unexpected fetch (body should be cached): ${url}`);
    });
    vi.stubGlobal("fetch", thirdFetchMock);
    const third = await import("./dictionary");
    const dict3 = await third.getDictionary();
    expect(dict3.isWord("dog")).toBe(true);
    expect(thirdFetchMock).toHaveBeenCalledTimes(1);
  });
});
