"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const scriptStart = html.indexOf("(function initTopRoutes");
const scriptEnd = html.indexOf("})();", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "route-selector script must exist");
const routeSource = html.slice(scriptStart, scriptEnd + 5);

function makeLink(route, href) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, handler) { listeners[type] = handler; },
    getAttribute(name) {
      if (name === "href") return href;
      if (name === "data-route") return route;
      return null;
    },
  };
}

function makeHarness({ reducedMotion = false, missingTarget = false } = {}) {
  const yes = makeLink("yes", "#optimise");
  const no = makeLink("no", "#topos");
  const status = { textContent: "Yes skips ahead. No starts with the road infrastructure." };
  const calls = { scroll: [], focus: [], history: [] };
  const targets = {
    optimise: {
      scrollIntoView(options) { calls.scroll.push(["optimise", options]); },
      focus(options) { calls.focus.push(["optimise", options]); },
    },
    topos: {
      scrollIntoView(options) { calls.scroll.push(["topos", options]); },
      focus(options) { calls.focus.push(["topos", options]); },
    },
  };
  if (missingTarget) delete targets.optimise;

  const document = {
    querySelectorAll(selector) {
      assert.equal(selector, "[data-route]");
      return [yes, no];
    },
    getElementById(id) {
      if (id === "route-status") return status;
      return targets[id] || null;
    },
  };
  const window = {
    matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: reducedMotion };
    },
    history: {
      replaceState(...args) { calls.history.push(args); },
    },
  };

  vm.runInNewContext(routeSource, { document, window, Array }, { filename: "top-routes-inline.js" });
  return { yes, no, status, calls };
}

function click(link) {
  let prevented = false;
  assert.equal(typeof link.listeners.click, "function", "route link must receive a click listener");
  link.listeners.click({ preventDefault() { prevented = true; } });
  return prevented;
}

test("Yes jumps directly to Icarus, Daedalus and Athena", () => {
  const harness = makeHarness();
  assert.equal(click(harness.yes), true);
  assert.equal(harness.calls.scroll[0][0], "optimise");
  assert.equal(harness.calls.scroll[0][1].behavior, "smooth");
  assert.equal(harness.calls.scroll[0][1].block, "start");
  assert.equal(harness.calls.focus[0][0], "optimise");
  assert.equal(harness.calls.focus[0][1].preventScroll, true);
  assert.deepEqual(harness.calls.history, [[null, "", "#optimise"]]);
  assert.equal(harness.status.textContent, "Yes route selected. Moving to Icarus, Daedalus and Athena.");
});

test("No jumps to the TopOS road infrastructure", () => {
  const harness = makeHarness();
  assert.equal(click(harness.no), true);
  assert.equal(harness.calls.scroll[0][0], "topos");
  assert.equal(harness.calls.scroll[0][1].behavior, "smooth");
  assert.equal(harness.calls.scroll[0][1].block, "start");
  assert.equal(harness.calls.focus[0][0], "topos");
  assert.equal(harness.calls.focus[0][1].preventScroll, true);
  assert.deepEqual(harness.calls.history, [[null, "", "#topos"]]);
  assert.equal(harness.status.textContent, "No route selected. Moving to the TopOS road infrastructure.");
});

test("reduced-motion visitors jump without smooth scrolling", () => {
  const harness = makeHarness({ reducedMotion: true });
  click(harness.yes);
  assert.equal(harness.calls.scroll[0][1].behavior, "auto");
});

test("a missing enhancement target leaves the native anchor unblocked", () => {
  const harness = makeHarness({ missingTarget: true });
  assert.equal(click(harness.yes), false);
  assert.deepEqual(harness.calls.scroll, []);
  assert.deepEqual(harness.calls.focus, []);
  assert.deepEqual(harness.calls.history, []);
});

test("route enhancement performs no network or storage work", () => {
  assert.doesNotMatch(routeSource, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|localStorage|sessionStorage/);
});

