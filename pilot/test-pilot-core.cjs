const assert = require("node:assert/strict");
const Pilot = require("./pilot-core.js");

const CLASSES = Pilot.TASK_CLASSES;
const VERSIONS = Pilot.FORECAST_VERSIONS;

function openDraft(participant) {
  const latest = participant.attempts.at(-1);
  return latest && latest.state === "draft" ? participant : Pilot.startDraft(participant);
}

function setForecast(participant, taskClass, version = VERSIONS[0], values = [8, 10, 12]) {
  let next = openDraft(participant);
  const sequence = next.attempts.at(-1).attempt_sequence;
  next = Pilot.updateDraft(next, sequence, {
    task_class: taskClass,
    forecast_version: version,
    p10_usd: values[0],
    p50_usd: values[1],
    p90_usd: values[2],
  });
  return { participant: next, sequence };
}

function addPaired(participant, taskClass, actual, version) {
  const prepared = setForecast(participant, taskClass, version);
  let next = Pilot.freezeDraft(prepared.participant, prepared.sequence);
  next = Pilot.pairAttempt(next, prepared.sequence, actual);
  return next;
}

function addMissingAndReplace(participant) {
  const prepared = setForecast(participant, CLASSES[0]);
  let next = Pilot.freezeDraft(prepared.participant, prepared.sequence);
  next = Pilot.invalidateAttempt(next, prepared.sequence, "actual_unavailable");
  return Pilot.replaceInvalidated(next, prepared.sequence);
}

function completedParticipant(slot, version) {
  const actuals = [5, 8, 10, 12, 13, 20];
  let participant = addMissingAndReplace(Pilot.createParticipant(slot));
  actuals.forEach((actual, index) => {
    participant = addPaired(participant, CLASSES[index % 3], actual, version);
  });
  return participant;
}

assert.equal(Pilot.SCHEMA_VERSION, "top.prospective-pilot.v1");
assert.equal(Pilot.TARGET_PARTICIPANTS, 4);
assert.equal(Pilot.TARGET_USABLE_TASKS, 6);
assert.equal(Pilot.MINIMUM_TASK_CLASSES, 3);
assert.equal(Pilot.NOMINAL_INTERVAL_COVERAGE, 0.8);
assert.equal(Pilot.METRIC, "api_rate_equivalent_usd");
assert.equal(new Set(Pilot.TASK_CLASSES).size, Pilot.TASK_CLASSES.length);
assert.equal(new Set(Pilot.INVALIDATION_REASONS).size, Pilot.INVALIDATION_REASONS.length);

assert.deepEqual(Pilot.wilsonInterval95(0, 0), {
  numerator: 0, denominator: 0, lower_bound: null, upper_bound: null,
});
assert.deepEqual(Pilot.wilsonInterval95(5, 10), {
  numerator: 5, denominator: 10, lower_bound: 0.23659309, upper_bound: 0.76340691,
});
assert.deepEqual(Pilot.wilsonInterval95(0, 24), {
  numerator: 0, denominator: 24, lower_bound: 0, upper_bound: 0.1379762,
});
assert.deepEqual(Pilot.wilsonInterval95(24, 24), {
  numerator: 24, denominator: 24, lower_bound: 0.8620238, upper_bound: 1,
});
assert.throws(() => Pilot.wilsonInterval95(-1, 24), /invalid_wilson_counts/);
assert.throws(() => Pilot.wilsonInterval95(25, 24), /invalid_wilson_counts/);
assert.throws(() => Pilot.wilsonInterval95(1.5, 24), /invalid_wilson_counts/);

assert.throws(() => Pilot.createParticipant(0), /invalid_participant_slot/);
assert.throws(() => Pilot.createParticipant(5), /invalid_participant_slot/);

let participant = Pilot.createParticipant(1);
const untouched = JSON.stringify(participant);
participant = Pilot.startDraft(participant);
assert.equal(untouched, JSON.stringify(Pilot.createParticipant(1)), "state transitions must not mutate the prior object");
assert.equal(participant.attempts[0].state, "draft");
assert.throws(() => Pilot.startDraft(participant), /open_attempt_exists/);
assert.throws(() => Pilot.pairAttempt(participant, 1, 10), /actual_requires_frozen_forecast/);

