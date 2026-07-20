(function () {
  "use strict";

  var Pilot = window.TOPProspectivePilot;
  if (!Pilot) return;

  var taskClassLabels = {
    software_build: "Software build",
    data_analysis: "Data analysis",
    research_synthesis: "Research synthesis",
    written_communication: "Written communication",
    planning_decision: "Planning or decision",
    operations_workflow: "Operations workflow"
  };
  var versionLabels = {
    top_v1_task_only: "TOP v1, task only",
    top_v1_project_history_blend: "TOP v1, task plus project history",
    comparison_baseline: "Comparison baseline"
  };
  var reasonLabels = {
    task_abandoned: "Task abandoned",
    actual_unavailable: "Actual cost unavailable",
    task_changed_after_freeze: "Task changed after forecast freeze",
    forecast_recorded_after_task_started: "Forecast recorded after task started",
    data_entry_error: "Data entry error",
    duplicate_attempt: "Duplicate attempt",
    protocol_interruption: "Protocol interruption"
  };
  var storagePrefix = "top.prospective-pilot.v1.slot.";
  var currentParticipant = null;
  var currentSlot = null;
  var draftStep = 0;
  var pendingRestore = null;
  var pendingInvalidation = null;

  function byId(id) { return document.getElementById(id); }
  function showOnly(id) {
    ["roleScreen", "participantScreen", "coordinatorScreen"].forEach(function (screen) { byId(screen).hidden = screen !== id; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function setError(message) { byId("questionError").textContent = message || ""; }
  function humanError(error) {
    var labels = {
      forecast_percentiles_must_be_ordered: "Use positive values with P10 no higher than P50, and P50 no higher than P90.",
      task_class_mix_would_be_impossible: "Choose a new task class now. This slot still needs at least three classes across six usable tasks.",
      participant_target_already_met: "This participant slot already has six usable tasks.",
      open_attempt_exists: "Finish or invalidate the current frozen attempt first.",
      invalid_actual_value: "Enter a positive actual dollar cost.",
      invalid_json: "That file is not valid JSON.",
      duplicate_participant_slot: "Choose only one latest file for each participant slot.",
      invalid_export_count: "Choose between one and four participant files.",
      study_contract_mismatch: "That file uses a different pilot contract.",
      unsupported_schema_version: "That file is not a top.prospective-pilot.v1 export."
    };
    return labels[error && error.message] || "That action did not pass the frozen pilot rules.";
  }
  function storageKey(slot) { return storagePrefix + slot; }
  function saveCurrent() {
    if (!currentParticipant) return;
    var exported = Pilot.toExport(currentParticipant);
    try {
      localStorage.setItem(storageKey(currentParticipant.participant_slot), JSON.stringify(exported));
      byId("backupStatus").textContent = "Saved in this browser. Download a pilot file as a second local copy.";
    } catch (error) {
      byId("backupStatus").textContent = "Browser backup was unavailable. Download the pilot file now.";
    }
  }
  function loadSlot(slot) {
    var raw = null;
    try { raw = localStorage.getItem(storageKey(slot)); } catch (error) { raw = null; }
    if (!raw) return Pilot.createParticipant(slot);
    try { return Pilot.exportToParticipant(Pilot.parseExport(raw)); }
    catch (error) {
      byId("backupStatus").textContent = "The browser backup failed validation. A fresh local slot was opened. Your downloaded pilot files are unchanged.";
      return Pilot.createParticipant(slot);
    }
  }
  function downloadJSON(value, filename) {
    var blob = new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function formatMoney(value) {
    if (value === null || value === undefined) return "Not recorded";
    if (value < 0.01) return "$" + value.toFixed(4);
    return "$" + value.toFixed(2);
  }
  function percent(value) { return value === null ? "Not available" : (value * 100).toFixed(1) + "%"; }
  function percentRange(interval) {
    if (!interval || interval.lower_bound === null || interval.upper_bound === null) return "Not available";
    return percent(interval.lower_bound) + " to " + percent(interval.upper_bound);
  }
  function fixed(value, digits) { return value === null ? "Not available" : Number(value).toFixed(digits); }
  function activeAttempt() {
    if (!currentParticipant || !currentParticipant.attempts.length) return null;
    var latest = currentParticipant.attempts[currentParticipant.attempts.length - 1];
    return latest.state === "draft" || latest.state === "frozen" ? latest : null;
  }

  function makeOptions(values, labels, selected, onChoose) {
    var list = document.createElement("div");
    list.className = "option-list";
    values.forEach(function (value) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.setAttribute("aria-pressed", value === selected ? "true" : "false");
      button.textContent = labels[value];
      button.addEventListener("click", function () { onChoose(value); });
      list.appendChild(button);
    });
    return list;
  }
  function numericControl(id, label, value, help) {
    var wrap = document.createElement("div");
    wrap.className = "numeric-field";
    var fieldLabel = document.createElement("label");
    fieldLabel.htmlFor = id;
    fieldLabel.textContent = label;
    var input = document.createElement("input");
    input.id = id;
    input.type = "number";
    input.min = "0.000001";
    input.step = "0.0001";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    if (value !== null) input.value = String(value);
    var small = document.createElement("small");
    small.textContent = help;
    wrap.append(fieldLabel, input, small);
    return wrap;
  }
  function clearControls() {
    var controls = byId("questionControls");
    while (controls.firstChild) controls.removeChild(controls.firstChild);
    return controls;
  }
  function setQuestion(step, title, help, backVisible, nextLabel, nextHandler) {
    byId("questionStep").textContent = step;
    byId("questionTitle").textContent = title;
    byId("questionHelp").textContent = help || "";
    byId("questionBack").textContent = "Previous";
    byId("questionBack").hidden = !backVisible;
    byId("questionNext").textContent = nextLabel;
    byId("questionNext").onclick = nextHandler;
    setError("");
  }
  function applyDraftPatch(attempt, patch) {
    try {
      currentParticipant = Pilot.updateDraft(currentParticipant, attempt.attempt_sequence, patch);
      saveCurrent();
      renderParticipant();
    } catch (error) { setError(humanError(error)); }
  }
  function numericValue(id) {
    var value = Number(byId(id).value);
    if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_forecast_value");
    return value;
  }

  function renderDraft(attempt) {
    var controls = clearControls();
    var steps = 6;
    byId("questionBack").onclick = function () { if (draftStep > 0) { draftStep -= 1; renderParticipant(); } };
    if (draftStep === 0) {
      setQuestion("Question 1 of " + steps, "Which kind of task is this?", "Choose one fixed class. Do not enter a task title or description.", false, "Continue", function () {
        if (!attempt.task_class) return setError("Choose one task class.");
        draftStep = 1; renderParticipant();
      });
      controls.appendChild(makeOptions(Pilot.TASK_CLASSES, taskClassLabels, attempt.task_class, function (value) {
        applyDraftPatch(attempt, { task_class: value });
      }));
    } else if (draftStep === 1) {
      setQuestion("Question 2 of " + steps, "Which forecast version made these numbers?", "Use the version assigned before this task. The coordinator reports every version separately.", true, "Continue", function () {
        if (!attempt.forecast_version) return setError("Choose one forecast version.");
        draftStep = 2; renderParticipant();
      });
      controls.appendChild(makeOptions(Pilot.FORECAST_VERSIONS, versionLabels, attempt.forecast_version, function (value) {
        applyDraftPatch(attempt, { forecast_version: value });
      }));
    } else if (draftStep === 2) {
      setQuestion("Question 3 of " + steps, "What is the P10 API-rate equivalent?", "Enter the low forecast in US dollars before starting the task. This is not a subscription bill.", true, "Continue", function () {
        try { currentParticipant = Pilot.updateDraft(currentParticipant, attempt.attempt_sequence, { p10_usd: numericValue("forecastValue") }); saveCurrent(); draftStep = 3; renderParticipant(); }
        catch (error) { setError("Enter a positive dollar value."); }
      });
      controls.appendChild(numericControl("forecastValue", "P10 API-rate equivalent in USD", attempt.p10_usd, "About one task in ten should finish below this value if the forecast is calibrated."));
    } else if (draftStep === 3) {
      setQuestion("Question 4 of " + steps, "What is the P50 API-rate equivalent?", "Enter the middle forecast in US dollars before starting the task. This is not a subscription bill.", true, "Continue", function () {
        try { currentParticipant = Pilot.updateDraft(currentParticipant, attempt.attempt_sequence, { p50_usd: numericValue("forecastValue") }); saveCurrent(); draftStep = 4; renderParticipant(); }
        catch (error) { setError("Enter a positive dollar value."); }
      });
      controls.appendChild(numericControl("forecastValue", "P50 API-rate equivalent in USD", attempt.p50_usd, "Half of comparable tasks should finish at or below this value if calibrated."));
    } else if (draftStep === 4) {
      setQuestion("Question 5 of " + steps, "What is the P90 API-rate equivalent?", "Enter the high forecast in US dollars before starting the task. This is not a subscription bill.", true, "Review forecast", function () {
        try { currentParticipant = Pilot.updateDraft(currentParticipant, attempt.attempt_sequence, { p90_usd: numericValue("forecastValue") }); saveCurrent(); draftStep = 5; renderParticipant(); }
        catch (error) { setError("Enter a positive dollar value."); }
      });
      controls.appendChild(numericControl("forecastValue", "P90 API-rate equivalent in USD", attempt.p90_usd, "About nine tasks in ten should finish at or below this value if calibrated."));
    } else {
      setQuestion("Question 6 of " + steps, "Freeze this forecast before the task starts", "After freezing, none of these fields can be edited. A correction requires invalidation and a replacement attempt.", true, "Freeze forecast", function () {
        try {
          currentParticipant = Pilot.freezeDraft(currentParticipant, attempt.attempt_sequence);
          saveCurrent();
          renderParticipant();
        } catch (error) { setError(humanError(error)); }
      });
      var review = document.createElement("div");
      review.className = "review-grid";
      [
        ["Task class", taskClassLabels[attempt.task_class] || "Not chosen"],
        ["Forecast version", versionLabels[attempt.forecast_version] || "Not chosen"],
        ["P10", formatMoney(attempt.p10_usd)],
        ["P50", formatMoney(attempt.p50_usd)],
        ["P90", formatMoney(attempt.p90_usd)]
      ].forEach(function (item) {
        var row = document.createElement("div");
        row.className = "review-row";
        var label = document.createElement("span"); label.textContent = item[0];
        var value = document.createElement("strong"); value.textContent = item[1];
        row.append(label, value); review.appendChild(row);
      });
      controls.appendChild(review);
    }
  }

  function renderFrozen(attempt) {
    var controls = clearControls();
    setQuestion("After the task", "What was the measured API-rate equivalent?", "The P10, P50 and P90 values are frozen. Enter the measured result only after the task is complete. This is not a subscription bill.", false, "Pair actual with forecast", function () {
      try {
        currentParticipant = Pilot.pairAttempt(currentParticipant, attempt.attempt_sequence, numericValue("actualValue"));
        saveCurrent();
        renderParticipant();
      } catch (error) { setError(humanError(error)); }
    });
    controls.appendChild(numericControl("actualValue", "Measured API-rate equivalent in USD", null, "Use the same pricing basis used by the forecast."));
    var invalid = document.createElement("button");
    invalid.type = "button";
    invalid.className = "warning-button";
    invalid.textContent = "Actual missing, task abandoned, or protocol broken";
    invalid.addEventListener("click", function () { pendingInvalidation = attempt.attempt_sequence; renderParticipant(); });
    controls.appendChild(invalid);
  }

  function renderInvalidation() {
    var controls = clearControls();
    setQuestion("Retain, invalidate, replace", "Why can this attempt not be used?", "The original frozen values remain in the export. No free-text explanation is collected.", true, "Invalidate and create replacement", function () {
      var reason = byId("invalidationReason").value;
      if (!reason) return setError("Choose one fixed reason.");
      try {
        currentParticipant = Pilot.invalidateAttempt(currentParticipant, pendingInvalidation, reason);
        currentParticipant = Pilot.replaceInvalidated(currentParticipant, pendingInvalidation);
        pendingInvalidation = null;
        draftStep = 0;
        saveCurrent();
        renderParticipant();
      } catch (error) { setError(humanError(error)); }
    });
    byId("questionBack").textContent = "Cancel";
    byId("questionBack").onclick = function () { pendingInvalidation = null; renderParticipant(); };
    var wrap = document.createElement("div");
    wrap.className = "reason-field";
    var label = document.createElement("label");
    label.htmlFor = "invalidationReason";
    label.textContent = "Fixed invalidation reason";
    var select = document.createElement("select");
    select.id = "invalidationReason";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose one";
    select.appendChild(placeholder);
    Pilot.INVALIDATION_REASONS.forEach(function (reason) {
      var option = document.createElement("option");
      option.value = reason;
      option.textContent = reasonLabels[reason];
      select.appendChild(option);
    });
    var small = document.createElement("small");
    small.textContent = "Invalidated attempts stay in every export and remain in attrition and missingness denominators.";
    wrap.append(label, select, small);
    controls.appendChild(wrap);
  }

  function renderReady() {
    clearControls();
    var status = Pilot.progress(currentParticipant);
    if (status.target_met) {
      setQuestion("Participant complete", "Six usable tasks are paired", "This slot also includes at least three task classes. Download the latest pilot file for the coordinator.", false, "Download final pilot file", function () {
        downloadJSON(Pilot.toExport(currentParticipant), "top-prospective-pilot-participant-" + currentSlot + ".json");
        byId("backupStatus").textContent = "Latest task-text-free structured pilot file downloaded.";
      });
      return;
    }
    setQuestion("Ready", "Start the next task", "Record the forecast before any work begins. A usable task counts only after its actual cost is paired.", false, "Start next task", function () {
      try {
        currentParticipant = Pilot.startDraft(currentParticipant);
        draftStep = 0;
        saveCurrent();
        renderParticipant();
      } catch (error) { setError(humanError(error)); }
    });
  }

  function renderAttempts() {
    var list = byId("attemptList");
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!currentParticipant.attempts.length) {
      var empty = document.createElement("span");
      empty.textContent = "No attempts yet.";
      list.appendChild(empty);
      return;
    }
    var hasOpen = !!activeAttempt();
    currentParticipant.attempts.slice().reverse().forEach(function (attempt) {
      var row = document.createElement("div");
      row.className = "attempt-row";
      var top = document.createElement("div");
      top.className = "attempt-row-top";
      var title = document.createElement("strong");
      title.textContent = "Attempt " + attempt.attempt_sequence;
      var state = document.createElement("span");
      state.textContent = attempt.state;
      top.append(title, state);
      var detail = document.createElement("span");
      detail.textContent = (attempt.task_class ? taskClassLabels[attempt.task_class] : "Draft not classified") +
        (attempt.p50_usd ? " | P50 " + formatMoney(attempt.p50_usd) : "") +
        (attempt.actual_usd ? " | actual " + formatMoney(attempt.actual_usd) : "") +
        (attempt.invalidation_reason ? " | " + reasonLabels[attempt.invalidation_reason] : "");
      row.append(top, detail);
      if (attempt.state === "paired" && !hasOpen) {
        var invalidate = document.createElement("button");
        invalidate.type = "button";
        invalidate.textContent = "Invalidate and replace";
        invalidate.addEventListener("click", function () { pendingInvalidation = attempt.attempt_sequence; renderParticipant(); });
        row.appendChild(invalidate);
      }
      list.appendChild(row);
    });
  }

  function renderParticipant() {
    if (!currentParticipant) return;
    var status = Pilot.progress(currentParticipant);
    byId("participantStatus").textContent = "Participant slot " + currentSlot;
    byId("taskProgress").textContent = status.paired_usable_tasks + " of " + Pilot.TARGET_USABLE_TASKS + " usable tasks";
    byId("classProgress").textContent = status.distinct_task_classes + " of " + Pilot.MINIMUM_TASK_CLASSES + " task classes";
    byId("progressBar").style.width = Math.min(100, (status.paired_usable_tasks / Pilot.TARGET_USABLE_TASKS) * 100) + "%";
    byId("participantWorkspace").hidden = false;
    byId("slotChooser").hidden = true;
    renderAttempts();
    if (pendingInvalidation !== null) return renderInvalidation();
    var active = activeAttempt();
    if (!active) return renderReady();
    if (active.state === "draft") renderDraft(active);
    else renderFrozen(active);
  }

  function chooseSlot(slot) {
    currentSlot = slot;
    currentParticipant = loadSlot(slot);
    pendingInvalidation = null;
    draftStep = 0;
    var active = activeAttempt();
    if (active && active.state === "draft") {
      if (active.p90_usd !== null) draftStep = 5;
      else if (active.p50_usd !== null) draftStep = 4;
      else if (active.p10_usd !== null) draftStep = 3;
      else if (active.forecast_version) draftStep = 2;
      else if (active.task_class) draftStep = 1;
    }
    renderParticipant();
  }

  function renderMetricCards(summary) {
    var target = byId("overallMetrics");
    while (target.firstChild) target.removeChild(target.firstChild);
    [
      ["Paired usable", summary.paired_usable + " / " + summary.forecasts_frozen, "actuals / frozen forecasts"],
      ["Frozen forecasts", String(summary.forecasts_frozen), "recorded before actual cost"],
      ["Invalidated attempts", String(summary.invalidated), "fixed reasons retained"],
      ["Missing actuals", String(summary.actual_missing), "frozen attempts without a paired actual"],
      ["Excluded records", String(summary.analysis_excluded), "retained but excluded from research analysis"],
      ["Public performance report", "Withheld", "TOP-1 remains research"]
    ].forEach(function (item) {
      var card = document.createElement("div");
      card.className = "metric-card";
      var label = document.createElement("span"); label.textContent = item[0];
      var value = document.createElement("strong"); value.textContent = item[1];
      var note = document.createElement("span"); note.textContent = item[2];
      card.append(label, value, note); target.appendChild(card);
    });
  }
  function renderSplits(targetId, groups, labels) {
    var target = byId(targetId);
    while (target.firstChild) target.removeChild(target.firstChild);
    groups.forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "split-row";
      var label = document.createElement("strong");
      label.textContent = labels && labels[entry.group] ? labels[entry.group] : entry.group;
      var result = document.createElement("span");
      result.textContent = "n=" + entry.summary.paired_usable + " paired usable tasks; performance figures withheld";
      row.append(label, result); target.appendChild(row);
    });
  }
  function renderCoordinator(summary) {
    byId("coordinatorResults").hidden = false;
    byId("protocolBadge").textContent = summary.protocol_complete ? "24 structurally complete self-entered records" : "Incomplete pilot";
    byId("denominatorNote").textContent = summary.participants_imported + " of " + summary.participant_target + " participant slots imported. " +
      summary.overall.paired_usable + " paired usable tasks, " + summary.overall.invalidated + " invalidated attempts, and " +
      summary.overall.actual_missing + " frozen attempts without an actual. " + summary.overall.analysis_excluded +
      " frozen attempts are excluded from research analysis. No excluded or missing attempt was silently removed.";
    renderMetricCards(summary.overall);
    renderSplits("participantSplits", summary.by_participant, null);
    renderSplits("versionSplits", summary.by_forecast_version, versionLabels);
    renderSplits("classSplits", summary.by_task_class, taskClassLabels);
  }

  byId("participantRole").addEventListener("click", function () { showOnly("participantScreen"); });
  byId("coordinatorRole").addEventListener("click", function () { showOnly("coordinatorScreen"); });
  document.querySelectorAll('[data-action="home"]').forEach(function (button) {
    button.addEventListener("click", function () { showOnly("roleScreen"); });
  });

  Pilot.TARGET_PARTICIPANTS && Array.from({ length: Pilot.TARGET_PARTICIPANTS }, function (_, index) { return index + 1; }).forEach(function (slot) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "slot-button";
    button.textContent = "Participant " + slot;
    button.addEventListener("click", function () { chooseSlot(slot); });
    byId("slotButtons").appendChild(button);
  });

  byId("downloadBackup").addEventListener("click", function () {
    if (!currentParticipant) return;
    downloadJSON(Pilot.toExport(currentParticipant), "top-prospective-pilot-participant-" + currentSlot + ".json");
    byId("backupStatus").textContent = "Task-text-free structured pilot file downloaded. It contains every attempt, including drafts and invalidations.";
  });
  byId("chooseBackup").addEventListener("click", function () { byId("backupFile").click(); });
  byId("backupFile").addEventListener("change", async function () {
    pendingRestore = null;
    byId("restorePreview").hidden = true;
    if (!this.files || this.files.length !== 1) return;
    try {
      pendingRestore = Pilot.parseExport(await this.files[0].text());
      byId("restoreSummary").textContent = "Participant slot " + pendingRestore.participant_slot + ", " + pendingRestore.attempts.length +
        " attempts, " + pendingRestore.completeness.paired_usable_tasks + " paired usable tasks. Restore only if this is the intended latest copy.";
      byId("restorePreview").hidden = false;
      byId("backupStatus").textContent = "Backup structure checked. Nothing has been overwritten yet.";
    } catch (error) { byId("backupStatus").textContent = humanError(error); }
    this.value = "";
  });
  byId("confirmRestore").addEventListener("click", function () {
    if (!pendingRestore) return;
    currentSlot = pendingRestore.participant_slot;
    currentParticipant = Pilot.exportToParticipant(pendingRestore);
    pendingRestore = null;
    pendingInvalidation = null;
    draftStep = 0;
    byId("restorePreview").hidden = true;
    saveCurrent();
    renderParticipant();
  });

  byId("coordinatorFiles").addEventListener("change", async function () {
    byId("coordinatorError").textContent = "";
    byId("coordinatorResults").hidden = true;
    try {
      if (!this.files || this.files.length < 1 || this.files.length > Pilot.TARGET_PARTICIPANTS) throw new Error("invalid_export_count");
      var exports = await Promise.all(Array.from(this.files).map(async function (file) { return Pilot.parseExport(await file.text()); }));
      renderCoordinator(Pilot.coordinatorSummary(exports));
    } catch (error) { byId("coordinatorError").textContent = humanError(error); }
    this.value = "";
  });
})();
