import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BADGE_TEXT, describeInjectionError, failureTitle } from "../src/feedback.js";
import { claimRegistration, extensionContextAlive, REGISTRATION_KEY, resetRegistrationInPage } from "../src/registration.js";

/** Simulates one injected copy of the content script: counts listeners it registers/removes. */
function fakeScript(listeners: Set<string>, name: string) {
  return () => {
    listeners.add(name);
    return () => listeners.delete(name);
  };
}

describe("content script registration guard", () => {
  it("registers once per build while the context is alive (no double handling)", () => {
    const win = {};
    const listeners = new Set<string>();
    assert.equal(
      claimRegistration(win, "b1", () => true, fakeScript(listeners, "first")),
      true,
    );
    assert.equal(
      claimRegistration(win, "b1", () => true, fakeScript(listeners, "second")),
      false,
    );
    assert.deepEqual([...listeners], ["first"]);
  });

  it("takes over from a registration whose extension context was invalidated", () => {
    const win = {};
    const listeners = new Set<string>();
    let oldAlive = true;
    claimRegistration(win, "b1", () => oldAlive, fakeScript(listeners, "old"));
    oldAlive = false; // extension reloaded: chrome.runtime.id is gone in the old script
    assert.equal(
      claimRegistration(win, "b1", () => true, fakeScript(listeners, "new")),
      true,
    );
    assert.deepEqual([...listeners], ["new"]);
  });

  it("takes over from another build even if it claims to be alive", () => {
    const win = {};
    const listeners = new Set<string>();
    claimRegistration(win, "old-build", () => true, fakeScript(listeners, "old"));
    assert.equal(
      claimRegistration(win, "new-build", () => true, fakeScript(listeners, "new")),
      true,
    );
    assert.deepEqual([...listeners], ["new"]);
  });

  it("survives a throwing liveness probe or dispose, and ignores legacy flags", () => {
    const win: Record<string, unknown> = { __promptRefinerLoaded: true };
    win[REGISTRATION_KEY] = {
      build: "b1",
      alive: () => {
        throw new Error("Extension context invalidated.");
      },
      dispose: () => {
        throw new Error("Extension context invalidated.");
      },
    };
    const listeners = new Set<string>();
    assert.equal(
      claimRegistration(win, "b1", () => true, fakeScript(listeners, "new")),
      true,
    );
    assert.deepEqual([...listeners], ["new"]);
    // Garbage in the slot is replaced, not trusted.
    const other: Record<string, unknown> = { [REGISTRATION_KEY]: true };
    assert.equal(
      claimRegistration(other, "b1", () => true, fakeScript(listeners, "x")),
      true,
    );
  });

  it("resetRegistrationInPage disposes the listener so the next injection registers again", () => {
    const g = globalThis as Record<string, unknown>;
    const previousWindow = g.window;
    const win: Record<string, unknown> = {};
    g.window = win;
    try {
      const listeners = new Set<string>();
      claimRegistration(win, "b1", () => true, fakeScript(listeners, "stale"));
      resetRegistrationInPage(REGISTRATION_KEY);
      assert.equal(win[REGISTRATION_KEY], undefined);
      assert.deepEqual([...listeners], []);
      assert.equal(
        claimRegistration(win, "b1", () => true, fakeScript(listeners, "fresh")),
        true,
      );
      assert.deepEqual([...listeners], ["fresh"]);
      resetRegistrationInPage(REGISTRATION_KEY); // no-op twice
      resetRegistrationInPage(REGISTRATION_KEY);
    } finally {
      g.window = previousWindow;
    }
  });

  it("extensionContextAlive reflects chrome.runtime.id", () => {
    const g = globalThis as Record<string, unknown>;
    const previous = g.chrome;
    try {
      delete g.chrome;
      assert.equal(extensionContextAlive(), false);
      g.chrome = { runtime: { id: "abc" } };
      assert.equal(extensionContextAlive(), true);
      g.chrome = { runtime: {} }; // orphaned content script
      assert.equal(extensionContextAlive(), false);
      g.chrome = {};
      assert.equal(extensionContextAlive(), false);
    } finally {
      g.chrome = previous;
    }
  });
});

describe("failure feedback (badge tooltip)", () => {
  it("explains injection failures in pt-BR without echoing URLs", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["Cannot access a chrome:// URL", 0, /páginas internas do navegador/],
      [
        'Cannot access contents of url "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html". Extension manifest must request permission to access this host.',
        0,
        /visualizador de PDF/,
      ],
      ["The extensions gallery cannot be scripted.", 0, /Chrome Web Store/],
      [
        'Cannot access contents of url "file:///Users/x/a.html". Extension manifest must request permission to access this host.',
        0,
        /URLs de arquivos/,
      ],
      ["No frame with id 42 in tab 7.", 42, /mudou ou foi fechada/],
      ["No tab with id: 7.", 0, /mudou ou foi fechada/],
      [
        'Cannot access contents of url "https://editor.example/". Extension manifest must request permission to access this host.',
        3,
        /iframe/,
      ],
      [
        "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
        0,
        /não tem acesso a esta página/,
      ],
    ];
    for (const [message, frameId, expected] of cases) {
      const reason = describeInjectionError(message, frameId);
      assert.match(reason, expected, message);
      assert.doesNotMatch(reason, /https?:|file:\/\/\/|example/, "no URLs in the tooltip");
    }
  });

  it("builds tooltips for every failure kind", () => {
    assert.equal(BADGE_TEXT, "!");
    assert.match(failureTitle("inaccessible", "o motivo."), /^Prompt Refiner — não funciona nesta página: o motivo\.$/);
    assert.match(failureTitle("no_response"), /Recarregue a página/);
    assert.match(failureTitle("no_response"), /chrome:\/\/extensions/, "points to reloading the extension too");
    assert.match(failureTitle("not_delivered"), /não pôde ser inserido/);
    assert.match(
      failureTitle("failed", "Backend indisponível em http://localhost:8787."),
      /não foi possível refinar o prompt\. Backend indisponível/,
    );
    assert.equal(failureTitle("failed"), "Prompt Refiner — não foi possível refinar o prompt.");
  });
});