participant = Pilot.updateDraft(participant, 1, {
  task_class: CLASSES[0], forecast_version: VERSIONS[0], p10_usd: 12, p50_usd: 10, p90_usd: 8,
});
assert.throws(() => Pilot.freezeDraft(participant, 1), /forecast_percentiles_must_be_ordered/);
participant = Pilot.updateDraft(participant, 1, { p10_usd: 8, p50_usd: 10, p90_usd: 12 });
const beforeFreeze = JSON.stringify(participant);
participant = Pilot.freezeDraft(participant, 1);
assert.equal(JSON.parse(beforeFreeze).attempts[0].state, "draft");
assert.equal(participant.attempts[0].state, "frozen");
assert.throws(() => Pilot.updateDraft(participant, 1, { p50_usd: 11 }), /frozen_attempt_is_immutable/);
participant = Pilot.pairAttempt(participant, 1, 9);
assert.equal(participant.attempts[0].state, "paired");
assert.equal(participant.attempts[0].actual_usd, 9);
assert.throws(() => Pilot.pairAttempt(participant, 1, 9), /actual_requires_frozen_forecast/);

participant = Pilot.invalidateAttempt(participant, 1, "data_entry_error");
assert.equal(participant.attempts[0].state, "invalidated");
assert.equal(participant.attempts[0].actual_usd, 9, "an invalidated paired value remains in the retained audit record");
assert.equal(participant.attempts[0].invalidation_reason, "data_entry_error");
assert.throws(() => Pilot.updateDraft(participant, 1, { p50_usd: 11 }), /frozen_attempt_is_immutable/);
participant = Pilot.replaceInvalidated(participant, 1);
assert.equal(participant.attempts.length, 2);
assert.equal(participant.attempts[1].state, "draft");

let classGate = Pilot.createParticipant(2);
for (let index = 0; index < 4; index += 1) classGate = addPaired(classGate, CLASSES[0], 10, VERSIONS[0]);
let fifth = setForecast(classGate, CLASSES[0]);
assert.throws(() => Pilot.freezeDraft(fifth.participant, fifth.sequence), /task_class_mix_would_be_impossible/,
  "the harness must prevent a six-task set that cannot reach three classes");
fifth.participant = Pilot.updateDraft(fifth.participant, fifth.sequence, { task_class: CLASSES[1] });
classGate = Pilot.pairAttempt(Pilot.freezeDraft(fifth.participant, fifth.sequence), fifth.sequence, 10);
classGate = addPaired(classGate, CLASSES[2], 10, VERSIONS[0]);
assert.equal(Pilot.progress(classGate).target_met, true);
assert.throws(() => Pilot.startDraft(classGate), /participant_target_already_met/);

const complete = [
  completedParticipant(1, VERSIONS[0]),
  completedParticipant(2, VERSIONS[1]),
  completedParticipant(3, VERSIONS[0]),
  completedParticipant(4, VERSIONS[1]),
];
const pilotExports = complete.map(value => Pilot.toExport(value, "2026-07-17"));
pilotExports.forEach(value => {
  assert.equal(value.schema_version, "top.prospective-pilot.v1");
  assert.equal(value.completeness.paired_usable_tasks, 6);
  assert.equal(value.completeness.distinct_task_classes, 3);
  assert.equal(value.completeness.target_met, true);
  assert.equal(value.completeness.forecasts_frozen, 7);
  assert.equal(value.completeness.invalidated_attempts, 1);
  assert.equal(value.completeness.missing_actual_attempts, 1);
  assert.equal(value.attempts.length, 7, "missing attempts must remain in the export");
  assert.equal(Pilot.parseExport(JSON.stringify(value)).participant_slot, value.participant_slot);
});

const reordered = JSON.parse(JSON.stringify(pilotExports[0]));
reordered.study = {
  metric: "api_rate_equivalent_usd",
  target_participants: 4,
  nominal_interval_coverage: 0.8,
  minimum_task_classes_per_participant: 3,
  usable_tasks_per_participant: 6,
};
assert.equal(Pilot.validateExport(reordered).participant_slot, 1, "JSON object key order must not affect validation");

const injected = JSON.parse(JSON.stringify(pilotExports[0]));
injected.attempts[0].task_text = "private";
assert.throws(() => Pilot.validateExport(injected), /invalid_attempt_shape/);
const mismatched = JSON.parse(JSON.stringify(pilotExports[0]));
mismatched.completeness.paired_usable_tasks = 5;
assert.throws(() => Pilot.validateExport(mismatched), /completeness_mismatch/);
const overrun = JSON.parse(JSON.stringify(pilotExports[0]));
overrun.attempts.push({
  attempt_sequence: 8, state: "draft", task_class: null, forecast_version: null,
  p10_usd: null, p50_usd: null, p90_usd: null, actual_usd: null, invalidation_reason: null,
});
assert.throws(() => Pilot.validateExport(overrun), /open_attempt_after_target/);
assert.throws(() => Pilot.coordinatorSummary([pilotExports[0], pilotExports[0]]), /duplicate_participant_slot/);

