import { useState, useEffect } from "react";

/**
 * useLocalStorage — like useState but persists to localStorage.
 *
 * Reads once on init; writes whenever state changes. JSON-serialized.
 * Editor-scoped — keys apply across all projects (use `editor.*`
 * prefix when picking keys at the call site).
 *
 * **SSR / non-DOM eval safety**
 * Bun's HMR / dev path may evaluate this module in a context where
 * `window` is undefined (early bundle eval, server-side prerender if
 * one is ever added). The `typeof window` guard inside the lazy
 * `useState` initialiser keeps the hook from throwing in that path
 * and falls through to `defaultValue`. The write `useEffect` only
 * fires after mount on the client so it never runs without a window.
 *
 * **Validation**
 * The optional `validate` callback runs on the parsed-from-storage
 * value. Return `true` to accept it, `false` to discard and fall back
 * to `defaultValue`. Use this for values whose legal range may have
 * shrunk since a prior session wrote to storage (e.g. an enum was
 * narrowed). For string-id values that may simply no longer exist in
 * the current pack, prefer to let the consumer handle a stale id
 * gracefully — no validate needed.
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  validate?: (value: unknown) => boolean,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = JSON.parse(raw) as unknown;
      if (validate && !validate(parsed)) return defaultValue;
      return parsed as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded / disabled — swallow.
    }
  }, [key, value]);

  return [value, setValue];
}
