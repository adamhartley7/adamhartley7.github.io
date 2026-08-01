"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("how-top-works/index.html", `file://${__dirname}/`), "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);

function openingTagById(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid\\s*=\\s*["']${escaped}["'])[^>]*>`, "i");
  const match = pattern.exec(html);
  assert.ok(match, `missing #${id}`);
  return { index: match.index, tag: match[1], markup: match[0] };
}

function elementMarkupById(id) {
  const opening = openingTagById(id);
  const token = new RegExp(`<\\/?${opening.tag}\\b[^>]*>`, "gi");
  token.lastIndex = opening.index;
  let depth = 0;
  let match;
  while ((match = token.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(opening.index, token.lastIndex);
  }
  throw new Error(`unclosed #${id}`);
}

function visibleText(source) {
  return source
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

test("technical page metadata and inline scripts are valid", () => {
  assert.match(html, /<title>How TOP works \| Token Optimisation Protocol<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/tokenoptimisationprotocol\.org\/how-top-works\/">/);
  assert.match(html, /<meta name="description" content="The proposed TOP system architecture, data boundaries, controls, product layers and current evidence\.">/);
  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source), `inline script ${index + 1} should parse`);
  });
});

test("every technical-page homepage route uses the one-use opening bypass", () => {
  const homepageLinks = [...html.matchAll(/<a\b[^>]*href="(\/?(?:#from-how-top-works)?)"[^>]*>/g)]
    .map((match) => match[1]);
  assert.equal(homepageLinks.length, 3, "header, navigation and footer must all expose a homepage route");
  assert.deepEqual(homepageLinks, Array(3).fill("/#from-how-top-works"));
});

test("one compact glossary is the only transport analogy after the homepage", () => {
  const glossary = elementMarkupById("glossary");
  assert.match(glossary, /<table class="glossary-table">/);
  for (const phrase of ["Roads and depot", "Taximeter and fuel gauge", "Efficient engine", "Interactive satnav"]) {
    assert.match(glossary, new RegExp(phrase));
  }

  const outsideGlossary = html.replace(glossary, "");
  const outsideText = visibleText(outsideGlossary);
  assert.doesNotMatch(outsideText, /roads and depot|taximeter|fuel gauge|efficient engine|interactive satnav|AI agents are cars/i);
  assert.doesNotMatch(html, /Does your business use AI\?|data-route="(?:yes|no)"|value-model|vm-scenario/i);
});

test("technical sections use literal roles and truthful product states", () => {
  const expected = {
    system: "System boundary",
    topos: "TopOS",
    icarus: "Icarus",
    daedalus: "Daedalus",
    athena: "Athena",
    "privacy-security": "Privacy and security",
    "product-status": "Product status",
  };
  for (const id of Object.keys(expected)) {
    assert.match(openingTagById(id).markup, /data-content-section=/,
      `#${id} must participate in the live contents map`);
  }

  assert.match(html, /TopOS is not yet built, shipped or validated\./);
  assert.match(html, /reliable public pre-run forecasting has not been demonstrated/i);
  assert.match(html, /Daedalus has not shipped or been benchmarked\./);
  assert.match(html, /TOP has not demonstrated a general cost or quality improvement from this layer\./);
  assert.match(html, /Athena has not shipped or been benchmarked\./);
  assert.match(html, /Its planning and supervision approach remains a research direction\./);
  assert.doesNotMatch(html, /\b(?:guaranteed|proven) (?:saving|savings|accuracy|improvement)\b/i);
});

test("the live analyser is separated from proposed architecture", () => {
  const icarus = elementMarkupById("icarus");
  assert.match(icarus, /The historical analyser is live/);
  assert.match(icarus, /process(?:es|ed) selected supported AI history locally in the browser/i);
  assert.match(icarus, /chosen file is not sent to TOP/i);
  assert.match(icarus, /historical analysis, not a pre-run Icarus forecast/i);
  assert.match(icarus, /href="\/analyze\/\?pilot=1">Analyse past usage<\/a>/);

  const privacy = elementMarkupById("privacy-security");
  assert.match(privacy, /Verified on the live analyser/);
  assert.match(privacy, /Required of the proposed system/);
  assert.match(privacy, /Threat modelling and independent security review before strong claims/);
});