const audienceStart = html.indexOf("(function initAudienceIndex");
const audienceEnd = html.indexOf("})();", audienceStart);
assert.ok(audienceStart >= 0 && audienceEnd > audienceStart, "audience-index script must exist");
const audienceSource = html.slice(audienceStart, audienceEnd + 5);

function makeAudienceLink(audience, offsetLeft, offsetWidth, current = false) {
  const attrs = { "data-audience-link": audience };
  const listeners = {};
  if (current) attrs["aria-current"] = "page";
  return {
    attrs,
    listeners,
    offsetLeft,
    offsetWidth,
    addEventListener(type, handler) { listeners[type] = handler; },
    getAttribute(name) { return attrs[name] || null; },
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
  };
}

function makeAudienceHarness(initialHash = "#engineering") {
  const business = makeAudienceLink("business", 0, 150, true);
  const engineering = makeAudienceLink("engineering", 158, 148);
  const partners = makeAudienceLink("partners", 314, 184);
  const links = [business, engineering, partners];
  const events = {};
  const calls = { scroll: [] };
  const rail = {
    scrollWidth: 528,
    clientWidth: 280,
    scrollTo(options) { calls.scroll.push(options); },
  };
  const document = {
    querySelector(selector) {
      assert.equal(selector, ".audience-inner");
      return rail;
    },
    querySelectorAll(selector) {
      if (selector === "[data-audience-link]") return links;
      if (selector === "[data-audience-section]") return [];
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
  const window = {
    location: { hash: initialHash },
    addEventListener(type, handler) { events[type] = handler; },
  };

  vm.runInNewContext(audienceSource, { document, window, Array, Math },
    { filename: "audience-index-inline.js" });
  return { business, engineering, partners, events, calls, window };
}

test("audience index reflects a direct Engineering or Partners route", () => {
  const harness = makeAudienceHarness("#engineering");
  assert.equal(harness.business.getAttribute("aria-current"), null);
  assert.equal(harness.engineering.getAttribute("aria-current"), "page");
  assert.equal(harness.calls.scroll.length, 1);

  harness.partners.listeners.click();
  assert.equal(harness.engineering.getAttribute("aria-current"), null);
  assert.equal(harness.partners.getAttribute("aria-current"), "page");

  harness.window.location.hash = "#business";
  harness.events.hashchange();
  assert.equal(harness.partners.getAttribute("aria-current"), null);
  assert.equal(harness.business.getAttribute("aria-current"), "page");
});

test("audience-index enhancement performs no network or storage work", () => {
  assert.doesNotMatch(audienceSource, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|localStorage|sessionStorage/);
});

const valueFunctionsStart = html.indexOf("function vmScenarioAmount");
const valueModelStart = html.indexOf("(function initValueModel");
const valueModelEnd = html.indexOf("})();", valueModelStart);
assert.ok(valueFunctionsStart >= 0 && valueModelEnd > valueModelStart,
  "the compact value-model script must exist");
const valueSource = html.slice(valueFunctionsStart, valueModelEnd + 5);

function makeValueHarness() {
  const listeners = {};
  const attrs = {};
  function drawable() {
    return {
      attrs: {},
      setAttribute(name, value) { this.attrs[name] = value; },
    };
  }
  const elements = {
    "vm-scenario": {
      value: "0",
      addEventListener(type, handler) { listeners[type] = handler; },
      setAttribute(name, value) { attrs[name] = value; },
    },
    "vm-cost-path": drawable(),
    "vm-value-path": drawable(),
    "vm-cost-label": drawable(),
    "vm-value-label": drawable(),
    "vm-scenario-output": { textContent: "" },
  };
  const document = {
    getElementById(id) { return elements[id] || null; },
  };
  vm.runInNewContext(valueSource, { document, Math, Number, Array },
    { filename: "value-model-inline.js" });
  return { elements, attrs, listeners };
}

test("illustrative graph slider updates both paths and its accessible label", () => {
  const harness = makeValueHarness();
  const initialCost = harness.elements["vm-cost-path"].attrs.points;
  const initialValue = harness.elements["vm-value-path"].attrs.points;
  assert.equal(harness.elements["vm-scenario-output"].textContent, "Lower cost path");
  assert.match(harness.attrs["aria-valuetext"], /lower illustrative AI cost/);

  harness.elements["vm-scenario"].value = "1";
  harness.listeners.input();
  assert.equal(harness.elements["vm-scenario-output"].textContent, "Higher value path");
  assert.match(harness.attrs["aria-valuetext"], /higher invented output-value path/);
  assert.notEqual(harness.elements["vm-cost-path"].attrs.points, initialCost);
  assert.notEqual(harness.elements["vm-value-path"].attrs.points, initialValue);
});

test("value-model enhancement performs no network or storage work", () => {
  assert.doesNotMatch(valueSource, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|localStorage|sessionStorage/);
});

const routeMapStart = html.indexOf("(function initRouteMap");
const routeMapEnd = html.indexOf("})();", routeMapStart);
assert.ok(routeMapStart >= 0 && routeMapEnd > routeMapStart, "route-map script must exist");
const routeMapSource = html.slice(routeMapStart, routeMapEnd + 5);

function makeClassList() {
  const values = new Set();
  return {
    values,
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      if (force === undefined) {
        if (values.has(name)) values.delete(name);
        else values.add(name);
        return values.has(name);
      }
      if (force) values.add(name);
      else values.delete(name);
      return force;
    },
  };
}

function makeMediaQuery(matches) {
  const listeners = [];
  return {
    matches,
    addEventListener(type, handler) {
      assert.equal(type, "change");
      listeners.push(handler);
    },
    addListener(handler) {
      listeners.push(handler);
    },
    setMatches(nextMatches) {
      this.matches = nextMatches;
      listeners.forEach((handler) => handler({ matches: nextMatches }));
    },
  };
}

function makeMapLink(key, text) {
  const attrs = { "data-route-map-link": key, href: `#${key}` };
  const listeners = {};
  return {
    attrs,
    listeners,
    textContent: text,
    addEventListener(type, handler) { listeners[type] = handler; },
    getAttribute(name) { return attrs[name] || null; },
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
    appendChild(child) { this.child = child; },
  };
}

function makeRouteMapHarness({
  compact = false,
  initialHash = "#business",
  observeParent = false,
} = {}) {
  const business = makeMapLink("business", "TOP Introduction");
  const daedalus = makeMapLink("daedalus", "Daedalus More efficient engine");
  const roadmap = makeMapLink("roadmap", "Website road map Future routes");
  const links = [business, daedalus, roadmap];
  const classes = makeClassList();
  const listeners = {};
  const calls = { scroll: [], focus: [], history: [], progress: [], observed: [] };
  const nav = { style: { setProperty(name, value) { calls.progress.push([name, value]); } } };
  const car = {};
  function controlElement() {
    const attrs = {};
    const ownListeners = {};
    return {
      attrs,
      ownListeners,
      inert: false,
      textContent: "",
      addEventListener(type, handler) { ownListeners[type] = handler; },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
      },
      hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attrs, name);
      },
      setAttribute(name, value) {
        attrs[name] = String(value);
        if (name === "inert") this.inert = true;
      },
      removeAttribute(name) {
        delete attrs[name];
        if (name === "inert") this.inert = false;
      },
      toggleAttribute(name, force) {
        const enabled = force === undefined ? !this.hasAttribute(name) : force;
        if (enabled) this.setAttribute(name, "");
        else this.removeAttribute(name);
        return enabled;
      },
      focus() { calls.focus.push(["control"]); },
    };
  }
  const trigger = controlElement();
  const control = controlElement();
  const panel = controlElement();
  const target = {
    scrollIntoView(options) { calls.scroll.push(options); },
    focus(options) { calls.focus.push(["target", options]); },
  };
  const optimiseSection = {
    id: "optimise",
    getAttribute(name) {
      assert.equal(name, "data-route-map-section");
      return "optimise";
    },
  };
  const sections = observeParent ? [optimiseSection] : [];
  const events = {};
  const document = {
    documentElement: { classList: classes },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "[data-route-map-link]") return links;
      if (selector === "[data-route-map-section]") return sections;
      throw new Error(`unexpected selector: ${selector}`);
    },
    getElementById(id) {
      if (id === "route-map-nav") return nav;
      if (id === "route-car") return car;
      if (id === "route-map-trigger") return trigger;
      if (id === "route-map-control") return control;
      if (id === "route-map-panel") return panel;
      if (id === "daedalus") return target;
      return null;
    },
    addEventListener(type, handler) { events[type] = handler; },
  };
  const compactQuery = makeMediaQuery(compact);
  const reducedMotionQuery = makeMediaQuery(false);
  let observer = null;
  const window = {
    location: { hash: initialHash },
    matchMedia(query) {
      if (query === "(max-width: 1120px)") return compactQuery;
      if (query === "(prefers-reduced-motion: reduce)") return reducedMotionQuery;
      throw new Error(`unexpected media query: ${query}`);
    },
    addEventListener(type, handler) { events[type] = handler; },
    history: { replaceState(...args) { calls.history.push(args); } },
  };
  if (observeParent) {
    window.IntersectionObserver = function IntersectionObserver(callback, options) {
      observer = { callback, options };
      this.observe = (section) => calls.observed.push(section);
    };
  }
  vm.runInNewContext(routeMapSource, { document, window, Array, Math },
    { filename: "route-map-inline.js" });
  return {
    business,
    daedalus,
    roadmap,
    classes,
    calls,
    trigger,
    control,
    panel,
    events,
    compactQuery,
    observer,
    optimiseSection,
  };
}

