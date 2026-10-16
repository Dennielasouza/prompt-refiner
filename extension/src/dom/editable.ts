/**
 * Selection capture and replacement for <input>, <textarea> and contenteditable editors.
 *
 * The LLM call is async, so the selection is captured synchronously when the menu is clicked
 * and replaced later. Before writing, we always re-check that the captured text is still
 * where we expect it; if not, nothing is modified.
 */

/** Input types that support the selection API (email/number do not). */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", ""]);

export type TextControl = HTMLInputElement | HTMLTextAreaElement;

export type Capture =
  | {
      kind: "text-control";
      el: TextControl;
      start: number;
      end: number;
      selectedText: string;
    }
  | {
      kind: "contenteditable";
      host: HTMLElement;
      /** Live range: follows DOM mutations made by the editor while we wait. */
      range: Range;
      /** Range text in text-node coordinates (no block separators). */
      rangeText: string;
      /** Text as the user sees it (with line breaks between blocks). Sent to the backend. */
      selectedText: string;
      startOffset: number;
      endOffset: number;
    };

export type CaptureFailure = "no_selection" | "password" | "unsupported";
export type CaptureResult = { ok: true; capture: Capture } | { ok: false; reason: CaptureFailure };

export type ApplyFailure = "field_gone" | "selection_changed" | "editor_rejected";

export type UndoInfo =
  | { kind: "text-control"; el: TextControl; start: number; inserted: string; original: string }
  | { kind: "contenteditable"; host: HTMLElement; startOffset: number; endOffset: number; inserted: string; original: string };

export type ApplyResult = { ok: true; undo: UndoInfo } | { ok: false; reason: ApplyFailure };

// ---------------------------------------------------------------------------
// Capture

/** document.activeElement, descending into open shadow roots and same-document editors. */
export function deepActiveElement(doc: Document = document): Element | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function isTextControl(el: Element | null): el is TextControl {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el as HTMLInputElement).type.toLowerCase());
}

function isPasswordField(el: Element | null): boolean {
  return el?.tagName === "INPUT" && (el as HTMLInputElement).type.toLowerCase() === "password";
}

/** Outermost contenteditable ancestor (the "editing host") of a node. */
export function editingHost(node: Node | null): HTMLElement | null {
  let el: Element | null = node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
  let host: HTMLElement | null = null;
  while (el) {
    if ((el as HTMLElement).isContentEditable || isEditableAttr(el)) host = el as HTMLElement;
    else if (host) break;
    el = el.parentElement;
  }
  return host;
}

/** isContentEditable is not implemented by every DOM (e.g. jsdom); fall back to the attribute. */
function isEditableAttr(el: Element): boolean {
  const v = el.getAttribute("contenteditable");
  if (v === null) return false;
  return v !== "false";
}

function selectionFor(el: Element | null, doc: Document): Selection | null {
  const root = el?.getRootNode() as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
  return root && root !== (doc as unknown) && typeof root.getSelection === "function" ? root.getSelection() : doc.getSelection();
}

export function captureSelection(doc: Document = document): CaptureResult {
  const active = deepActiveElement(doc);

  if (isPasswordField(active)) return { ok: false, reason: "password" };

  if (isTextControl(active)) {
    if (active.readOnly || active.disabled) return { ok: false, reason: "unsupported" };
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start === null || end === null) return { ok: false, reason: "unsupported" };
    if (start === end) return { ok: false, reason: "no_selection" };
    const selectedText = active.value.slice(start, end);
    if (!selectedText.trim()) return { ok: false, reason: "no_selection" };
    return { ok: true, capture: { kind: "text-control", el: active, start, end, selectedText } };
  }

  if (active?.tagName === "INPUT") return { ok: false, reason: "unsupported" };

  const sel = selectionFor(active, doc);
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { ok: false, reason: "no_selection" };
  const range = sel.getRangeAt(0);
  const host = editingHost(range.commonAncestorContainer);
  if (!host) return { ok: false, reason: "unsupported" };
  // Never touch password-like editors or a selection that escapes the editor.
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return { ok: false, reason: "unsupported" };

  const selectedText = sel.toString();
  const rangeText = range.toString();
  if (!selectedText.trim() || !rangeText) return { ok: false, reason: "no_selection" };

  return {
    ok: true,
    capture: {
      kind: "contenteditable",
      host,
      range: range.cloneRange(),
      rangeText,
      selectedText,
      startOffset: textOffset(host, range.startContainer, range.startOffset),
      endOffset: textOffset(host, range.endContainer, range.endOffset),
    },
  };
}

