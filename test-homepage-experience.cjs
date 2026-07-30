"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);

test("homepage inline scripts parse", () => {
  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index}.js` }));
  });
});

test("homepage opens with Adam's approved TOP language", () => {
  assert.match(html, /<h1 id="hero-title">TOP<\/h1>/);
  assert.match(html, /<p class="hero-expansion">Token Optimization Protocol<\/p>/);
  assert.match(
    html,
    /The AI landscape is <span class="changing-landscape">constantly changing<\/span>, TOP helps You keep two feet on the ground so You and Your Business stay ahead of the curve/,
  );
  assert.match(html, /TOP is being built as a centralized AI integrator, then optimizer for businesses\./);
  assert.match(
    html,
    /If work is transport, AI agents are cars, and TOP is the road system we are building to make traffic visible, and over time help it run better\. We want to give business owners insight into the black box that is artificial intelligence\./,
  );
  assert.match(html, /Forecastable, cheaper and smarter describe the intended route, not outcomes TOP has proved\./);
  assert.doesNotMatch(html, /The AI landscape never stops moving/i);
});

test("personal-site visual tokens and pressable controls remain explicit", () => {
  for (const token of [
    "--ink:#16140f",
    "--muted:#5f594e",
    "--line:#c9c0ad",
    "--paper:#fff9e8",
    "--desk:#ede8d9",
    "--wash:#f6efd9",
    "--signal:#ff6b2b",
    "--lemon:#ffe89a",
    "--blue:#a7d5f5",
    "--professional-blue:#235c88",
    "--green:#b9ddaf",
    "--red:#f2aa98",
  ]) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /\.site-frame\{[\s\S]*?border:1px solid var\(--ink\)[\s\S]*?background:var\(--paper\)[\s\S]*?box-shadow:-8px 8px 0 var\(--ink\)/);
  assert.match(html, /\.press-button\{[\s\S]*?border:2px solid var\(--ink\)[\s\S]*?border-radius:2px[\s\S]*?box-shadow:-5px 5px 0 var\(--ink\)/);
  assert.match(html, /@media\(hover:hover\) and \(pointer:fine\)\{[\s\S]*?\.press-button:hover\{[\s\S]*?box-shadow:-2px 2px 0 var\(--ink\)[\s\S]*?translate\(-3px,3px\)/);
  assert.match(html, /\.press-button:active\{[\s\S]*?box-shadow:none[\s\S]*?translate\(-5px,5px\)/);
  assert.match(
    html,
    /\.section\[tabindex="-1"\]:focus-visible,\s*\.product-card\[tabindex="-1"\]:focus-visible,\s*\.live-tool\[tabindex="-1"\]:focus-visible\{[^}]*outline:3px solid var\(--ink\);[^}]*outline-offset:-?\d+px/,
  );
  assert.doesNotMatch(html, /\[tabindex="-1"\]:focus\{[^}]*outline:none/);
  assert.match(html, /\.live-tool\{[\s\S]*?scroll-margin-top:var\(--anchor-offset\)/);
  assert.doesNotMatch(html, /backdrop-filter|border-radius:999|radial-gradient|mix-blend-mode/i);
});

test("the overhead map is replaced by a live clickable TOP route map", () => {
  assert.doesNotMatch(html, /class="network-figure"|class="map-frame"/);
  assert.match(html, /<aside class="route-rail" id="route-map-panel" aria-label="TOP route map">/);
  assert.match(html, /<nav class="route-map" id="route-map-nav" aria-label="Live page contents">/);
  assert.match(html, /data-route-map-link="business" aria-current="location"/);
  for (const target of [
    "routes", "topos", "optimise", "icarus", "daedalus", "athena",
    "historical-analyzer", "engineering", "partners", "roadmap",
  ]) {
    assert.match(html, new RegExp(`href="#${target}" data-route-map-link="${target}"`));
  }
  assert.match(html, /class="route-car" id="route-car" aria-hidden="true"/);
  assert.match(html, /id="motion-toggle" type="button" aria-pressed="false" aria-label="Pause route-map animation"/);
  assert.match(html, /\.route-node\[aria-current="location"\][\s\S]*?box-shadow:-4px 4px 0 var\(--ink\)/);
  assert.match(html, /\.motion-paused \.route-car\{animation-play-state:paused\}/);
});

test("product direction uses three main columns with stage badges", () => {
  assert.match(html, /<table class="direction-table">/);
  for (const heading of ["Name", "Analogy", "Application"]) {
    assert.match(html, new RegExp(`<th scope="col">${heading}</th>`));
  }
  for (const stage of ["Intranet / OS", "TOP 1", "TOP 2", "TOP 3"]) {
    assert.match(html, new RegExp(`<span class="stage-badge">${stage.replace("/", "\\/")}</span>`));
  }
  assert.match(html, /TopOS[\s\S]*?Roads and infrastructure[\s\S]*?The local infrastructure for your AI integration/);
  assert.match(html, /Icarus[\s\S]*?Taximeter \+ fuel gauge[\s\S]*?Make your AI spend forecastable/);
  assert.match(html, /Daedalus[\s\S]*?More efficient engine[\s\S]*?Help make your AI use cheaper/);
  assert.match(html, /Athena[\s\S]*?Interactive sat-nav[\s\S]*?Help make your AI use smarter/);
});

test("business route selector sends Yes past TopOS and No to the infrastructure", () => {
  const questionAt = html.indexOf("Does your business use AI?");
  const yesAt = html.indexOf('href="#optimise" data-route="yes"');
  const noAt = html.indexOf('href="#topos" data-route="no"');
  const toposAt = html.indexOf('id="topos"');
  const optimiseAt = html.indexOf('id="optimise"');
  assert.ok(questionAt >= 0 && yesAt > questionAt && noAt > yesAt);
  assert.ok(toposAt > noAt && optimiseAt > toposAt,
    "TopOS must appear first in the document so the Yes route visibly skips it");
  assert.match(html, /Yes skips ahead\. No starts with the road infrastructure\./);
});

test("TopOS and the three optimisation layers use the approved transport analogies", () => {
  assert.match(html, /TopOS lays the roads\./);
  assert.match(html, /TopOS is the infrastructure\./);
  assert.match(html, /proposed local-first intranet road system/);
  for (const infrastructure of ["Roads", "Depots", "Junctions", "Control room"]) {
    assert.match(html, new RegExp(`<h3>${infrastructure}</h3>`));
  }
  assert.match(html, /<h3>Icarus<\/h3>[\s\S]*?Taximeter \+ fuel gauge/);
  assert.match(html, /<h3>Daedalus<\/h3>[\s\S]*?More efficient engine/);
  assert.match(html, /<h3>Athena<\/h3>[\s\S]*?Interactive satnav/);
});

test("maturity labels separate working software from the road map", () => {
  assert.match(html, /Icarus, Daedalus and Athena are working codenames\./);
  assert.match(html, /TopOS[\s\S]*?Concept/);
  assert.match(html, /Icarus[\s\S]*?In validation/);
  assert.match(html, /Daedalus[\s\S]*?Planned R&amp;D/);
  assert.match(html, /Athena[\s\S]*?Planned R&amp;D/);
  assert.match(html, /This shows past journeys\. It is not a pre-run forecast\./);
  assert.match(html, /It has not shipped or been benchmarked\./);
  assert.match(html, /TopOS is not yet built, shipped or validated\./);
});

test("the only live product route is the local historical analyzer", () => {
  const analyzerLinks = html.match(/href="\/analyze\/\?pilot=1"/g) || [];
  assert.ok(analyzerLinks.length >= 3, "the live analyzer should be reachable from each relevant audience route");
  assert.doesNotMatch(html, /href="\/analyze\/"/);
  assert.match(
    html,
    /<div(?=[^>]*\bclass="[^"]*\blive-tool\b[^"]*")(?=[^>]*\bid="historical-analyzer")(?=[^>]*\btabindex="-1")[^>]*>/,
  );
  assert.match(html, /file is analysed locally and is not sent to TOP/);
  assert.match(html, /does not require a developer account, a code change or an upload to TOP/);
  const auditClaim = html.match(/<li><strong>Audit<\/strong><span>([^<]+)<\/span><\/li>/);
  assert.ok(auditClaim, "the analyzer should retain a visible API-rate audit explanation");
  assert.match(auditClaim[1], /\bsupported\b/i);
  assert.match(auditClaim[1], /\bequivalent pay-as-you-go API rates\b/i);
  assert.match(auditClaim[1], /\b(?:when|where|only if)\b[^.]*\bexact\b[^.]*\bmodel\b[^.]*\btoken counts?\b/i);
  assert.match(auditClaim[1], /\bchecked rate\b/i);
  assert.doesNotMatch(
    auditClaim[1],
    /^See your past AI usage in equivalent pay-as-you-go API rates\.$/i,
  );
});

test("Google Calendar calls are truthful placeholders until a real schedule exists", () => {
  assert.match(html, /<button class="press-button" type="button" disabled>Book a TopOS call in Google Calendar<\/button>/);
  assert.match(html, /<button class="press-button" type="button" disabled>Book an Icarus pilot implementation call in Google Calendar<\/button>/);
  assert.match(html, /once the booking schedule is ready/i);
  assert.doesNotMatch(html, /cal\.com|cal\.eu|fresha|calendar\.google\.com/i);
});

test("audience navigation remains functional on desktop and mobile", () => {
  assert.match(html, /<main class="layout" id="main-content">/);
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /aria-label="Audience index"/);
  assert.match(html, /href="#business" data-audience-link="business" aria-current="page">Business operators<\/a>/);
  assert.match(html, /href="#engineering" data-audience-link="engineering">AI &amp; Engineering<\/a>/);
  assert.match(html, /href="#partners" data-audience-link="partners">Investors &amp; Partners<\/a>/);
  assert.match(html, /@media\(max-width:1120px\)\{[\s\S]*?\.audience-rail\{[\s\S]*?position:sticky/);
  assert.match(html, /@media\(max-width:1120px\)\{[\s\S]*?\.main-nav\{[\s\S]*?grid-column:1\/-1/);
  assert.match(html, /class="audience-scroll-cue" aria-hidden="true">More &rarr;<\/span>/);
  assert.match(html, /@media\(max-width:800px\)\{[\s\S]*?\.site-frame\{width:100%;margin:0;border:0;box-shadow:none\}/);
  assert.match(html, /\.signal-list li\{[\s\S]*?grid-template-columns:78px minmax\(0,1fr\)/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(html, /@media\(max-width:[^)]+\)\{[^}]*\.audience-rail\{[^}]*display:none/);
});

test("route choice, tactile panels and audience copy match the approved design", () => {
  assert.match(html, /class="press-button yes" href="#optimise" data-route="yes">Yes<\/a>/);
  assert.match(html, /class="press-button no" href="#topos" data-route="no">No<\/a>/);
  assert.match(html, /\.route-buttons \.yes\{background:var\(--green\)\}/);
  assert.match(html, /\.route-buttons \.no\{background:var\(--red\)\}/);
  assert.match(html, /<h2 id="optimise-title">Measure the journey, <em>then<\/em> improve the traffic\.<\/h2>/);
  assert.match(html, /class="infrastructure-item tactile-panel"/);
  assert.match(html, /class="product-card tactile-panel"/);
  assert.doesNotMatch(html, /class="(?:infrastructure-item|product-card)[^"]*"[^>]+role="button"/);
  assert.match(html, /See the rules of the road\./);
  assert.match(html, /The wider system is explained above\./);
  assert.match(html, /<strong>Private<\/strong><span>Your selected history file stays on your machine and is not sent to TOP\.<\/span>/);
  assert.match(
    html,
    /<strong>Audit<\/strong><span>[^<]*\bsupported\b[^<]*\bequivalent pay-as-you-go API rates\b[^<]*\bexact\b[^<]*\bmodel\b[^<]*\btoken counts?\b[^<]*\bchecked rate\b[^<]*<\/span>/i,
  );
  assert.match(html, /We are early, and we are ambitious\./);
  assert.match(html, /The wider system lacks substantial commercial application\. But the plan is in place\./);
  assert.match(html, /We will not present roadworks as an open motorway\./);
  assert.match(html, /class="press-button professional"[^>]*>Talk to the founders<\/a>/);
});

test("compact value graph is interactive, accessible and explicitly illustrative", () => {
  assert.match(html, /<figure class="value-model tactile-panel" aria-labelledby="value-model-title">/);
  assert.match(html, /<title id="vm-chart-title">Illustrative AI cost and output value paths<\/title>/);
  assert.match(html, /<desc id="vm-chart-desc">[\s\S]*?This is not a customer result\.<\/desc>/);
  assert.match(html, /id="vm-scenario" type="range"[^>]+aria-describedby="vm-caption"/);
  assert.match(html, /These are made-up paths, not a customer result\./);
  assert.match(html, /Daedalus has not shipped or been benchmarked\./);
  assert.match(html, /TOP has not proved a saving or measured output value\./);
  for (const fn of ["vmScenarioAmount", "vmCostSlope", "vmValueSlope", "vmCostAt", "vmValueAt"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
});

test("future pages are labelled as a road map, not linked as though they exist", () => {
  for (const planned of [
    "About TOP",
    "FAQ + Help",
    "Contact",
    "Privacy + Security",
    "Team + Vision",
    "TOP desktop download",
  ]) {
    assert.match(html, new RegExp(planned.replace("+", "\\+")));
  }
  assert.doesNotMatch(html, /href="\/(?:about|faq|help|contact|privacy|security|download)(?:\/|")/i);
});

test("homepage has no third-party runtime or tracking", () => {
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+(?:stylesheet|preconnect)[^>]+https?:/i);
  assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|goatcounter/i);
});