test("route map moves its current marker and navigates to a selected product", () => {
  const harness = makeRouteMapHarness();
  assert.equal(harness.business.getAttribute("aria-current"), "location");
  assert.ok(harness.business.child, "the pixel car must start at TOP");

  let prevented = false;
  harness.daedalus.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(harness.business.getAttribute("aria-current"), null);
  assert.equal(harness.daedalus.getAttribute("aria-current"), "location");
  assert.ok(harness.daedalus.child, "the pixel car must move to the selected product");
  assert.equal(harness.calls.scroll[0].block, "start");
  assert.deepEqual(harness.calls.history, [[null, "", "#daedalus"]]);
});

test("compact route map opens as a drawer and closes with Escape", () => {
  const harness = makeRouteMapHarness({ compact: true });
  harness.trigger.ownListeners.click();
  assert.equal(harness.classes.contains("route-map-open"), true);
  assert.equal(harness.trigger.attrs["aria-expanded"], "true");

  harness.events.keydown({ key: "Escape" });
  assert.equal(harness.classes.contains("route-map-open"), false);
  assert.equal(harness.trigger.attrs["aria-expanded"], "false");
});

test("closed compact route map is removed from the accessibility tree and tab order", () => {
  const harness = makeRouteMapHarness({ compact: true });
  assert.equal(harness.panel.inert, true);
  assert.equal(harness.panel.getAttribute("aria-hidden"), "true");

  harness.trigger.ownListeners.click();
  assert.equal(harness.panel.inert, false);
  assert.notEqual(harness.panel.getAttribute("aria-hidden"), "true");

  harness.events.keydown({ key: "Escape" });
  assert.equal(harness.panel.inert, true);
  assert.equal(harness.panel.getAttribute("aria-hidden"), "true");
});

