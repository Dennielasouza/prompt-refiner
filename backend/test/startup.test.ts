import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startupErrorMessage } from "../src/startup.js";

const withCode = (code: string) => Object.assign(new Error(`listen ${code} 127.0.0.1:8787`), { code });

describe("startupErrorMessage", () => {
  it("explains EADDRINUSE: names the port, PORT and the extension endpoint", () => {
    const msg = startupErrorMessage(withCode("EADDRINUSE"), 8787);
    assert.match(msg, /8787/);
    assert.match(msg, /PORT/);
    assert.match(msg, /Endpoint da API/);
    assert.doesNotMatch(msg, /\bat \w/);
  });

  it("explains EACCES for a privileged port", () => {
    const msg = startupErrorMessage(withCode("EACCES"), 80);
    assert.match(msg, /80/);
    assert.match(msg, /permissão/);
  });

  it("still produces a message with the code for unknown errors", () => {
    assert.match(startupErrorMessage(withCode("EWEIRD"), 8787), /EWEIRD/);
    assert.match(startupErrorMessage("boom", 8787), /desconhecido/);
  });

  // Under `npm run dev` the tsx watcher outlives the server, so the terminal does not come back:
  // without this line a first-time user cannot tell a failure from a successful start.
  it("tells the watcher's user how to get the terminal back, and only them", () => {
    for (const err of [withCode("EADDRINUSE"), withCode("EACCES"), withCode("EWEIRD"), "boom"]) {
      assert.match(startupErrorMessage(err, 8787, { watching: true }), /Ctrl\+C/, String(err));
      assert.doesNotMatch(startupErrorMessage(err, 8787), /Ctrl\+C/, String(err));
    }
  });
});
