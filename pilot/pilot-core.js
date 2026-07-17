(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TOPProspectivePilot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = "top.prospective-pilot.v1";
  var TARGET_PARTICIPANTS = 4;
  var TARGET_USABLE_TASKS = 6;
  var MINIMUM_TASK_CLASSES = 3;
  var NOMINAL_INTERVAL_COVERAGE = 0.8;
  var METRIC = "api_rate_equivalent_usd";
  var MAX_ATTEMPTS_PER_PARTICIPANT = 60;
  var TASK_CLASSES = Object.freeze([
    "software_build",
    "data_analysis",
    "research_synthesis",
    "written_communication",
    "planning_decision",
    "operations_workflow"
  ]);
  var FORECAST_VERSIONS = Object.freeze([
    "top_v1_task_only",
    "top_v1_project_history_blend",
    "comparison_baseline"
  ]);
  var INVALIDATION_REASONS = Object.freeze([
    "task_abandoned",
    "actual_unavailable",
    "task_changed_after_freeze",
    "forecast_recorded_after_task_started",
    "data_entry_error",
    "duplicate_attempt",
    "protocol_interruption"
  ]);
  var STATES = Object.freeze(["draft", "frozen", "paired", "invalidated"]);
  var ATTEMPT_KEYS = Object.freeze([
    "attempt_sequence",
    "state",
    "task_class",
    "forecast_version",
    "p10_usd",
    "p50_usd",
    "p90_usd",
    "actual_usd",
    "invalidation_reason"
  ]);

  function fail(code) { throw new Error(code); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function isPositiveNumber(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }
  function includes(list, value) { return list.indexOf(value) !== -1; }
  function unique(values) { return Array.from(new Set(values)); }
  function round(value, digits) {
    if (value === null || !Number.isFinite(value)) return null;
    var scale = Math.pow(10, digits === undefined ? 8 : digits);
    return Math.round(value * scale) / scale;
  }
  function exactKeys(object, expected, code) {
    if (!isObject(object)) fail(code);
    var actual = Object.keys(object).sort();
    var wanted = expected.slice().sort();
    if (actual.length !== wanted.length) fail(code);
    for (var i = 0; i < wanted.length; i += 1) if (actual[i] !== wanted[i]) fail(code);
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    var parsed = new Date(value + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function todayUTC() { return new Date().toISOString().slice(0, 10); }

  function createParticipant(slot) {
    if (!Number.isInteger(slot) || slot < 1 || slot > TARGET_PARTICIPANTS) fail("invalid_participant_slot");
    return { participant_slot: slot, attempts: [] };
  }

  function progress(participant) {
    validateParticipant(participant, true);
    var paired = participant.attempts.filter(function (attempt) { return attempt.state === "paired"; });
    var frozen = participant.attempts.filter(function (attempt) {
      return attempt.state === "frozen" || attempt.state === "paired" || attempt.state === "invalidated";
    });
    var invalidated = participant.attempts.filter(function (attempt) { return attempt.state === "invalidated"; });
    var missing = participant.attempts.filter(function (attempt) {
      return attempt.state === "frozen" || (attempt.state === "invalidated" && attempt.actual_usd === null);
    });
    var classes = unique(paired.map(function (attempt) { return attempt.task_class; }));
    return {
      paired_usable_tasks: paired.length,
      distinct_task_classes: classes.length,
      target_met: paired.length === TARGET_USABLE_TASKS && classes.length >= MINIMUM_TASK_CLASSES,
      forecasts_frozen: frozen.length,
      invalidated_attempts: invalidated.length,
      missing_actual_attempts: missing.length,
      open_attempts: participant.attempts.filter(function (attempt) {
        return attempt.state === "draft" || attempt.state === "frozen";
      }).length
    };
  }

  function attemptTemplate(sequence) {
    return {
      attempt_sequence: sequence,
      state: "draft",
      task_class: null,
      forecast_version: null,
      p10_usd: null,
      p50_usd: null,
      p90_usd: null,
      actual_usd: null,
      invalidation_reason: null
    };
  }

  function startDraft(participant) {
    validateParticipant(participant, true);
    var next = clone(participant);
    var status = progress(next);
    if (status.paired_usable_tasks >= TARGET_USABLE_TASKS) fail("participant_target_already_met");
    if (status.open_attempts) fail("open_attempt_exists");
    if (next.attempts.length >= MAX_ATTEMPTS_PER_PARTICIPANT) fail("attempt_limit_reached");
    next.attempts.push(attemptTemplate(next.attempts.length + 1));
    return next;
  }

  function findAttempt(participant, sequence) {
    var index = participant.attempts.findIndex(function (attempt) { return attempt.attempt_sequence === sequence; });
    if (index < 0) fail("attempt_not_found");
    return index;
  }

  function updateDraft(participant, sequence, patch) {
    validateParticipant(participant, true);
    if (!isObject(patch)) fail("invalid_draft_patch");
    var allowed = ["task_class", "forecast_version", "p10_usd", "p50_usd", "p90_usd"];
    Object.keys(patch).forEach(function (key) { if (!includes(allowed, key)) fail("invalid_draft_patch"); });
    var next = clone(participant);
    var index = findAttempt(next, sequence);
    var attempt = next.attempts[index];
    if (attempt.state !== "draft") fail("frozen_attempt_is_immutable");
    Object.keys(patch).forEach(function (key) {
      var value = patch[key];
      if (key === "task_class" && value !== null && !includes(TASK_CLASSES, value)) fail("invalid_task_class");
      if (key === "forecast_version" && value !== null && !includes(FORECAST_VERSIONS, value)) fail("invalid_forecast_version");
      if (/^p\d+_usd$/.test(key) && value !== null && !isPositiveNumber(value)) fail("invalid_forecast_value");
      attempt[key] = value;
    });
    return next;
  }

  function forecastIsOrdered(attempt) {
    return isPositiveNumber(attempt.p10_usd) && isPositiveNumber(attempt.p50_usd) &&
      isPositiveNumber(attempt.p90_usd) && attempt.p10_usd <= attempt.p50_usd && attempt.p50_usd <= attempt.p90_usd;
  }

  function freezeDraft(participant, sequence) {
    validateParticipant(participant, true);
    var next = clone(participant);
    var index = findAttempt(next, sequence);
    var attempt = next.attempts[index];
    if (attempt.state !== "draft") fail("attempt_not_draft");
    if (!includes(TASK_CLASSES, attempt.task_class)) fail("task_class_required");
    if (!includes(FORECAST_VERSIONS, attempt.forecast_version)) fail("forecast_version_required");
    if (!forecastIsOrdered(attempt)) fail("forecast_percentiles_must_be_ordered");
    var paired = next.attempts.filter(function (item) { return item.state === "paired"; });
    var classes = unique(paired.map(function (item) { return item.task_class; }).concat([attempt.task_class]));
    var usableIfPaired = paired.length + 1;
    var remaining = TARGET_USABLE_TASKS - usableIfPaired;
    if (classes.length + remaining < MINIMUM_TASK_CLASSES) fail("task_class_mix_would_be_impossible");
    attempt.state = "frozen";
    return next;
  }

  function pairAttempt(participant, sequence, actualUsd) {
    validateParticipant(participant, true);
    if (!isPositiveNumber(actualUsd)) fail("invalid_actual_value");
    var next = clone(participant);
    var index = findAttempt(next, sequence);
    var attempt = next.attempts[index];
    if (attempt.state !== "frozen") fail("actual_requires_frozen_forecast");
    attempt.actual_usd = actualUsd;
    attempt.state = "paired";
    return next;
  }

  function invalidateAttempt(participant, sequence, reason) {
    validateParticipant(participant, true);
    if (!includes(INVALIDATION_REASONS, reason)) fail("invalid_invalidation_reason");
    var next = clone(participant);
    var index = findAttempt(next, sequence);
    var attempt = next.attempts[index];
    if (attempt.state !== "frozen" && attempt.state !== "paired") fail("only_frozen_records_can_be_invalidated");
    attempt.state = "invalidated";
    attempt.invalidation_reason = reason;
    return next;
  }

  function replaceInvalidated(participant, sequence) {
    validateParticipant(participant, true);
    var index = findAttempt(participant, sequence);
    if (participant.attempts[index].state !== "invalidated") fail("replacement_requires_invalidated_attempt");
    return startDraft(participant);
  }

  function validateAttempt(attempt, expectedSequence, allowDraft) {
    exactKeys(attempt, ATTEMPT_KEYS, "invalid_attempt_shape");
    if (attempt.attempt_sequence !== expectedSequence) fail("invalid_attempt_sequence");
    if (!includes(STATES, attempt.state)) fail("invalid_attempt_state");
    if (attempt.state === "draft" && !allowDraft) fail("draft_not_allowed");
    if (attempt.task_class !== null && !includes(TASK_CLASSES, attempt.task_class)) fail("invalid_task_class");
    if (attempt.forecast_version !== null && !includes(FORECAST_VERSIONS, attempt.forecast_version)) fail("invalid_forecast_version");
    ["p10_usd", "p50_usd", "p90_usd", "actual_usd"].forEach(function (key) {
      if (attempt[key] !== null && !isPositiveNumber(attempt[key])) fail("invalid_positive_value");
    });
    if (attempt.state !== "draft") {
      if (!includes(TASK_CLASSES, attempt.task_class) || !includes(FORECAST_VERSIONS, attempt.forecast_version)) fail("frozen_fields_required");
      if (!forecastIsOrdered(attempt)) fail("forecast_percentiles_must_be_ordered");
    }
    if (attempt.state === "frozen" && (attempt.actual_usd !== null || attempt.invalidation_reason !== null)) fail("invalid_frozen_attempt");
    if (attempt.state === "paired" && (!isPositiveNumber(attempt.actual_usd) || attempt.invalidation_reason !== null)) fail("invalid_paired_attempt");
    if (attempt.state === "invalidated" && !includes(INVALIDATION_REASONS, attempt.invalidation_reason)) fail("invalid_invalidation_reason");
    if (attempt.state === "draft" && (attempt.actual_usd !== null || attempt.invalidation_reason !== null)) fail("invalid_draft_attempt");
  }

  function validateParticipant(participant, allowDraft) {
    exactKeys(participant, ["participant_slot", "attempts"], "invalid_participant_shape");
    if (!Number.isInteger(participant.participant_slot) || participant.participant_slot < 1 || participant.participant_slot > TARGET_PARTICIPANTS) fail("invalid_participant_slot");
    if (!Array.isArray(participant.attempts) || participant.attempts.length > MAX_ATTEMPTS_PER_PARTICIPANT) fail("invalid_attempts");
    participant.attempts.forEach(function (attempt, index) { validateAttempt(attempt, index + 1, allowDraft); });
    var open = participant.attempts.filter(function (attempt) { return attempt.state === "draft" || attempt.state === "frozen"; });
    if (open.length > 1) fail("multiple_open_attempts");
    if (open.length && open[0].attempt_sequence !== participant.attempts.length) fail("open_attempt_must_be_latest");
    var paired = participant.attempts.filter(function (attempt) { return attempt.state === "paired"; });
    if (paired.length > TARGET_USABLE_TASKS) fail("too_many_usable_tasks");
    if (paired.length === TARGET_USABLE_TASKS && open.length) fail("open_attempt_after_target");
    return participant;
  }

  function studyDescriptor() {
    return {
      target_participants: TARGET_PARTICIPANTS,
      usable_tasks_per_participant: TARGET_USABLE_TASKS,
      minimum_task_classes_per_participant: MINIMUM_TASK_CLASSES,
      metric: METRIC,
      nominal_interval_coverage: NOMINAL_INTERVAL_COVERAGE
    };
  }

  function participantCompleteness(participant) {
    var value = progress(participant);
    return {
      paired_usable_tasks: value.paired_usable_tasks,
      distinct_task_classes: value.distinct_task_classes,
      target_met: value.target_met,
      forecasts_frozen: value.forecasts_frozen,
      invalidated_attempts: value.invalidated_attempts,
      missing_actual_attempts: value.missing_actual_attempts
    };
  }

  function toExport(participant, generatedDate) {
    validateParticipant(participant, true);
    var date = generatedDate || todayUTC();
    if (!validDate(date)) fail("invalid_generated_date");
    return {
      schema_version: SCHEMA_VERSION,
      generated_date: date,
      study: studyDescriptor(),
      participant_slot: participant.participant_slot,
      attempts: clone(participant.attempts),
      completeness: participantCompleteness(participant)
    };
  }

  function validateExport(value) {
    exactKeys(value, ["schema_version", "generated_date", "study", "participant_slot", "attempts", "completeness"], "invalid_export_shape");
    if (value.schema_version !== SCHEMA_VERSION) fail("unsupported_schema_version");
    if (!validDate(value.generated_date)) fail("invalid_generated_date");
    exactKeys(value.study, ["target_participants", "usable_tasks_per_participant", "minimum_task_classes_per_participant", "metric", "nominal_interval_coverage"], "invalid_study_shape");
    var expectedStudy = studyDescriptor();
    Object.keys(expectedStudy).forEach(function (key) { if (value.study[key] !== expectedStudy[key]) fail("study_contract_mismatch"); });
    var participant = { participant_slot: value.participant_slot, attempts: value.attempts };
    validateParticipant(participant, true);
    exactKeys(value.completeness, ["paired_usable_tasks", "distinct_task_classes", "target_met", "forecasts_frozen", "invalidated_attempts", "missing_actual_attempts"], "invalid_completeness_shape");
    var expectedCompleteness = participantCompleteness(participant);
    Object.keys(expectedCompleteness).forEach(function (key) { if (value.completeness[key] !== expectedCompleteness[key]) fail("completeness_mismatch"); });
    return clone(value);
  }

  function parseExport(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (error) { fail("invalid_json"); }
    return validateExport(parsed);
  }

  function exportToParticipant(value) {
    var checked = validateExport(value);
    return { participant_slot: checked.participant_slot, attempts: clone(checked.attempts) };
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function intervalScoreLog(attempt) {
    var alpha = 1 - NOMINAL_INTERVAL_COVERAGE;
    var lower = Math.log(attempt.p10_usd);
    var upper = Math.log(attempt.p90_usd);
    var actual = Math.log(attempt.actual_usd);
    var score = upper - lower;
    if (actual < lower) score += (2 / alpha) * (lower - actual);
    if (actual > upper) score += (2 / alpha) * (actual - upper);
    return score;
  }

  function summarizeAttempts(attempts) {
    var all = attempts.slice();
    var frozen = all.filter(function (attempt) { return attempt.state !== "draft"; });
    var paired = all.filter(function (attempt) { return attempt.state === "paired"; });
    var invalidated = all.filter(function (attempt) { return attempt.state === "invalidated"; });
    var missingActual = all.filter(function (attempt) {
      return attempt.state === "frozen" || (attempt.state === "invalidated" && attempt.actual_usd === null);
    });
    var within = paired.filter(function (attempt) { return attempt.actual_usd >= attempt.p10_usd && attempt.actual_usd <= attempt.p90_usd; });
    var below = paired.filter(function (attempt) { return attempt.actual_usd < attempt.p10_usd; });
    var atOrBelowP50 = paired.filter(function (attempt) { return attempt.actual_usd <= attempt.p50_usd; });
    var atOrBelowP90 = paired.filter(function (attempt) { return attempt.actual_usd <= attempt.p90_usd; });
    var multError = paired.map(function (attempt) {
      return Math.max(attempt.actual_usd / attempt.p50_usd, attempt.p50_usd / attempt.actual_usd);
    });
    var logBias = paired.map(function (attempt) { return Math.log(attempt.p50_usd / attempt.actual_usd); });
    var relativeWidth = paired.map(function (attempt) { return (attempt.p90_usd - attempt.p10_usd) / attempt.p50_usd; });
    var absoluteWidth = paired.map(function (attempt) { return attempt.p90_usd - attempt.p10_usd; });
    var scores = paired.map(intervalScoreLog);
    function rate(count, denominator) { return denominator ? round(count / denominator) : null; }
    return {
      attempts_total: all.length,
      forecasts_frozen: frozen.length,
      paired_usable: paired.length,
      invalidated: invalidated.length,
      actual_missing: missingActual.length,
      nominal_interval_coverage: NOMINAL_INTERVAL_COVERAGE,
      within_p10_p90_count: within.length,
      within_p10_p90_rate: rate(within.length, paired.length),
      below_p10_count: below.length,
      below_p10_rate: rate(below.length, paired.length),
      at_or_below_p50_count: atOrBelowP50.length,
      at_or_below_p50_rate: rate(atOrBelowP50.length, paired.length),
      at_or_below_p90_count: atOrBelowP90.length,
      at_or_below_p90_rate: rate(atOrBelowP90.length, paired.length),
      median_multiplicative_error: round(median(multError)),
      mean_log_bias: round(mean(logBias)),
      median_relative_interval_width: round(median(relativeWidth)),
      median_absolute_interval_width_usd: round(median(absoluteWidth)),
      mean_log_space_interval_score: round(mean(scores)),
      attrition_rate: rate(invalidated.length, frozen.length),
      missing_data_floor_rate: rate(missingActual.length, frozen.length)
    };
  }

  function groupedSummary(attempts, key) {
    var groups = Object.create(null);
    attempts.forEach(function (attempt) {
      var label = String(attempt[key]);
      if (!groups[label]) groups[label] = [];
      groups[label].push(attempt);
    });
    return Object.keys(groups).sort().map(function (label) {
      return { group: label, summary: summarizeAttempts(groups[label]) };
    });
  }

  function coordinatorSummary(exports) {
    if (!Array.isArray(exports) || exports.length < 1 || exports.length > TARGET_PARTICIPANTS) fail("invalid_export_count");
    var checked = exports.map(validateExport);
    var slots = checked.map(function (value) { return value.participant_slot; });
    if (unique(slots).length !== slots.length) fail("duplicate_participant_slot");
    var tagged = [];
    checked.forEach(function (value) {
      value.attempts.forEach(function (attempt) {
        var copy = clone(attempt);
        copy.participant_slot = value.participant_slot;
        tagged.push(copy);
      });
    });
    var byParticipant = slots.slice().sort(function (a, b) { return a - b; }).map(function (slot) {
      return { group: String(slot), summary: summarizeAttempts(tagged.filter(function (attempt) { return attempt.participant_slot === slot; })) };
    });
    return {
      schema_version: "top.prospective-pilot.summary.v1",
      participants_imported: checked.length,
      participant_target: TARGET_PARTICIPANTS,
      protocol_complete: checked.length === TARGET_PARTICIPANTS && checked.every(function (value) { return value.completeness.target_met; }),
      overall: summarizeAttempts(tagged),
      by_participant: byParticipant,
      by_forecast_version: groupedSummary(tagged.filter(function (attempt) { return attempt.forecast_version !== null; }), "forecast_version"),
      by_task_class: groupedSummary(tagged.filter(function (attempt) { return attempt.task_class !== null; }), "task_class")
    };
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    TARGET_PARTICIPANTS: TARGET_PARTICIPANTS,
    TARGET_USABLE_TASKS: TARGET_USABLE_TASKS,
    MINIMUM_TASK_CLASSES: MINIMUM_TASK_CLASSES,
    NOMINAL_INTERVAL_COVERAGE: NOMINAL_INTERVAL_COVERAGE,
    METRIC: METRIC,
    TASK_CLASSES: TASK_CLASSES,
    FORECAST_VERSIONS: FORECAST_VERSIONS,
    INVALIDATION_REASONS: INVALIDATION_REASONS,
    createParticipant: createParticipant,
    startDraft: startDraft,
    updateDraft: updateDraft,
    freezeDraft: freezeDraft,
    pairAttempt: pairAttempt,
    invalidateAttempt: invalidateAttempt,
    replaceInvalidated: replaceInvalidated,
    progress: progress,
    toExport: toExport,
    validateExport: validateExport,
    parseExport: parseExport,
    exportToParticipant: exportToParticipant,
    summarizeAttempts: summarizeAttempts,
    coordinatorSummary: coordinatorSummary
  });
});
