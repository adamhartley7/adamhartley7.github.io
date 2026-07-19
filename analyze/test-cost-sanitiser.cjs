// Cost cells must FAIL CLOSED. A cell that is not confidently a plain dollar amount is routed to
// missingCostRows, never coerced into a number. The prior sanitiser stripped every non-digit and
// called parseFloat, so "EUR 3,50" became 350 -- three euros fifty reported as $350.00 billed, a
// 100x overstatement in the report's flagship "Recorded as billed" figure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const parserStart = html.indexOf("function splitCSV");
const parserEnd = html.indexOf("function estTokens", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "could not locate CSV parser block");
const moneyMarker = html.indexOf("function strictMoney", parserStart);
assert.ok(
  moneyMarker > parserStart && moneyMarker < parserEnd,
  "strictMoney must be the shared cost sanitiser inside the parser block",
);

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(parserStart, parserEnd), context);
const strictMoney = context.strictMoney;

// ---------------------------------------------------------------------------
// 1. The sanitiser itself.
// ---------------------------------------------------------------------------

// Accepted: plain dollar amounts, in the forms a real export actually uses.
const ACCEPT = [
  ["3.50", 3.5],
  [" 3.50 ", 3.5],
  ["$3.50", 3.5],
  ["$ 3.50", 3.5],
  ["US$3.50", 3.5],
  ["USD 3.50", 3.5],
  ["usd 3.50", 3.5],
  ["3.50 USD", 3.5],
  ["3.50USD", 3.5],
  ["3.50$", 3.5],
  ["0", 0],
  ["0.00", 0],
  ["$0.00", 0],
  [".50", 0.5],
  ["1234.56", 1234.56],
  ["1,234.56", 1234.56],
  ["$1,234.56", 1234.56],
  ["1,234", 1234],
  ["1,234,567.89", 1234567.89],
  ["-2.50", -2.5],
  ["$-2.50", -2.5],
  ["12", 12],
  ["0.0001", 0.0001],
];
ACCEPT.forEach(function ([raw, expected]) {
  assert.equal(strictMoney(raw), expected, `"${raw}" is a plain dollar amount and must parse to ${expected}`);
});

// Rejected: everything TOP cannot be confident about. null means "unknown", which routes the row
// to missingCostRows so the report says it could not price it rather than inventing a figure.
const REJECT = [
  // European decimal comma. THE 100x BUG: "EUR 3,50" previously yielded 350.
  ["3,50", "a European decimal comma is not a thousands separator"],
  ["EUR 3,50", "a euro amount with a decimal comma must never be read as dollars"],
  ["1.234,56", "European grouping (dot thousands, comma decimal) is not a dollar amount"],
  ["1,23", "a two-digit group after a comma cannot be a thousands separator"],
  ["1,2345", "a four-digit group after a comma cannot be a thousands separator"],
  ["1,234,56", "a trailing two-digit group is not valid thousands grouping"],
  [",50", "a leading comma is not a valid amount"],
  ["1,", "a trailing comma is not a valid amount"],
  // Non-dollar currency. Must NOT be silently reported as dollars.
  ["EUR 3.50", "a euro code must not be reported as dollars"],
  ["3.50 EUR", "a trailing euro code must not be reported as dollars"],
  ["€3.50", "a euro symbol must not be reported as dollars"],
  ["£10.00", "a pound symbol must not be reported as dollars"],
  ["10.00 GBP", "a sterling code must not be reported as dollars"],
  ["¥100", "a yen symbol must not be reported as dollars"],
  ["CAD 5.00", "Canadian dollars are not US dollars"],
  ["CA$5.00", "a Canadian dollar sign must not be reported as US dollars"],
  ["A$5.00", "an Australian dollar sign must not be reported as US dollars"],
  ["5.00 AUD", "an Australian code must not be reported as US dollars"],
  ["₹10.00", "a rupee symbol must not be reported as dollars"],
  ["50c", "a cents suffix is not a dollar amount"],
  ["¢50", "a cent symbol is not a dollar amount"],
  // Scientific notation. Previously "1e400" yielded 1400.
  ["1e400", "scientific notation is not a plain dollar amount"],
  ["1.5e3", "scientific notation is not a plain dollar amount"],
  ["1E4", "scientific notation is not a plain dollar amount"],
  ["1e-4", "scientific notation is not a plain dollar amount"],
  ["Infinity", "a non-finite word is not an amount"],
  ["NaN", "a non-finite word is not an amount"],
  // Parenthesised negatives, the accounting convention for a refund.
  ["(3.50)", "a parenthesised negative is an accounting convention TOP does not interpret"],
  ["($3.50)", "a parenthesised negative is an accounting convention TOP does not interpret"],
  ["(3.50", "an unbalanced parenthesis is not an amount"],
  // Whitespace and multi-part cells.
  ["1 234.56", "a space-separated thousands group is not a plain dollar amount"],
  ["3.50 (est)", "an annotated cell is not a confident amount"],
  ["3.50 - 4.00", "a range is not a single amount"],
  ["about 3.50", "a hedged cell is not a confident amount"],
  ["3.50 credits", "a non-currency unit is not a dollar amount"],
  // Malformed numerics.
  ["3.", "a trailing decimal point is not a complete amount"],
  ["1.2.3", "two decimal points are not an amount"],
  ["--3.50", "a doubled sign is not an amount"],
  ["3-50", "an embedded hyphen is not an amount"],
  ["+3.50-", "a trailing sign is not an amount"],
  [".", "a bare decimal point is not an amount"],
  ["$", "a bare currency symbol is not an amount"],
  ["USD", "a bare currency code is not an amount"],
  // Already-handled non-numbers, retained so the fix does not regress them.
  ["n/a", "an explicit not-applicable marker is unknown"],
  ["--", "a dash placeholder is unknown"],
  ["", "an empty cell is unknown"],
  ["   ", "a whitespace-only cell is unknown"],
  [null, "a null cell is unknown"],
  [undefined, "an absent cell is unknown"],
];
REJECT.forEach(function ([raw, why]) {
  assert.equal(strictMoney(raw), null, `${JSON.stringify(raw)} must be treated as unknown: ${why}`);
});