// ---------------------------------------------------------------------------
// Text-node coordinates (stable across editor re-renders of unrelated nodes)

export function textOffset(host: Node, container: Node, offset: number): number {
  const r = host.ownerDocument!.createRange();
  r.setStart(host, 0);
  r.setEnd(container, offset);
  return r.toString().length;
}

function textNodes(host: Node): Text[] {
  const doc = host.ownerDocument!;
  const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * Builds a range from text-node offsets. An offset on a node boundary (end of one paragraph =
 * start of the next) is ambiguous: the start binds forward and the end binds backward, so the
 * range never straddles a block it does not need.
 */
export function rangeFromOffsets(host: Node, start: number, end: number): Range | null {
  const doc = host.ownerDocument!;
  const nodes = textNodes(host);
  const range = doc.createRange();
  let pos = 0;
  let startSet = false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const len = node.data.length;
    const last = i === nodes.length - 1;
    if (!startSet && (start < pos + len || (start === pos + len && (last || start === end)))) {
      range.setStart(node, start - pos);
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

/** Index of needle in haystack only if it occurs exactly once. */
export function uniqueIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1;
  const first = haystack.indexOf(needle);
  if (first === -1 || haystack.indexOf(needle, first + 1) !== -1) return -1;
  return first;
}

/** Letters only: lets us compare text across editors that turn "- item" / "1. item" / "**x**" into markup. */
export function letters(text: string): string {
  return (text.match(/\p{L}+/gu) ?? []).join("").toLowerCase();
}

// ---------------------------------------------------------------------------
// Replacement

export async function applyReplacement(capture: Capture, text: string): Promise<ApplyResult> {
  return capture.kind === "text-control" ? applyToTextControl(capture, text) : applyToContentEditable(capture, text);
}

function applyToTextControl(cap: Extract<Capture, { kind: "text-control" }>, text: string): ApplyResult {
  const { el } = cap;
  if (!el.isConnected || el.disabled || el.readOnly) return { ok: false, reason: "field_gone" };

  let start = cap.start;
  let end = cap.end;
  if (el.value.slice(start, end) !== cap.selectedText) {
    // The field changed while we waited: relocate the original text if it is unambiguous.
    const idx = uniqueIndexOf(el.value, cap.selectedText);
    if (idx === -1) return { ok: false, reason: "selection_changed" };
    start = idx;
    end = idx + cap.selectedText.length;
  }

  // <input> cannot hold line breaks.
  const insert = el.tagName === "INPUT" ? text.replace(/\s*\n+\s*/g, " ").trim() : text;
  replaceInTextControl(el, start, end, insert);
  return { ok: true, undo: { kind: "text-control", el, start, inserted: insert, original: cap.selectedText } };
}

/**
 * Replaces [start, end) in a text control. execCommand("insertText") is preferred: it fires
 * beforeinput/input like real typing (React & co. pick it up) and joins the native undo stack.
 */
export function replaceInTextControl(el: TextControl, start: number, end: number, insert: string): void {
  const doc = el.ownerDocument;
  const before = el.value;
  const expected = before.slice(0, start) + insert + before.slice(end);
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);

  let viaCommand = false;
  try {
    viaCommand = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, insert);
  } catch {
    viaCommand = false;
  }
  if (viaCommand && el.value !== before) return;

  // Fallback: setRangeText bypasses the value setter, so React's value tracker still sees a change
  // when the input event arrives.
  el.setRangeText(insert, start, end, "end");
  if (el.value !== expected) el.value = expected;
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: insert }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  const caret = start + insert.length;
  el.setSelectionRange(caret, caret);
}

