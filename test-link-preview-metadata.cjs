const assert = require("node:assert/strict");
const fs = require("node:fs");

const home = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const analyzer = fs.readFileSync(new URL("analyze/index.html", `file://${__dirname}/`), "utf8");

// A link preview is built from the head only. Body copy is allowed to describe
// the unshipped next-task estimate; the preview text is not.
function headOf(html, label) {
  const end = html.indexOf("</head>");
  assert.ok(end > 0, `${label} must have a head`);
  return html.slice(0, end);
}

function attr(html, selector) {
  const match = html.match(selector);
  return match ? match[1] : null;
}

function titleOf(head) {
  return attr(head, /<title>([^<]*)<\/title>/i);
}

function metaByName(head, name) {
  return attr(head, new RegExp(`<meta\\s+name="${name}"[^>]*content="([^"]*)"`, "i"));
}

function metaByProperty(head, property) {
  return attr(head, new RegExp(`<meta\\s+property="${property}"[^>]*content="([^"]*)"`, "i"));
}

const surfaces = [
  { label: "homepage", head: headOf(home, "homepage"), url: "https://tokenoptimisationprotocol.org/" },
  { label: "analyzer", head: headOf(analyzer, "analyzer"), url: "https://tokenoptimisationprotocol.org/analyze/" },
];

for (const { label, head, url } of surfaces) {
  const title = titleOf(head);
  const description = metaByName(head, "description");
  const ogTitle = metaByProperty(head, "og:title");
  const ogDescription = metaByProperty(head, "og:description");
  const twitterTitle = metaByName(head, "twitter:title");
  const twitterDescription = metaByName(head, "twitter:description");

  // Messaging clients and social cards prefer og:, so every preview surface must exist.
  for (const [field, value] of Object.entries({
    title, description, ogTitle, ogDescription, twitterTitle, twitterDescription,
  })) {
    assert.ok(value, `${label} must define a ${field} for the link preview`);
  }

  // The preview must never promise the next-task estimate, which does not ship.
  const previewText = [title, description, ogTitle, ogDescription, twitterTitle, twitterDescription].join(" | ");
  assert.doesNotMatch(previewText, /low,? (?:likely|and)/i,
    `${label} preview text must not promise a low, likely and high cost estimate`);
  assert.doesNotMatch(previewText, /\bhigh cost estimate\b/i,
    `${label} preview text must not promise a high cost estimate`);
  assert.doesNotMatch(previewText, /estimate your next (?:task|ai task)|next-task estimate|before it runs/i,
    `${label} preview text must not claim TOP estimates your next task`);
  assert.doesNotMatch(previewText, /\bsav(?:e|es|ings)\b|\baccurac|\bguarantee/i,
    `${label} preview text must not claim savings, accuracy or a guarantee`);
  assert.doesNotMatch(previewText, /\bTOP-2\b|\bTOP-3\b|Daedalus|Athena|routing|personalis/i,
    `${label} preview text must not present research and development work as shipped`);
  assert.doesNotMatch(previewText, /—/, `${label} preview text must not contain an em dash`);

  // The preview must describe what the analyzer actually does today.
  assert.match(previewText, /usage report/i,
    `${label} preview text must describe the usage report that ships today`);
  assert.match(previewText, /Claude/, `${label} preview text must name a supported history source`);
  assert.match(previewText, /not sent to TOP|nothing is sent to TOP/i,
    `${label} preview text must state that the chosen file is not sent to TOP`);

  // og: and twitter: must agree with name="description", or clients disagree with each other.
  assert.equal(ogTitle, title, `${label} og:title must match the document title`);
  assert.equal(twitterTitle, title, `${label} twitter:title must match the document title`);
  assert.equal(ogDescription, description, `${label} og:description must match the meta description`);
  assert.equal(twitterDescription, description, `${label} twitter:description must match the meta description`);

  assert.equal(metaByProperty(head, "og:url"), url, `${label} og:url must be the canonical absolute URL`);
  assert.match(head, new RegExp(`<link rel="canonical" href="${url.replace(/[/.]/g, "\\$&")}">`),
    `${label} must declare its canonical URL`);
  assert.equal(metaByProperty(head, "og:type"), "website");
  assert.equal(metaByName(head, "twitter:card"), "summary",
    `${label} must use the text card, because no og:image asset is published`);
}

// A forwarded analyzer link must read as an AI cost tool, not as internal tooling.
const analyzerHead = headOf(analyzer, "analyzer");
assert.doesNotMatch(titleOf(analyzerHead), /7Cs|7C's|7CEs|Obsidian/i,
  "the analyzer tab title must not advertise internal tooling to a stranger");
assert.doesNotMatch(metaByProperty(analyzerHead, "og:description"), /7Cs|7C's|7CEs/i,
  "the analyzer preview must not advertise internal tooling to a stranger");
// The Obsidian feature itself must remain reachable; only the preview text changed.
assert.match(analyzer, /Obsidian/, "the Obsidian vault feature must remain in the analyzer");

// Never reference a social image that is not published, or every preview 404s.
for (const [label, html] of [["homepage", home], ["analyzer", analyzer]]) {
  const ogImage = html.match(/<meta\s+property="og:image"[^>]*content="([^"]*)"/i);
  if (ogImage) {
    const path = ogImage[1].replace(/^https:\/\/tokenoptimisationprotocol\.org\//, "");
    assert.ok(fs.existsSync(new URL(path, `file://${__dirname}/`)),
      `${label} og:image must exist as a published file`);
  }
}

// The analyzer preview tags must not reintroduce a network fetch of any kind.
assert.doesNotMatch(analyzerHead, /<meta[^>]+content="[^"]*https?:\/\/(?!tokenoptimisationprotocol\.org)/i,
  "analyzer metadata must not reference a third-party origin");

console.log("TOP link preview metadata regression tests passed");
