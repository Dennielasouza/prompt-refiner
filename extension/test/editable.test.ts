import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { installExecCommand, select, setupDom } from "./dom-env.js";

let doc: Document;
let mod: typeof import("../src/dom/editable.js");

beforeEach(async () => {
  doc = setupDom().document;
  mod ??= await import("../src/dom/editable.js");
});

function textarea(value: string, start: number, end: number, tag: "textarea" | "input" = "textarea") {
  const el = doc.createElement(tag) as HTMLTextAreaElement;
  doc.body.appendChild(el);
  el.value = value;
  el.focus();
  el.setSelectionRange(start, end);
  return el;
}

function captureOk() {
  const r = mod.captureSelection(doc);
  assert.ok(r.ok, `capture failed: ${!r.ok && r.reason}`);
  return r.capture;
}

describe("textarea / input", () => {
  it("replaces only a partial selection and keeps text before and after", async () => {
    const el = textarea("Oi. corrige isso aqui. Tchau.", 4, 22);
    const inputs: string[] = [];
    el.addEventListener("input", (e) => inputs.push((e as InputEvent).inputType));
    const cap = captureOk();
    assert.equal(cap.selectedText, "corrige isso aqui.");
    const res = await mod.applyReplacement(cap, "Corrija o texto a seguir.");
    assert.ok(res.ok);
    assert.equal(el.value, "Oi. Corrija o texto a seguir. Tchau.");
    assert.equal(el.selectionStart, 4 + "Corrija o texto a seguir.".length);
    assert.equal(el.selectionEnd, el.selectionStart);
    assert.equal(inputs.length, 1, "framework-visible input event fired");
  });

  it("replaces the full content", async () => {
    const el = textarea("texto inteiro", 0, 13);
    assert.ok((await mod.applyReplacement(captureOk(), "Novo texto")).ok);
    assert.equal(el.value, "Novo texto");
  });

  it("uses native insertText when available (undo stack, React)", async () => {
    const calls = installExecCommand(doc);
    const el = textarea("a b c", 2, 3);
    assert.ok((await mod.applyReplacement(captureOk(), "B")).ok);
    assert.deepEqual(calls, ["B"]);
    assert.equal(el.value, "a B c");
  });

  it("reports no selection", () => {
    textarea("abc", 1, 1);
    assert.deepEqual(mod.captureSelection(doc), { ok: false, reason: "no_selection" });
    textarea("a   b", 1, 4);
    assert.deepEqual(mod.captureSelection(doc), { ok: false, reason: "no_selection" }, "whitespace only");
  });

  it("refuses password fields and unsupported input types", () => {
    const pw = textarea("segredo", 0, 7, "input") as unknown as HTMLInputElement;
    pw.type = "password";
    pw.focus();
    assert.deepEqual(mod.captureSelection(doc), { ok: false, reason: "password" });
    const email = doc.createElement("input");
    email.type = "email";
    doc.body.appendChild(email);
    email.focus();
    assert.deepEqual(mod.captureSelection(doc), { ok: false, reason: "unsupported" });
  });

  it("flattens line breaks for <input>", async () => {
    const el = textarea("x faz y", 2, 5, "input");
    assert.ok((await mod.applyReplacement(captureOk(), "Linha 1\n\nLinha 2")).ok);
    assert.equal(el.value, "x Linha 1 Linha 2 y");
  });

  it("relocates the selection when text was typed before it during the request", async () => {
    const el = textarea("abc ALVO def", 4, 8);
    const cap = captureOk();
    el.value = `novo ${el.value}`; // user typed while waiting
    assert.ok((await mod.applyReplacement(cap, "X")).ok);
    assert.equal(el.value, "novo abc X def");
  });

  it("does not modify anything when the selected text is gone or ambiguous", async () => {
    const el = textarea("abc ALVO def", 4, 8);
    const cap = captureOk();
    el.value = "ALVO e ALVO";
    assert.deepEqual(await mod.applyReplacement(cap, "X"), { ok: false, reason: "selection_changed" });
    assert.equal(el.value, "ALVO e ALVO");
    el.value = "outro";
    assert.deepEqual(await mod.applyReplacement(cap, "X"), { ok: false, reason: "selection_changed" });
    el.remove();
    assert.deepEqual(await mod.applyReplacement(cap, "X"), { ok: false, reason: "field_gone" });
  });

  it("undoes the replacement, unless the field was edited since", async () => {
    const el = textarea("antes MEIO depois", 6, 10);
    const res = await mod.applyReplacement(captureOk(), "Prompt refinado");
    assert.ok(res.ok);
    assert.deepEqual(await mod.undoReplacement(res.undo), { ok: true });
    assert.equal(el.value, "antes MEIO depois");

    el.setSelectionRange(6, 10);
    const again = await mod.applyReplacement(captureOk(), "Prompt refinado");
    assert.ok(again.ok);
    el.value = el.value.replace("refinado", "editado");
    assert.deepEqual(await mod.undoReplacement(again.undo), { ok: false, reason: "field_changed" });
    assert.equal(el.value, "antes Prompt editado depois");
  });
});

