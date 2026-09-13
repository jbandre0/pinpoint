"use client";

// Manual familiarity state — client-only, localStorage-backed, with an
// optional Supabase sync layer on top for signed-in users.
//
// Three states per fact-id: "new" (default, never stored) -> "familiar" -> "mastered".
// Set entirely by the user, never automatically (no SRS, no dates). Stored as a flat
// map so syncing to a per-user DB row is a straight copy, not a remodel.
//
// Signed-out users: pure localStorage, unchanged from Phase 1.
// Signed-in users: localStorage stays a local cache/fallback, but the
// `progress` table row is the source of truth — pulled on sign-in (with a
// one-time upload if the row is empty but local progress exists), and pushed
// on every change (debounced).

import { useCallback, useEffect, useState } from "react";
import type { FactState, FactStateMap, FactStateOrNew } from "./types";
import { getSupabase, PROGRESS_TABLE } from "./supabase";

const STORAGE_KEY = "pinpoint:factState";
const EMPTY: FactStateMap = Object.freeze({}) as FactStateMap;

function read(): FactStateMap {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    return parsed as FactStateMap;
  } catch {
    return EMPTY;
  }
}

function write(map: FactStateMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage disabled / full — progress just won't persist this session
  }
}

// Module-level source of truth on the client. Server renders always see EMPTY.
let current: FactStateMap = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  current = read();
  loaded = true;
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      current = read();
      listeners.forEach((l) => l());
    }
  });
}

// --- reads / mutations ---------------------------------------------------

export function getFactStateMap(): FactStateMap {
  ensureLoaded();
  return current;
}

export function getFactState(id: string): FactStateOrNew {
  return getFactStateMap()[id] ?? "new";
}

export function setFactState(id: string, state: FactStateOrNew): void {
  ensureLoaded();
  const next: FactStateMap = { ...current };
  if (state === "new") delete next[id];
  else next[id] = state;
  current = next;
  write(next);
  schedulePush();
  listeners.forEach((l) => l());
}

const ORDER: FactStateOrNew[] = ["new", "familiar", "mastered"];

/** Cycle new -> familiar -> mastered -> new. */
export function cycleFactState(id: string): FactStateOrNew {
  const next = ORDER[(ORDER.indexOf(getFactState(id)) + 1) % ORDER.length];
  setFactState(id, next);
  return next;
}

/** Drop one level (mastered -> familiar -> new). Used by the quiz demotion rule. */
export function demoteFactState(id: string): FactStateOrNew {
  const idx = Math.max(0, ORDER.indexOf(getFactState(id)) - 1);
  setFactState(id, ORDER[idx]);
  return ORDER[idx];
}

// --- Supabase sync --------------------------------------------------------
//
// `currentUserId` mirrors the signed-in user's id, set from React via
// `syncSessionUser`. It is intentionally decoupled from any hook so plain
// (non-React) callers of setFactState above keep working unchanged.

let currentUserId: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePush(): void {
  if (!currentUserId) return;
  const supabase = getSupabase();
  if (!supabase) return;
  const userId = currentUserId;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const snapshot = current;
    supabase
      .from(PROGRESS_TABLE)
      .upsert({ user_id: userId, fact_state: snapshot })
      .then(({ error }) => {
        if (error) console.error("Pin Point: failed to sync progress", error.message);
      });
  }, 800);
}

async function pullFromSupabase(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data, error } = await supabase
    .from(PROGRESS_TABLE)
    .select("fact_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Pin Point: failed to load progress", error.message);
    return;
  }
  // A stale/no-op session switch could race this fetch; only apply the
  // result if the user is still the one we asked about.
  if (currentUserId !== userId) return;

  ensureLoaded();
  const remote = (data?.fact_state as FactStateMap | undefined) ?? null;
  const remoteHasData = remote && Object.keys(remote).length > 0;
  const localHasData = Object.keys(current).length > 0;

  if (remoteHasData) {
    current = remote!;
    write(current);
  } else if (localHasData) {
    // First sign-in with existing local progress and an empty remote row:
    // migrate it up rather than treating the empty row as authoritative.
    await supabase.from(PROGRESS_TABLE).upsert({ user_id: userId, fact_state: current });
  }
  listeners.forEach((l) => l());
}

/**
 * Called from React (see `useFactStateSync`) whenever the auth session
 * changes. `undefined` = auth state still loading (no-op), `null` = signed
 * out (fall back to localStorage), a string = signed in with that user id.
 */
export function syncSessionUser(userId: string | null | undefined): void {
  if (userId === undefined || userId === currentUserId) return;
  currentUserId = userId;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (userId) {
    pullFromSupabase(userId);
  } else {
    ensureLoaded();
    current = read();
    listeners.forEach((l) => l());
  }
}

// --- hooks -------------------------------------------------------------

/**
 * The whole fact-state map. Server + first client render return EMPTY; a single
 * post-hydration effect swaps in the stored value and subscribes to changes.
 */
export function useFactStateMap(): FactStateMap {
  const [map, setMap] = useState<FactStateMap>(EMPTY);
  useEffect(() => {
    ensureLoaded();
    setMap(current);
    const onChange = () => setMap(current);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return map;
}

/** One fact's state plus a cycle handler. */
export function useFactState(id: string): [FactStateOrNew, () => void] {
  const map = useFactStateMap();
  const value = map[id] ?? "new";
  const cycle = useCallback(() => cycleFactState(id), [id]);
  return [value, cycle];
}

export function weightForState(state: FactStateOrNew): number {
  return state === "mastered" ? 1 : state === "familiar" ? 0.5 : 0;
}

export type { FactState, FactStateMap };
