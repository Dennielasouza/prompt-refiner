/**
 * Minimal browser globals for unit-testing the DOM logic with jsdom.
 * jsdom lacks execCommand, DataTransfer and ClipboardEvent: we add small stand-ins so each
 * replacement strategy (rich-editor paste, native insertText, manual fallback) can be exercised.
 */
import { JSDOM } from "jsdom";

export function setupDom(html = "<!doctype html><body></body>") {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const w = dom.window as unknown as Window & typeof globalThis;

  class DataTransferShim {
    #data = new Map<string, string>();
    setData(type: string, value: string) {
      this.#data.set(type, value);
    }
    getData(type: string) {
      return this.#data.get(type) ?? "";
    }
  }
  class ClipboardEventShim extends w.Event {
    clipboardData: DataTransferShim | null;
    constructor(type: string, init: EventInit & { clipboardData?: DataTransferShim } = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData ?? null;
    }
  }
  Object.assign(w, { DataTransfer: DataTransferShim, ClipboardEvent: ClipboardEventShim });

  for (const key of [
    "window",
    "document",
    "Node",
    "NodeFilter",
    "Event",
    "InputEvent",
    "DataTransfer",
    "ClipboardEvent",
    "HTMLElement",
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = key === "window" ? w : (w as unknown as Record<string, unknown>)[key];
  }
  return { dom, window: w, document: w.document };
}

/** Emulates Chrome's execCommand("insertText") for text controls and plain contenteditable. */
export function installExecCommand(doc: Document) {
  const calls: string[] = [];
  (doc as Document & { execCommand: unknown }).execCommand = (cmd: string, _ui: boolean, value: string) => {
    if (cmd !== "insertText") return false;
    calls.push(value);
    const el = doc.activeElement as HTMLTextAreaElement | null;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
      el.setRangeText(value, el.selectionStart!, el.selectionEnd!, "end");
      el.dispatchEvent(new doc.defaultView!.InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return true;
    }
    const sel = doc.getSelection()!;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = doc.createTextNode(value);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  };
  return calls;
}

export function select(doc: Document, node: Node, start: number, endNode: Node = node, end = start) {
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(endNode, end);
  const sel = doc.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}