describe("contenteditable", () => {
  function editor(html: string) {
    const host = doc.createElement("div");
    host.setAttribute("contenteditable", "true");
    host.innerHTML = html;
    doc.body.appendChild(host);
    host.focus();
    return host;
  }

  it("replaces a partial selection inside a paragraph (manual fallback)", async () => {
    const host = editor("<p>Contexto: faz um resumo disso. Fim.</p><p>Outro parágrafo</p>");
    const t = host.querySelector("p")!.firstChild!;
    select(doc, t, 10, t, 30);
    const cap = captureOk();
    assert.equal(cap.selectedText, "faz um resumo disso.");
    const res = await mod.applyReplacement(cap, "Resuma o texto abaixo.");
    assert.ok(res.ok);
    assert.equal(host.innerHTML, "<p>Contexto: Resuma o texto abaixo. Fim.</p><p>Outro parágrafo</p>");
    // caret right after the inserted text
    const sel = doc.getSelection()!;
    assert.ok(sel.isCollapsed);
    assert.equal(mod.textOffset(host, sel.anchorNode!, sel.anchorOffset), "Contexto: Resuma o texto abaixo.".length);
  });

  it("uses native insertText for plain contenteditable when available", async () => {
    const calls = installExecCommand(doc);
    const host = editor("<p>um dois tres</p>");
    const t = host.querySelector("p")!.firstChild!;
    select(doc, t, 3, t, 7);
    assert.ok((await mod.applyReplacement(captureOk(), "DOIS")).ok);
    assert.deepEqual(calls, ["DOIS"]);
    assert.equal(host.textContent, "um DOIS tres");
  });

  it("prefers the editor's paste handler (rich editors) and never inserts twice", async () => {
    const calls = installExecCommand(doc);
    const host = editor("<p>antes alvo depois</p>");
    let pasted = "";
    host.addEventListener("paste", (e) => {
      e.preventDefault();
      pasted = (e as ClipboardEvent).clipboardData!.getData("text/plain");
      const r = doc.getSelection()!.getRangeAt(0);
      r.deleteContents();
      r.insertNode(doc.createTextNode(pasted.replace(/\n+/g, " ")));
    });
    const t = host.querySelector("p")!.firstChild!;
    select(doc, t, 6, t, 10);
    const res = await mod.applyReplacement(captureOk(), "Linha A\n\nLinha B");
    assert.ok(res.ok);
    assert.equal(pasted, "Linha A\n\nLinha B");
    assert.deepEqual(calls, [], "no fallback after the editor handled paste");
    assert.equal(host.textContent, "antes Linha A Linha B depois");
  });

  it("reports failure without fallback when the editor swallows the paste", async () => {
    installExecCommand(doc);
    const host = editor("<p>antes alvo depois</p>");
    host.addEventListener("paste", (e) => e.preventDefault());
    const t = host.querySelector("p")!.firstChild!;
    select(doc, t, 6, t, 10);
    const res = await mod.applyReplacement(captureOk(), "novo");
    assert.deepEqual(res, { ok: false, reason: "editor_rejected" });
    assert.equal(host.textContent, "antes alvo depois");
  });

  it("replaces a selection spanning paragraphs and the full content", async () => {
    const host = editor("<p>primeiro</p><p>segundo</p><p>terceiro</p>");
    const [p1, p2] = host.querySelectorAll("p");
    select(doc, p1.firstChild!, 3, p2.firstChild!, 3);
    assert.ok((await mod.applyReplacement(captureOk(), "X")).ok);
    assert.equal(host.textContent, "priXundoterceiro");

    const all = editor("<p>tudo</p>");
    select(doc, all.querySelector("p")!.firstChild!, 0, all.querySelector("p")!.firstChild!, 4);
    assert.ok((await mod.applyReplacement(captureOk(), "Tudo novo")).ok);
    assert.equal(all.textContent, "Tudo novo");
  });

  it("finds the selection again after the editor re-rendered the node", async () => {
    const host = editor("<p>abc alvo def</p>");
    const p = host.querySelector("p")!;
    select(doc, p.firstChild!, 4, p.firstChild!, 8);
    const cap = captureOk();
    p.innerHTML = "abc <b>alvo</b> def"; // live range collapses; offsets still valid
    assert.ok((await mod.applyReplacement(cap, "ALVO")).ok);
    assert.equal(host.textContent, "abc ALVO def");
  });

  it("does nothing if the selected text changed", async () => {
    const host = editor("<p>abc alvo def</p>");
    const p = host.querySelector("p")!;
    select(doc, p.firstChild!, 4, p.firstChild!, 8);
    const cap = captureOk();
    p.textContent = "texto totalmente diferente";
    assert.deepEqual(await mod.applyReplacement(cap, "X"), { ok: false, reason: "selection_changed" });
    assert.equal(host.textContent, "texto totalmente diferente");
  });

  it("reports no selection and ignores selections outside editors", () => {
    const host = editor("<p>abc</p>");
    select(doc, host.querySelector("p")!.firstChild!, 1);
    assert.deepEqual(mod.captureSelection(doc), { ok: false, reason: "no_selection" });
    const plain = doc.createElement("p");
    plain.textContent = "texto da página";
    doc.body.appendChild(plain);
    (doc.activeElement as HTMLElement | null)?.blur();
    select(doc, plain.firstChild!, 0, plain.firstChild!, 5);
    assert.deepEqual(mod.captureSelection(doc), { ok: false, reason: "unsupported" });
  });

  it("undoes the replacement", async () => {
    const host = editor("<p>antes alvo depois</p>");
    const t = host.querySelector("p")!.firstChild!;
    select(doc, t, 6, t, 10);
    const res = await mod.applyReplacement(captureOk(), "Prompt longo refinado");
    assert.ok(res.ok);
    assert.equal(host.textContent, "antes Prompt longo refinado depois");
    assert.deepEqual(await mod.undoReplacement(res.undo), { ok: true });
    assert.equal(host.textContent, "antes alvo depois");
  });
});