const summary = Pilot.coordinatorSummary(pilotExports);
assert.equal(summary.protocol_complete, true);
assert.equal(summary.participants_imported, 4);
assert.equal(summary.overall.attempts_total, 28);
assert.equal(summary.overall.forecasts_frozen, 28);
assert.equal(summary.overall.paired_usable, 24);
assert.equal(summary.overall.invalidated, 4);
assert.equal(summary.overall.actual_missing, 4);
assert.equal(summary.overall.within_p10_p90_count, 12);
assert.equal(summary.overall.within_p10_p90_rate, 0.5);
assert.deepEqual(summary.overall.within_p10_p90_wilson_95, {
  numerator: 12, denominator: 24, lower_bound: 0.31427426, upper_bound: 0.68572574,
});
assert.equal(summary.overall.below_p10_count, 4);
assert.equal(summary.overall.below_p10_rate, 0.16666667);
assert.equal(summary.overall.at_or_below_p50_count, 12);
assert.equal(summary.overall.at_or_below_p50_rate, 0.5);
assert.equal(summary.overall.at_or_below_p90_count, 16);
assert.equal(summary.overall.at_or_below_p90_rate, 0.66666667);
assert.equal(summary.overall.median_multiplicative_error, 1.275);
assert.equal(summary.overall.attrition_rate, 0.14285714);
assert.equal(summary.overall.missing_actual_rate, 0.14285714);
assert.equal(summary.overall.analysis_excluded, 4);
assert.equal(summary.overall.analysis_exclusion_rate, 0.14285714);
assert.equal(summary.overall.coverage_floor_if_excluded_miss, 0.42857143);
assert.ok(Number.isFinite(summary.overall.mean_log_bias));
assert.ok(Number.isFinite(summary.overall.median_relative_interval_width));
assert.ok(Number.isFinite(summary.overall.median_absolute_interval_width_usd));
assert.ok(Number.isFinite(summary.overall.mean_log_space_interval_score));
assert.equal(summary.by_participant.length, 4);
assert.equal(summary.by_forecast_version.length, 2);
assert.equal(summary.by_task_class.length, 3);
summary.by_participant.forEach(group => assert.equal(group.summary.paired_usable, 6));

const noPairs = Pilot.summarizeAttempts(pilotExports[0].attempts.filter(value => value.state !== "paired"));
assert.equal(noPairs.paired_usable, 0);
assert.equal(noPairs.within_p10_p90_rate, null);
assert.deepEqual(noPairs.within_p10_p90_wilson_95, {
  numerator: 0, denominator: 0, lower_bound: null, upper_bound: null,
});
assert.equal(noPairs.median_multiplicative_error, null);
assert.equal(noPairs.mean_log_space_interval_score, null);

let mixedInvalidation = addPaired(Pilot.createParticipant(1), CLASSES[0], 9, VERSIONS[0]);
mixedInvalidation = Pilot.invalidateAttempt(mixedInvalidation, 1, "data_entry_error");
let missingPrepared = setForecast(mixedInvalidation, CLASSES[1], VERSIONS[0]);
mixedInvalidation = Pilot.freezeDraft(missingPrepared.participant, missingPrepared.sequence);
mixedInvalidation = Pilot.invalidateAttempt(mixedInvalidation, missingPrepared.sequence, "actual_unavailable");
const mixedSummary = Pilot.summarizeAttempts(mixedInvalidation.attempts);
assert.equal(mixedSummary.forecasts_frozen, 2);
assert.equal(mixedSummary.paired_usable, 0);
assert.equal(mixedSummary.invalidated, 2);
assert.equal(mixedSummary.actual_missing, 1);
assert.equal(mixedSummary.analysis_excluded, 2);
assert.equal(mixedSummary.missing_actual_rate, 0.5);
assert.equal(mixedSummary.analysis_exclusion_rate, 1);
assert.equal(mixedSummary.coverage_floor_if_excluded_miss, 0);

console.log("TOP prospective pilot core, state-machine, export, and metric tests passed");
