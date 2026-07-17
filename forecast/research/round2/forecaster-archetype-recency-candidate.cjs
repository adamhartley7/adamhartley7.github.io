"use strict";

/*
 * RESEARCH ONLY.
 *
 * This wrapper applies one frozen task-shape feature before delegating to the
 * unchanged public engine: retain only the most recent 128 fit rows for each
 * precomputed archetype. It is not loaded by /forecast.
 */

const BaseForecaster = require("../../forecaster.js");

const MAX_ROWS_PER_ARCHETYPE = 128;

function selectRecentPerArchetype(rows, maxRows = MAX_ROWS_PER_ARCHETYPE) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new RangeError("maxRows must be a positive integer");

  const seen = new Map();
  const keep = new Array(rows.length).fill(false);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const archetype = String(rows[i] && rows[i].archetype || "misc");
    const count = seen.get(archetype) || 0;
    if (count < maxRows) {
      keep[i] = true;
      seen.set(archetype, count + 1);
    }
  }
  return rows.filter((row, index) => keep[index]);
}

function fitPriors(trainSessions, opts) {
  return BaseForecaster.fitPriors(
    selectRecentPerArchetype(trainSessions, MAX_ROWS_PER_ARCHETYPE),
    opts
  );
}

module.exports = {
  ...BaseForecaster,
  MAX_ROWS_PER_ARCHETYPE,
  fitPriors,
  selectRecentPerArchetype
};
