/**
 * Small non-blocking toast rendered in a closed shadow root (isolated from page CSS).
 * All text goes through textContent — LLM output and error messages are never parsed as HTML.
 */

export type ToastKind = "loading" | "success" | "error" | "info";

export interface ToastOptions {
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  /** ms; 0 keeps it until replaced. Defaults depend on kind. */
  duration?: number;
}

const HOST_ID = "prompt-refiner-toast-host";
const DEFAULT_DURATION: Record<ToastKind, number> = { loading: 0, success: 8000, error: 8000, info: 3500 };

const STYLE = `
:host { all: initial; }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 2147483647; display: flex; align-items: center; gap: 10px;
  max-width: min(520px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 10px 12px 10px 14px; border-radius: 10px;
  font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #f4f4f5; background: #18181b; box-shadow: 0 6px 24px rgba(0,0,0,.28);
  animation: in .16s ease-out;
}
.icon { flex: none; width: 16px; height: 16px; display: grid; place-items: center; font-size: 13px; }
.text { min-width: 0; }
.detail { display: block; font-weight: 400; color: #a1a1aa; margin-top: 2px; }
.success .icon { color: #4ade80; } .error .icon { color: #f87171; } .info .icon { color: #93c5fd; }
.spinner { width: 14px; height: 14px; border: 2px solid #52525b; border-top-color: #e4e4e7; border-radius: 50%; animation: spin .8s linear infinite; }
button {
  all: unset; flex: none; cursor: pointer; padding: 4px 8px; border-radius: 6px;
  font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #c4b5fd;
}
button:hover { background: #27272a; } button:focus-visible { outline: 2px solid #c4b5fd; }
.close { color: #a1a1aa; padding: 4px 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes in { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-color-scheme: light) {
  .toast { color: #18181b; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.16), 0 0 0 1px rgba(0,0,0,.06); }
  .detail { color: #52525b; } button { color: #6d28d9; } button:hover { background: #f4f4f5; }
  .spinner { border-color: #d4d4d8; border-top-color: #3f3f46; } .success .icon { color: #16a34a; } .error .icon { color: #dc2626; } .info .icon { color: #2563eb; }
}
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } .spinner { animation-duration: 2s; } }
`;

let shadow: ShadowRoot | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function root(): ShadowRoot {
  const existing = document.getElementById(HOST_ID);
  if (shadow && existing?.isConnected) return shadow;
  existing?.remove();
  const host = document.createElement("div");
  host.id = HOST_ID;
  // Closed in production; open only in the e2e test build so assertions can read it.
  shadow = host.attachShadow({ mode: __E2E__ ? "open" : "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return shadow;
}

/** Buttons must not steal focus from the editor (keeps the user's caret where it is). */
function button(label: string, onClick: () => void, className?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

export function hideToast(): void {
  clearTimeout(timer);
  shadow?.querySelector(".toast")?.remove();
}

export function showToast(opts: ToastOptions): void {
  const r = root();
  hideToast();

  const toast = document.createElement("div");
  toast.className = `toast ${opts.kind}`;
  toast.setAttribute("role", opts.kind === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", opts.kind === "error" ? "assertive" : "polite");

  const icon = document.createElement("span");
  icon.className = "icon";
  if (opts.kind === "loading") icon.appendChild(Object.assign(document.createElement("span"), { className: "spinner" }));
  else icon.textContent = opts.kind === "success" ? "✓" : opts.kind === "error" ? "!" : "i";

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = opts.message;
  if (opts.detail) {
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = opts.detail;
    text.appendChild(detail);
  }

  toast.append(icon, text);
  if (opts.action) {
    const { label, onClick } = opts.action;
    toast.appendChild(button(label, onClick));
  }
  if (opts.kind !== "loading") toast.appendChild(button("✕", hideToast, "close"));
  r.appendChild(toast);

  const duration = opts.duration ?? DEFAULT_DURATION[opts.kind];
  if (duration > 0) timer = setTimeout(hideToast, duration);
}