test("route map reconciles drawer and expanded state across its breakpoint", () => {
  const harness = makeRouteMapHarness({ compact: true });
  harness.trigger.ownListeners.click();
  assert.equal(harness.classes.contains("route-map-open"), true);

  harness.compactQuery.setMatches(false);
  assert.equal(harness.classes.contains("route-map-open"), false);
  assert.equal(harness.panel.inert, false);
  assert.notEqual(harness.panel.getAttribute("aria-hidden"), "true");
  assert.equal(harness.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.control.getAttribute("aria-expanded"), "false");
  assert.equal(harness.control.getAttribute("aria-label"), "Expand route map");

  harness.control.ownListeners.click();
  assert.equal(harness.classes.contains("route-map-expanded"), true);
  harness.compactQuery.setMatches(true);
  assert.equal(harness.classes.contains("route-map-expanded"), false);
  assert.equal(harness.panel.inert, true);
  assert.equal(harness.panel.getAttribute("aria-hidden"), "true");
  assert.equal(harness.control.getAttribute("aria-expanded"), "false");
});

test("a direct product hash survives intersection from its parent product section", () => {
  const harness = makeRouteMapHarness({
    initialHash: "#daedalus",
    observeParent: true,
  });
  assert.equal(harness.daedalus.getAttribute("aria-current"), "location");
  assert.equal(harness.calls.observed[0], harness.optimiseSection);

  harness.observer.callback([{
    isIntersecting: true,
    boundingClientRect: { top: 0 },
    target: harness.optimiseSection,
  }]);
  assert.equal(harness.daedalus.getAttribute("aria-current"), "location");
  assert.equal(harness.business.getAttribute("aria-current"), null);
});