function resolveRange(cap: Extract<Capture, { kind: "contenteditable" }>): Range | null {
  const { host, range, rangeText } = cap;
  if (host.contains(range.startContainer) && host.contains(range.endContainer) && range.toString() === rangeText) {
    return range;
  }
  const fromOffsets = rangeFromOffsets(host, cap.startOffset, cap.endOffset);
  if (fromOffsets && fromOffsets.toString() === rangeText) return fromOffsets;

  const all = textNodes(host)
    .map((n) => n.data)
    .join("");
  const idx = uniqueIndexOf(all, rangeText);
  if (idx === -1) return null;
  return rangeFromOffsets(host, idx, idx + rangeText.length);
}

async function applyToContentEditable(cap: Extract<Capture, { kind: "contenteditable" }>, text: string): Promise<ApplyResult> {
  const { host } = cap;
  if (!host.isConnected) return { ok: false, reason: "field_gone" };
  const range = resolveRange(cap);
  if (!range) return { ok: false, reason: "selection_changed" };

  const startOffset = textOffset(host, range.startContainer, range.startOffset);
  const inserted = await replaceInEditable(host, range, text);
  if (!inserted) return { ok: false, reason: "editor_rejected" };

  return {
    ok: true,
    undo: {
      kind: "contenteditable",
      host,
      startOffset,
      endOffset: inserted.endOffset,
      inserted: text,
      original: cap.selectedText,
    },
  };
}

function selectRange(host: HTMLElement, range: Range): Selection | null {
  host.focus({ preventScroll: true });
  const sel = selectionFor(host, host.ownerDocument);
  if (!sel) return null;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/**
 * Rich editors (ProseMirror, Lexical, Quill) copy the DOM selection into their own model on the
 * async "selectionchange" event. Wait for it, so a paste right after a programmatic selection
 * targets the range we set and not the editor's stale selection.
 */
function selectionSynced(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      doc.removeEventListener("selectionchange", done);
      clearTimeout(timer);
      setTimeout(resolve, 0); // let the editor's own selectionchange handler run first
    };
    const timer = setTimeout(done, 100);
    doc.addEventListener("selectionchange", done);
  });
}

/**
 * Waits for the editor to reflect the insertion (some editors render asynchronously).
 * Success = the new text is present and the editor content actually changed
 * (or the replacement is identical to what was selected).
 */
async function waitForText(
  host: HTMLElement,
  before: string,
  text: string,
  unchanged: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const want = letters(text);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = host.textContent ?? "";
    if (letters(now).includes(want) && (now !== before || unchanged)) return true;
    if (Date.now() >= deadline) return false;
    await nextFrame();
  }
}

function selectionAt(host: HTMLElement, start: number, end: number): boolean {
  const sel = selectionFor(host, host.ownerDocument);
  if (!sel || sel.rangeCount === 0) return false;
  const r = sel.getRangeAt(0);
  if (!host.contains(r.startContainer) || !host.contains(r.endContainer)) return false;
  return textOffset(host, r.startContainer, r.startOffset) === start && textOffset(host, r.endContainer, r.endOffset) === end;
}

/**
 * Selects the range and waits until the editor has accepted it. Editors such as ProseMirror
 * briefly re-impose their own selection right after a transaction, so retry a few times.
 */
async function selectAndSettle(host: HTMLElement, range: Range, start: number, end: number): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const live = rangeFromOffsets(host, start, end) ?? range;
    const synced = selectionSynced(host.ownerDocument);
    if (!selectRange(host, live)) return false;
    await synced;
    if (selectionAt(host, start, end)) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

