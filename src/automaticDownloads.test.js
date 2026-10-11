import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleTorrents } from "./automaticDownloads.js";

test("seuil strict et exclusions des téléchargements et tentatives précédentes", () => {
  const rows = [{ id: "a", score: 2001 }, { id: "b", score: 2000 }, { id: "c", score: 3000 }, { id: "d", score: 4000 }];
  assert.deepEqual(eligibleTorrents(rows, "2000", { c: true }, { d: true }), [rows[0]]);
});
test("seuil invalide ou absent : aucun déclenchement", () => {
  for (const threshold of ["", "abc", -1, Infinity]) assert.deepEqual(eligibleTorrents([{ id: "a", score: 42 }], threshold, {}, {}), []);
});
test("score ou identifiant invalide exclu, guid reconnu", () => {
  const row = { id: "a", guid: "guid-a", score: 10 };
  assert.deepEqual(eligibleTorrents([row, { score: 50 }, { id: "b", score: "invalide" }], 0, {}, {}), [row]);
  assert.deepEqual(eligibleTorrents([row], 0, {}, { "guid-a": true }), []);
});