// A rejected cell must never arrive as 0 -- that would read as "we know it was free".
REJECT.forEach(function ([raw]) {
  assert.notEqual(strictMoney(raw), 0, `${JSON.stringify(raw)} must not be coerced to a recorded zero`);
});

// ---------------------------------------------------------------------------
// 2. Cursor, the source named in the report.
// ---------------------------------------------------------------------------

const CURSOR_HEADER =
  "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";
function cursorRow(cost) {
  return context.parseCursor([
    [CURSOR_HEADER, `2026-07-10T09:00:00.000Z,On-Demand,composer-1,No,1200,1000,500,300,2000,${cost}`].join("\n"),
  ]);
}

const euroCursor = cursorRow('"EUR 3,50"');
assert.equal(euroCursor.costRows, 0, "a euro cost cell must not be recorded as a billed dollar amount");
assert.equal(euroCursor.missingCostRows, 1, "a euro cost cell must route to missingCostRows");
assert.equal(euroCursor.by["composer-1"].cost, 0, "no dollars may be accumulated from an unparseable cell");
assert.equal(euroCursor.costComplete, false, "an export with an unparseable cost cell is not cost-complete");
assert.equal(
  euroCursor.by["composer-1"].missing.inp,
  1000,
  "the tokens of an unpriced row stay visible even though the cost is unknown",
);

const sciCursor = cursorRow("1e400");
assert.equal(sciCursor.costRows, 0, "scientific notation must not be recorded as a billed dollar amount");
assert.equal(sciCursor.missingCostRows, 1, "scientific notation must route to missingCostRows");
assert.equal(sciCursor.by["composer-1"].cost, 0, "no dollars may be accumulated from scientific notation");

const parenCursor = cursorRow('"(3.50)"');
assert.equal(parenCursor.costRows, 0, "a parenthesised negative must not be recorded as billed");
assert.equal(parenCursor.missingCostRows, 1, "a parenthesised negative must route to missingCostRows");

const groupedCursor = cursorRow('"$1,234.56"');
assert.equal(groupedCursor.costRows, 1, "a grouped dollar amount is a confident amount");
assert.equal(groupedCursor.missingCostRows, 0, "a grouped dollar amount must not be flagged unknown");
assert.equal(groupedCursor.by["composer-1"].cost, 1234.56, "thousands separators must parse, not mangle");

const plainCursor = cursorRow("1.95");
assert.equal(plainCursor.costRows, 1, "the ordinary Cursor cost cell must keep working");
assert.equal(plainCursor.by["composer-1"].cost, 1.95, "the ordinary Cursor cost cell must keep its value");

// The pre-existing "-" and "free" markers mean a genuine no-charge row and must still record zero.
const dashCursor = cursorRow("-");
assert.equal(dashCursor.costRows, 1, 'Cursor\'s "-" marker is a recorded no-charge row, not an unknown');
assert.equal(dashCursor.by["composer-1"].cost, 0, 'Cursor\'s "-" marker records a genuine zero');

// ---------------------------------------------------------------------------
// 3. Anthropic Console CSV.
// ---------------------------------------------------------------------------