function caretOffset(host: HTMLElement): number | null {
  const sel = selectionFor(host, host.ownerDocument);
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!host.contains(r.endContainer)) return null;
  return textOffset(host, r.endContainer, r.endOffset);
}

/**
 * Replaces `range` inside a contenteditable host with plain text.
 *
 * Strategy order (each verified before moving on, never applied twice):
 *  1. Synthetic paste event — rich editors (ProseMirror/Tiptap, Lexical, Quill, Slate, Draft)
 *     handle it through their own model, keeping paragraphs and their undo history.
 *  2. execCommand("insertText") — native editing for plain contenteditable; joins native undo.
 *  3. Direct DOM edit + input event — last resort for editors that support neither.
 */
export async function replaceInEditable(host: HTMLElement, range: Range, text: string): Promise<{ endOffset: number } | null> {
  const doc = host.ownerDocument;
  const before = host.textContent ?? "";
  const unchanged = range.toString() === text;
  const startOffset = textOffset(host, range.startContainer, range.startOffset);
  const endOf = () => caretOffset(host) ?? startOffset + text.length;

  // 1. Paste — only once the editor's selection is provably ours.
  const expectedEnd = startOffset + range.toString().length;
  if (!(await selectAndSettle(host, range, startOffset, expectedEnd))) return null;
  const target = rangeFromOffsets(host, startOffset, expectedEnd) ?? range;
  const pasteTarget = target.startContainer.parentElement ?? host;
  let handled = false;
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true, composed: true });
    pasteTarget.dispatchEvent(event);
    handled = event.defaultPrevented;
  } catch {
    handled = false;
  }
  if (handled) {
    // The editor took ownership. Do not fall back (that could insert twice); just verify.
    return (await waitForText(host, before, text, unchanged, 1000)) ? { endOffset: endOf() } : null;
  }

  // 2. execCommand — an unhandled synthetic paste has no default action, so the selection is intact.
  let viaCommand = false;
  try {
    viaCommand = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text);
  } catch {
    viaCommand = false;
  }
  if (viaCommand) {
    return (await waitForText(host, before, text, unchanged, 500)) ? { endOffset: endOf() } : null;
  }

  // 3. Manual DOM edit (plain contenteditable without execCommand support)
  target.deleteContents();
  const frag = doc.createDocumentFragment();
  text.split("\n").forEach((line, i) => {
    if (i > 0) frag.appendChild(doc.createElement("br"));
    if (line) frag.appendChild(doc.createTextNode(line));
  });
  const last = frag.lastChild;
  target.insertNode(frag);
  if (last) {
    const caret = doc.createRange();
    caret.setStartAfter(last);
    caret.collapse(true);
    selectRange(host, caret);
  }
  host.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  return { endOffset: endOf() };
}

// ---------------------------------------------------------------------------
// Undo

export type UndoFailure = "field_changed";

/** Restores the original selection text if the inserted prompt is still exactly where we put it. */
export async function undoReplacement(undo: UndoInfo): Promise<{ ok: true } | { ok: false; reason: UndoFailure }> {
  if (undo.kind === "text-control") {
    const { el, start, inserted, original } = undo;
    if (!el.isConnected || el.value.slice(start, start + inserted.length) !== inserted) {
      return { ok: false, reason: "field_changed" };
    }
    replaceInTextControl(el, start, start + inserted.length, original);
    return { ok: true };
  }

  const { host, startOffset, endOffset, inserted, original } = undo;
  if (!host.isConnected) return { ok: false, reason: "field_changed" };
  const range = rangeFromOffsets(host, startOffset, endOffset);
  if (!range || letters(range.toString()) !== letters(inserted)) return { ok: false, reason: "field_changed" };
  const done = await replaceInEditable(host, range, original);
  return done ? { ok: true } : { ok: false, reason: "field_changed" };
}
