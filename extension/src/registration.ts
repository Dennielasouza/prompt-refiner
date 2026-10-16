/**
 * Guards the content script against double registration without trusting stale state.
 *
 * The script is injected on every use, so it must register its message listener only once per
 * live extension context. A plain boolean flag is unsafe: if it ever survived an extension
 * reload/update (or the listener was removed), every later injection would skip registering
 * and the background would get "Receiving end does not exist" forever. So the registration
 * records the build that created it and a liveness probe, and a fresh injection takes over
 * (disposing the previous listener) whenever the previous one is from another build or its
 * extension context is gone.
 */

export const REGISTRATION_KEY = "__promptRefinerRegistration";

export interface Registration {
  /** Build that registered the listener (changes on every build). */
  build: string;
  /** False once the extension context that owns the listener has been invalidated. */
  alive: () => boolean;
  /** Removes the listener and any page-side state owned by it. */
  dispose: () => void;
}

type Host = Record<string, unknown>;

function isRegistration(v: unknown): v is Registration {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.build === "string" && typeof r.alive === "function" && typeof r.dispose === "function";
}

function isAlive(r: Registration): boolean {
  try {
    return r.alive() === true;
  } catch {
    return false;
  }
}

/** True when this extension context can still talk to the background (false in orphaned scripts). */
export function extensionContextAlive(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Registers via `register()` unless a live registration of the same build already exists.
 * Returns true when this call registered (i.e. it now owns the listener).
 */
export function claimRegistration(host: object, build: string, alive: () => boolean, register: () => () => void): boolean {
  const slot = host as Host;
  const previous = slot[REGISTRATION_KEY];
  if (isRegistration(previous)) {
    if (previous.build === build && isAlive(previous)) return false;
    try {
      previous.dispose();
    } catch {
      // The previous context may already be gone; nothing else to clean up.
    }
  }
  const dispose = register();
  slot[REGISTRATION_KEY] = { build, alive, dispose } satisfies Registration;
  return true;
}

/**
 * Drops the current registration so the next injection registers a fresh listener.
 * Self-contained (no closures): the background runs it in the page via scripting.executeScript({ func }).
 */
export function resetRegistrationInPage(key: string): void {
  const slot = window as unknown as Record<string, unknown>;
  const previous = slot[key] as { dispose?: unknown } | undefined;
  delete slot[key];
  if (previous && typeof previous.dispose === "function") {
    try {
      previous.dispose();
    } catch {
      // The previous context may already be gone.
    }
  }
}
