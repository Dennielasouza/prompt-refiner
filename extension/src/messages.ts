import {
  DEPTHS,
  type Depth,
  KINDS,
  type OutputKind,
  REQUESTED_TARGETS,
  type RequestedTarget,
  TARGETS,
  type Target,
} from "../../shared/api.js";

/**
 * background → content. `kind` says what is produced (a prompt or an instructions file) and drives the toasts.
 *
 * Compatibility: content.js is read from disk on every injection, but Chrome keeps running the
 * service worker it registered at the last (re)load of the extension. After a rebuild of an
 * unpacked extension that was not reloaded, an OLDER background talks to a NEWER content script.
 * So fields added later must be optional here (`kind` absent = "prompt", as before it existed);
 * rejecting them made every right-click fail silently ("a página não respondeu").
 */
export type ToContent =
  | { type: "pr:capture"; opId: string; target: RequestedTarget; depth: Depth; kind?: OutputKind }
  | { type: "pr:apply"; opId: string; refinedPrompt: string; target: Target; depth: Depth; kind?: OutputKind }
  | { type: "pr:error"; opId: string; detail?: string };

/** content → background */
export type ToBackground = { type: "pr:cancel"; opId: string };

export type CaptureResponse =
  /** `build`: the content script's build id, so the background can tell it is older than the files on disk. */
  | { ok: true; text: string; hostname: string; build?: string }
  | { ok: false; reason: "no_selection" | "password" | "unsupported" | "too_long" };

const isStr = (v: unknown, max = 100): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
/** Absent (messages from builds before `kind` existed) means "prompt". */
const isKind = (v: unknown): v is OutputKind | undefined => v === undefined || KINDS.includes(v as OutputKind);

/** The kind a message asks for ("prompt" when an older background did not send one). */
export const kindOf = (m: { kind?: OutputKind }): OutputKind => m.kind ?? "prompt";

export function isToContent(m: unknown): m is ToContent {
  if (!isObj(m) || !isStr(m.opId)) return false;
  switch (m.type) {
    case "pr:capture":
      return REQUESTED_TARGETS.includes(m.target as RequestedTarget) && DEPTHS.includes(m.depth as Depth) && isKind(m.kind);
    case "pr:apply":
      return (
        isStr(m.refinedPrompt, 40_000) &&
        TARGETS.includes(m.target as Target) &&
        DEPTHS.includes(m.depth as Depth) &&
        isKind(m.kind)
      );
    case "pr:error":
      return m.detail === undefined || isStr(m.detail, 300);
    default:
      return false;
  }
}

export function isToBackground(m: unknown): m is ToBackground {
  return isObj(m) && m.type === "pr:cancel" && isStr(m.opId);
}

export function isCaptureResponse(m: unknown): m is CaptureResponse {
  if (!isObj(m)) return false;
  if (m.ok === true)
    return typeof m.text === "string" && typeof m.hostname === "string" && (m.build === undefined || typeof m.build === "string");
  return m.ok === false && typeof m.reason === "string";
}