function consoleRow(cost) {
  return context.parseCSV([`model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,1000,100,${cost}`]);
}

const euroConsole = consoleRow('"EUR 3,50"');
assert.equal(euroConsole.costRows, 0, "a euro cost cell in a Console CSV must not be recorded as dollars");
assert.equal(euroConsole.missingCostRows, 1, "a euro cost cell in a Console CSV must route to missingCostRows");
assert.equal(euroConsole.by["claude-opus-4-8"].cost, 0, "no dollars may be accumulated from a euro cell");
assert.equal(euroConsole.costComplete, false, "a Console CSV with an unparseable cost is not cost-complete");
assert.equal(
  euroConsole.by["claude-opus-4-8"].missing.inp,
  1000,
  "the tokens of an unpriced Console row stay visible",
);

const poundConsole = consoleRow('"10.00 GBP"');
assert.equal(poundConsole.costRows, 0, "a sterling cost cell must not be recorded as dollars");
assert.equal(poundConsole.missingCostRows, 1, "a sterling cost cell must route to missingCostRows");

const sciConsole = consoleRow("1e400");
assert.equal(sciConsole.costRows, 0, "scientific notation in a Console CSV must not be recorded as dollars");
assert.equal(sciConsole.missingCostRows, 1, "scientific notation in a Console CSV must route to missingCostRows");

const goodConsole = consoleRow("0.75");
assert.equal(goodConsole.costRows, 1, "the ordinary Console cost cell must keep working");
assert.equal(goodConsole.by["claude-opus-4-8"].cost, 0.75, "the ordinary Console cost cell must keep its value");

// ---------------------------------------------------------------------------
// 4. GitHub Copilot.
// ---------------------------------------------------------------------------

const COPILOT_HEADER =
  "date,product,sku,quantity,unit_type,applied_cost_per_quantity,gross_amount,discount_amount,net_amount,organization,cost_center_name,model,username";
function copilotRow(net) {
  return context.parseCopilot([
    [
      COPILOT_HEADER,
      `2026-06-02,copilot,copilot_premium_request,12,requests,0.04,0.48,0.08,${net},org,center,"Claude Sonnet 4.5",user`,
    ].join("\n"),
  ]);
}

const euroCopilot = copilotRow('"EUR 3,50"');
assert.equal(euroCopilot.costRows, 0, "a euro net_amount must not be recorded as a billed dollar amount");
assert.equal(euroCopilot.missingCostRows, 1, "a euro net_amount must route to missingCostRows");
assert.equal(euroCopilot.by["Claude Sonnet 4.5"].cost, 0, "no dollars may be accumulated from a euro net_amount");
assert.equal(
  euroCopilot.by["Claude Sonnet 4.5"].requests,
  12,
  "the request count of an unpriced Copilot row stays visible",
);

const sciCopilot = copilotRow("1e400");
assert.equal(sciCopilot.costRows, 0, "scientific notation must not be recorded as a billed Copilot amount");
assert.equal(sciCopilot.missingCostRows, 1, "scientific notation must route to missingCostRows");

const goodCopilot = copilotRow("0.40");
assert.equal(goodCopilot.costRows, 1, "the ordinary Copilot net_amount must keep working");
assert.equal(goodCopilot.by["Claude Sonnet 4.5"].cost, 0.4, "the ordinary Copilot net_amount must keep its value");

// A quantity cell gets the same discipline: an unparseable quantity is not a silent zero.
const euroQuantity = context.parseCopilot([
  [
    COPILOT_HEADER,
    "2026-06-02,copilot,copilot_premium_request,\"1 234\",requests,0.04,0.48,0.08,0.40,org,center,\"Claude Sonnet 4.5\",user",
  ].join("\n"),
]);
assert.equal(
  euroQuantity.by["Claude Sonnet 4.5"].requests,
  0,
  "an unparseable quantity must not be invented, and must not be mangled into a number",
);

// ---------------------------------------------------------------------------
// 5. No source may report a non-dollar currency as dollars.
// ---------------------------------------------------------------------------

[
  ["€3.50", "euro symbol"],
  ["EUR 3.50", "euro code"],
  ["£3.50", "pound symbol"],
  ["CAD 3.50", "Canadian dollar code"],
].forEach(function ([cell, label]) {
  const quoted = `"${cell}"`;
  assert.equal(cursorRow(quoted).costRows, 0, `Cursor must not report a ${label} as dollars`);
  assert.equal(consoleRow(quoted).costRows, 0, `the Console CSV must not report a ${label} as dollars`);
  assert.equal(copilotRow(quoted).costRows, 0, `Copilot must not report a ${label} as dollars`);
});

console.log("cost sanitiser: ok");
