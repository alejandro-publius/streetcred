// Every stat band cell links to the surface that proves its number. The
// audited card pointed at "/" for a while, which is the page the band is on:
// a link that proves a claim by reloading it.

import test from "node:test";
import assert from "node:assert/strict";
import { STATBAND } from "../src/page.js";

const hrefOf = (html, label) => {
  const m = [...html.matchAll(/<a class="sbcell" href="([^"]+)">.*?<span class="sblabel">([^<]+)<\/span>/gs)]
    .find((x) => x[2] === label);
  return m ? m[1] : null;
};

test("each cell links to its proving surface, and none links to the homepage", () => {
  const html = STATBAND({ scored: 7355, audited: 23, headlines: 100, spendUsd: 12.3 });
  assert.equal(hrefOf(html, "intersections graded"), "/methodology");
  assert.equal(hrefOf(html, "fully audited"), "/audited");
  assert.equal(hrefOf(html, "press citations found"), "/watchlist");
  assert.equal(hrefOf(html, "spent running itself"), "/status");
  assert.ok(!/href="\/"/.test(html), "no cell may link to the page the band is on");
});