describe("helpers", () => {
  it("rangeFromOffsets() binds paragraph boundaries inward", () => {
    const host = doc.createElement("div");
    host.innerHTML = "<p>abc</p><p>def</p>";
    doc.body.appendChild(host);
    const [p1, p2] = host.querySelectorAll("p");
    const r = mod.rangeFromOffsets(host, 3, 6)!;
    assert.equal(r.startContainer, p2.firstChild, "start at beginning of 2nd paragraph, not end of 1st");
    assert.equal(r.endContainer, p2.firstChild);
    const left = mod.rangeFromOffsets(host, 0, 3)!;
    assert.equal(left.endContainer, p1.firstChild, "end stays in 1st paragraph");
    const caret = mod.rangeFromOffsets(host, 3, 3)!;
    assert.equal(caret.startContainer, p1.firstChild);
    assert.ok(caret.collapsed);
    assert.equal(mod.rangeFromOffsets(host, 2, 9), null);
  });

  it("letters() ignores markup-like characters and digits", () => {
    assert.equal(mod.letters("## Título\n1. Item *um*"), "títuloitemum");
  });
  it("uniqueIndexOf() rejects ambiguous matches", () => {
    assert.equal(mod.uniqueIndexOf("a b a", "a"), -1);
    assert.equal(mod.uniqueIndexOf("a b c", "b"), 2);
    assert.equal(mod.uniqueIndexOf("abc", ""), -1);
  });
});
