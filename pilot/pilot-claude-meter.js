(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotClaudeMeter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SNAPSHOT_SCHEMA_VERSION = "top.pilot.claude-meter.snapshot.v1";
  var DELTA_SCHEMA_VERSION = "top.pilot.claude-meter.delta.v1";
  var PRICING_VERSION = "top-forecast-prices-2026-07-06-v1";
  var UNPRICED_MODEL = "unpriced";
  var TOKEN_FIELDS = Object.freeze([
    "input_tokens",
    "output_tokens",
    "cache_write_tokens",
    "cache_read_tokens"
  ]);
  var TOTAL_KEYS = Object.freeze([
    "input_tokens",
    "output_tokens",
    "cache_write_tokens",
    "cache_read_tokens",
    "total_tokens"
  ]);
  var SNAPSHOT_KEYS = Object.freeze([
    "schema_version",
    "pricing_version",
    "call_count",
    "totals",
    "by_model"
  ]);
  var SNAPSHOT_MODEL_KEYS = Object.freeze([
    "model",
    "call_count",
    "input_tokens",
    "output_tokens",
    "cache_write_tokens",
    "cache_read_tokens",
    "total_tokens"
  ]);

  // USD per one million tokens from the frozen prospective-pilot forecast
  // table. Cache write is the five-minute rate.
  // Every accepted raw model label is listed explicitly below. No fuzzy or
  // substring matching is used when deciding whether a call can be priced.
  var PRICES = Object.freeze({
    "claude-opus-4-8": Object.freeze({ input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 }),
    "claude-fable-5": Object.freeze({ input: 10, output: 50, cache_write: 12.5, cache_read: 1 }),
    "claude-sonnet-5": Object.freeze({ input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 }),
    "claude-sonnet-4-6": Object.freeze({ input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 }),
    "claude-haiku-4-5": Object.freeze({ input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 })
  });
  var MODEL_MAPPING = Object.freeze({
    "claude-opus-4-8": "claude-opus-4-8",
    "claude-fable-5": "claude-fable-5",
    "claude-sonnet-5": "claude-sonnet-5",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-haiku-4-5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5"
  });

  function fail(code) { throw new Error(code); }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function addSafe(left, right) {
    var value = left + right;
    if (!Number.isSafeInteger(value) || value < 0) fail("token_total_out_of_range");
    return value;
  }
  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }
  function exactKeys(value, expected, code) {
    if (!isObject(value)) fail(code);
    var actual = Object.keys(value).sort();
    var wanted = expected.slice().sort();
    if (actual.length !== wanted.length) fail(code);
    for (var i = 0; i < wanted.length; i += 1) {
      if (actual[i] !== wanted[i]) fail(code);
    }
  }
  function checkedCount(value, allowMissing) {
    if (allowMissing && value === undefined) return 0;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("invalid_token_count");
    return value;
  }
  function checkedStableId(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 512 || value.trim() !== value || !value) fail("invalid_dedup_key");
    return value;
  }
  function canonicalModel(value) {
    if (typeof value === "string" && own(MODEL_MAPPING, value)) return MODEL_MAPPING[value];
    return UNPRICED_MODEL;
  }
  function emptyTokenTotals() {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0
    };
  }
  function sumTokenFields(row) {
    var total = 0;
    TOKEN_FIELDS.forEach(function (field) { total = addSafe(total, row[field]); });
    return total;
  }
  function makeSnapshotModel(model, callCount, tokens) {
    return {
      model: model,
      call_count: callCount,
      input_tokens: tokens.input_tokens,
      output_tokens: tokens.output_tokens,
      cache_write_tokens: tokens.cache_write_tokens,
      cache_read_tokens: tokens.cache_read_tokens,
      total_tokens: sumTokenFields(tokens)
    };
  }
  function parseLine(line) {
    try { return JSON.parse(line); }
    catch (error) { fail("malformed_jsonl"); }
  }
  function scanClaudeUsage(texts) {
    if (!Array.isArray(texts)) fail("invalid_text_collection");

    var calls = [];
    var aliases = new Map();

    function bindAlias(alias, callIndex) {
      var existing = aliases.get(alias);
      if (existing !== undefined && existing !== callIndex) fail("dedup_key_collision");
      aliases.set(alias, callIndex);
    }

    function addUsageRecord(record) {
      if (!isObject(record) || record.type !== "assistant" || !isObject(record.message) || record.message.usage === undefined) return;
      if (!isObject(record.message.usage)) fail("invalid_usage_record");

      var usage = record.message.usage;
      var tokens = {
        input_tokens: checkedCount(usage.input_tokens, true),
        output_tokens: checkedCount(usage.output_tokens, true),
        cache_write_tokens: checkedCount(usage.cache_creation_input_tokens, true),
        cache_read_tokens: checkedCount(usage.cache_read_input_tokens, true)
      };
      if (sumTokenFields(tokens) === 0) return;
      var messageId = checkedStableId(record.message.id);
      var requestId = checkedStableId(record.requestId);
      if (messageId === null && requestId === null) fail("missing_dedup_key");

      var messageAlias = messageId === null ? null : "message:" + messageId;
      var requestAlias = requestId === null ? null : "request:" + requestId;
      var messageIndex = messageAlias === null ? undefined : aliases.get(messageAlias);
      var requestIndex = requestAlias === null ? undefined : aliases.get(requestAlias);
      if (messageIndex !== undefined && requestIndex !== undefined && messageIndex !== requestIndex) fail("dedup_key_collision");

      // A message ID and a request ID are each stable aliases for one logical
      // call. A later row may supply only one of them. If a row ever bridges
      // two calls that were already distinct, the collision check above stops.
      var callIndex = messageIndex !== undefined ? messageIndex : requestIndex;
      var model = canonicalModel(record.message.model);
      if (callIndex === undefined) {
        callIndex = calls.length;
        calls.push({
          model: model,
          input_tokens: tokens.input_tokens,
          output_tokens: tokens.output_tokens,
          cache_write_tokens: tokens.cache_write_tokens,
          cache_read_tokens: tokens.cache_read_tokens
        });
      } else {
        var prior = calls[callIndex];
        if (prior.model !== model) fail("dedup_model_conflict");
        TOKEN_FIELDS.forEach(function (field) {
          prior[field] = Math.max(prior[field], tokens[field]);
        });
      }
      if (messageAlias !== null) bindAlias(messageAlias, callIndex);
      if (requestAlias !== null) bindAlias(requestAlias, callIndex);
    }

    texts.forEach(function (text) {
      if (typeof text !== "string") fail("invalid_jsonl_text");
      text.split(/\r?\n/).forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed) return;
        addUsageRecord(parseLine(trimmed));
      });
    });

    var grouped = Object.create(null);
    calls.forEach(function (call) {
      var row = grouped[call.model];
      if (!row) {
        row = grouped[call.model] = {
          call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_write_tokens: 0,
          cache_read_tokens: 0
        };
      }
      row.call_count = addSafe(row.call_count, 1);
      TOKEN_FIELDS.forEach(function (field) { row[field] = addSafe(row[field], call[field]); });
    });

    var totals = emptyTokenTotals();
    var byModel = Object.keys(grouped).sort().map(function (model) {
      var source = grouped[model];
      TOKEN_FIELDS.forEach(function (field) { totals[field] = addSafe(totals[field], source[field]); });
      return makeSnapshotModel(model, source.call_count, source);
    });
    totals.total_tokens = sumTokenFields(totals);

    return deepFreeze({
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      pricing_version: PRICING_VERSION,
      call_count: calls.length,
      totals: totals,
      by_model: byModel
    });
  }

  function validateSnapshot(snapshot) {
    exactKeys(snapshot, SNAPSHOT_KEYS, "invalid_snapshot_shape");
    if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) fail("unsupported_snapshot_schema");
    if (snapshot.pricing_version !== PRICING_VERSION) fail("pricing_version_mismatch");
    var callCount = checkedCount(snapshot.call_count, false);
    exactKeys(snapshot.totals, TOTAL_KEYS, "invalid_snapshot_totals");
    TOTAL_KEYS.forEach(function (key) { checkedCount(snapshot.totals[key], false); });
    if (snapshot.totals.total_tokens !== sumTokenFields(snapshot.totals)) fail("snapshot_total_mismatch");
    if (!Array.isArray(snapshot.by_model)) fail("invalid_snapshot_models");

    var previous = null;
    var seen = Object.create(null);
    var summedCalls = 0;
    var summed = emptyTokenTotals();
    snapshot.by_model.forEach(function (row) {
      exactKeys(row, SNAPSHOT_MODEL_KEYS, "invalid_snapshot_model_shape");
      if (typeof row.model !== "string" || (row.model !== UNPRICED_MODEL && !own(PRICES, row.model))) fail("invalid_snapshot_model");
      if (previous !== null && previous >= row.model) fail("unsorted_snapshot_models");
      if (seen[row.model]) fail("duplicate_snapshot_model");
      previous = row.model;
      seen[row.model] = true;
      var rowCalls = checkedCount(row.call_count, false);
      TOKEN_FIELDS.forEach(function (field) {
        checkedCount(row[field], false);
        summed[field] = addSafe(summed[field], row[field]);
      });
      checkedCount(row.total_tokens, false);
      if (row.total_tokens !== sumTokenFields(row)) fail("snapshot_model_total_mismatch");
      summedCalls = addSafe(summedCalls, rowCalls);
    });
    summed.total_tokens = sumTokenFields(summed);
    if (summedCalls !== callCount) fail("snapshot_call_count_mismatch");
    TOTAL_KEYS.forEach(function (field) {
      if (summed[field] !== snapshot.totals[field]) fail("snapshot_aggregate_mismatch");
    });
    return snapshot;
  }

  function roundUsd(value) {
    if (!Number.isFinite(value) || value < 0) fail("invalid_priced_delta");
    return Math.round(value * 1e12) / 1e12;
  }
  function priceDelta(model, row) {
    var price = PRICES[model];
    if (!price) fail("unpriced_positive_delta");
    var value = (
      row.input_tokens * price.input +
      row.output_tokens * price.output +
      row.cache_write_tokens * price.cache_write +
      row.cache_read_tokens * price.cache_read
    ) / 1000000;
    return roundUsd(value);
  }
  function indexModels(snapshot) {
    var indexed = Object.create(null);
    snapshot.by_model.forEach(function (row) { indexed[row.model] = row; });
    return indexed;
  }
  function zeroSnapshotModel(model) {
    return makeSnapshotModel(model, 0, emptyTokenTotals());
  }
  function measureDelta(before, after) {
    validateSnapshot(before);
    validateSnapshot(after);

    var beforeModels = indexModels(before);
    var afterModels = indexModels(after);
    var names = Object.keys(beforeModels).concat(Object.keys(afterModels)).filter(function (model, index, all) {
      return all.indexOf(model) === index;
    }).sort();
    var totals = emptyTokenTotals();
    var callCount = 0;
    var byModel = [];

    names.forEach(function (model) {
      var left = beforeModels[model] || zeroSnapshotModel(model);
      var right = afterModels[model] || zeroSnapshotModel(model);
      var row = {
        model: model,
        call_count: right.call_count - left.call_count,
        input_tokens: right.input_tokens - left.input_tokens,
        output_tokens: right.output_tokens - left.output_tokens,
        cache_write_tokens: right.cache_write_tokens - left.cache_write_tokens,
        cache_read_tokens: right.cache_read_tokens - left.cache_read_tokens,
        total_tokens: right.total_tokens - left.total_tokens,
        actual_usd: 0
      };
      if (row.call_count < 0 || TOKEN_FIELDS.some(function (field) { return row[field] < 0; }) || row.total_tokens < 0) fail("negative_scope_delta");
      if (row.total_tokens !== sumTokenFields(row)) fail("delta_total_mismatch");
      var changed = row.call_count > 0 || row.total_tokens > 0;
      if (!changed) return;
      if (model === UNPRICED_MODEL) fail("unpriced_positive_delta");
      row.actual_usd = priceDelta(model, row);
      callCount = addSafe(callCount, row.call_count);
      TOKEN_FIELDS.forEach(function (field) { totals[field] = addSafe(totals[field], row[field]); });
      byModel.push(row);
    });

    totals.total_tokens = sumTokenFields(totals);
    if (totals.total_tokens === 0) fail("zero_delta");
    if (!byModel.length) fail("partial_pricing");
    var actualUsd = roundUsd(byModel.reduce(function (sum, row) { return sum + row.actual_usd; }, 0));
    if (!(actualUsd > 0)) fail("partial_pricing");

    return deepFreeze({
      schema_version: DELTA_SCHEMA_VERSION,
      pricing_version: PRICING_VERSION,
      actual_usd: actualUsd,
      call_count: callCount,
      totals: totals,
      by_model: byModel
    });
  }

  return Object.freeze({
    PRICING_VERSION: PRICING_VERSION,
    scanClaudeUsage: scanClaudeUsage,
    measureDelta: measureDelta
  });
});