test("the audience and contents rails are explicit and every map link resolves", () => {
  assert.match(html, /<aside class="audience-rail" aria-label="Audience index">/);
  assert.match(html, /<aside class="contents-rail" aria-label="Technical contents map">/);
  const audienceAt = html.indexOf('<aside class="audience-rail"');
  const contentsAt = html.indexOf('<aside class="contents-rail"');
  const contentAt = html.indexOf('<article class="technical-content"');
  assert.ok(audienceAt < contentsAt && contentsAt < contentAt,
    "DOM focus order must match the mobile audience, contents, article order");
  assert.match(html, /<article class="technical-content" id="technical-content" tabindex="-1">/);
  assert.match(html, /\.technical-content\[tabindex="-1"\]:focus-visible\{[^}]*outline:3px solid var\(--ink\)/);
  assert.match(html, /<strong>You are<\/strong>/);
  assert.match(html, /<strong>Contents map<\/strong>/);

  const mapTargets = [...html.matchAll(/data-content-link="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(mapTargets, [
    "glossary", "system", "topos", "icarus", "daedalus", "athena",
    "privacy-security", "product-status", "work-with-top",
  ]);
  mapTargets.forEach((id) => openingTagById(id));
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /aria-current','location'/);
  assert.doesNotMatch(inlineScripts[0], /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
});

test("technical-page analytics distinguish reloads without sending ntfy alerts", () => {
  const external = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  assert.equal(external.length, 1);
  assert.equal(external[0][1], "https://gc.zgo.at/count.v5.js");
  assert.match(html, /window\.goatcounter\.count\(\{[\s\S]*?path:'\/how-top-works\/'[\s\S]*?no_session:true/);
  assert.doesNotMatch(html, /events\.tokenoptimisationprotocol\.org|initHomepageLoadSignal|window\.fetch\s*\(/i);
  assert.match(html, /counts every load, including reloads, with GoatCounter and uses no visitor cookies or browser storage/i);
  assert.match(html, /It does not send the homepage ntfy alert\./);
});

test("technical layout retains Adam's visual system and responsive rails", () => {
  for (const token of [
    "--ink:#16140f", "--paper:#fff9e8", "--desk:#ede8d9", "--wash:#f6efd9",
    "--signal:#ff6b2b", "--lemon:#ffe89a", "--blue:#a7d5f5",
  ]) assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /\.site-frame\{[\s\S]*?border:1px solid var\(--ink\)[\s\S]*?box-shadow:-8px 8px 0 var\(--ink\)/);
  assert.match(html, /\.technical-layout\{[\s\S]*?grid-template-columns:190px minmax\(0,1fr\) 270px/);
  assert.match(html, /\.technical-layout\{[\s\S]*?align-items:stretch/);
  assert.match(html, /\.audience-rail\{grid-column:1;grid-row:1/);
  assert.match(html, /\.technical-content\{grid-column:2;grid-row:1/);
  assert.match(html, /\.contents-rail\{grid-column:3;grid-row:1/);
  assert.match(html, /@media\(max-width:1120px\)[\s\S]*?\.technical-layout\{grid-template-columns:1fr\}/);
  assert.match(html, /@media\(max-width:1120px\)[\s\S]*?\.contents-rail\{grid-column:1;grid-row:2/);
  assert.match(html, /@media\(max-width:1120px\)[\s\S]*?\.technical-content\{grid-column:1;grid-row:3/);
  assert.match(html, /@media\(max-width:800px\)[\s\S]*?\.site-frame\{width:100%;margin:0;border:0;box-shadow:none\}/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(html, /backdrop-filter|border-radius:999|radial-gradient|mix-blend-mode|\u2014|&mdash;/i);
});