test("Escape resets the desktop expanded control state", () => {
  const harness = makeRouteMapHarness();
  harness.control.ownListeners.click();
  assert.equal(harness.classes.contains("route-map-expanded"), true);
  assert.equal(harness.control.getAttribute("aria-expanded"), "true");

  harness.events.keydown({ key: "Escape" });
  assert.equal(harness.classes.contains("route-map-expanded"), false);
  assert.equal(harness.control.getAttribute("aria-expanded"), "false");
  assert.equal(harness.control.getAttribute("aria-label"), "Expand route map");
});

test("historical analyzer is a focusable route-map destination", () => {
  assert.match(
    html,
    /<div(?=[^>]*\bid="historical-analyzer")(?=[^>]*\btabindex="-1")[^>]*>/,
  );
});

test("route-map enhancement performs no network or storage work", () => {
  assert.doesNotMatch(routeMapSource, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|localStorage|sessionStorage/);
});

const motionStart = html.indexOf("(function initMotionControl");
const motionEnd = html.indexOf("})();", motionStart);
assert.ok(motionStart >= 0 && motionEnd > motionStart, "motion-control script must exist");
const motionSource = html.slice(motionStart, motionEnd + 5);

function makeMotionHarness(reducedMotion) {
  const classes = makeClassList();
  const attrs = {};
  const listeners = {};
  const button = {
    addEventListener(type, handler) { listeners[type] = handler; },
    setAttribute(name, value) { attrs[name] = value; },
  };
  const status = { textContent: "" };
  const document = {
    documentElement: { classList: classes },
    getElementById(id) {
      if (id === "motion-toggle") return button;
      if (id === "motion-status") return status;
      return null;
    },
  };
  const window = {
    matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: reducedMotion };
    },
  };
  vm.runInNewContext(motionSource, { document, window, Boolean },
    { filename: "motion-control-inline.js" });
  return { attrs, listeners, classes, status };
}

test("T control respects reduced motion and can explicitly resume", () => {
  const harness = makeMotionHarness(true);
  assert.equal(harness.classes.contains("motion-paused"), true);
  assert.equal(harness.classes.contains("motion-user-enabled"), false);
  assert.equal(harness.attrs["aria-pressed"], "true");
  assert.equal(harness.attrs["aria-label"], "Resume route-map animation");

  harness.listeners.click();
  assert.equal(harness.classes.contains("motion-paused"), false);
  assert.equal(harness.classes.contains("motion-user-enabled"), true);
  assert.equal(harness.attrs["aria-pressed"], "false");
  assert.equal(harness.attrs["aria-label"], "Pause route-map animation");
});

test("explicit resume overrides the reduced-motion animation rule", () => {
  assert.match(
    html,
    /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.motion-user-enabled\s+\.route-car\s*\{[^}]*animation:[^;}]*route-car-idle[^;}]*!important[^}]*\}/,
  );
});

test("motion-control enhancement performs no network or storage work", () => {
  assert.doesNotMatch(motionSource, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|localStorage|sessionStorage/);
});
