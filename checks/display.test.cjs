"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../phosphor.js"), "utf8");

function receiverDisplay() {
  const counts = { reads: 0, paints: 0, resizes: 0 };
  const motion = { matches: false, addEventListener() {} };
  const document = { hidden: false, addEventListener() {} };
  let nextFrame;
  const Display = vm.runInNewContext(source + "\nPhosphor", {
    document, devicePixelRatio: 1, matchMedia: () => motion,
    ResizeObserver: class { observe() {} },
    requestAnimationFrame(callback) { nextFrame = callback; return 1; },
    cancelAnimationFrame() { nextFrame = null; }
  });
  const context = new Proxy({
    drawImage(...args) { if (args.length === 3) counts.paints++; }
  }, { get: (target, key) => target[key] || (() => {}) });
  function canvas() {
    return {
      clientWidth: 100, clientHeight: 25,
      get width() { return 100; }, set width(_) { counts.resizes++; },
      get height() { return 25; }, set height(_) { counts.resizes++; },
      getContext: () => context, getBoundingClientRect: () => ({width: 100, height: 25})
    };
  }
  const display = new Display(canvas(), canvas());
  const layer = { base: canvas(), plate: canvas() };
  Object.assign(display, layer, { sizeKey: "100/25/1" });
  for (let i = 0; i < 3; i++) display.layers.set(i, layer);
  display.sample = () => { counts.reads++; return { live: true, pulse: 0 }; };
  function advance(time) {
    const callback = nextFrame;
    nextFrame = null;
    callback(time);
  }
  return { display, counts, motion, document, advance, pending: () => Boolean(nextFrame) };
}

test("one waveform sample per painted frame, including the first paint", () => {
  const { display, counts, advance, pending } = receiverDisplay();
  display.tune(0);
  for (let i = 1; i <= 60; i++) advance(i * 1000 / 60);
  assert.equal(counts.paints, 31);
  assert.equal(counts.reads, counts.paints);
  display.sample = () => ({live: false, pulse: 0});
  advance(1100);
  assert.equal(pending(), false);
});

test("cached retunes keep the backing stores; reduced motion and hidden tabs sleep", () => {
  const { display, counts, motion, document, pending } = receiverDisplay();
  motion.matches = true;
  for (let i = 0; i < 30; i++) display.tune(i % 3);
  assert.deepEqual(counts, { reads: 0, paints: 30, resizes: 0 });
  assert.equal(pending(), false);
  document.hidden = true;
  display.refresh();
  assert.equal(counts.paints, 30);
  assert.equal(pending(), false);
});
