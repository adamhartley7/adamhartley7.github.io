const assert = require("node:assert/strict");
const physics = require("./assets/top-spin-physics.js");

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function quaternionLength(q) {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

const rect = { left: 0, top: 0, width: 300, height: 300 };
const center = physics.projectToTrackball(150, 150, rect);
const right = physics.projectToTrackball(220, 150, rect);
const up = physics.projectToTrackball(150, 80, rect);

const horizontal = physics.quaternionToAxisAngle(physics.quaternionFromUnitVectors(center, right));
assert.ok(Math.abs(horizontal.axis.y) > 0.99, "a horizontal drag must rotate around the Y axis");
assert.ok(horizontal.angle > 0, "a horizontal drag must create a real rotation");

const vertical = physics.quaternionToAxisAngle(physics.quaternionFromUnitVectors(center, up));
assert.ok(Math.abs(vertical.axis.x) > 0.99, "a vertical drag must rotate around the X axis");
assert.ok(vertical.angle > 0, "a vertical drag must create a real rotation");

const diagonalPoint = physics.projectToTrackball(220, 80, rect);
const diagonal = physics.quaternionToAxisAngle(physics.quaternionFromUnitVectors(center, diagonalPoint));
assert.ok(Math.abs(diagonal.axis.x) > 0.3 && Math.abs(diagonal.axis.y) > 0.3,
  "a diagonal drag must combine horizontal and vertical rotation");

const velocity = physics.angularVelocityFromQuaternion(physics.quaternionFromUnitVectors(center, right), 16);
const before = physics.identityQuaternion();
const after = physics.integrateOrientation(before, velocity, 16);
assert.notDeepEqual(after, before, "orientation must continue changing after a flick");

const damped = physics.dampAngularVelocity(velocity, 250, 0.001);
assert.ok(physics.velocityLength(damped) < physics.velocityLength(velocity), "inertia must slow gradually");

const hugeFrame = physics.integrateOrientation(before, velocity, 5000, 40);
const cappedFrame = physics.integrateOrientation(before, velocity, 40, 40);
close(hugeFrame.x, cappedFrame.x);
close(hugeFrame.y, cappedFrame.y);
close(hugeFrame.z, cappedFrame.z);
close(hugeFrame.w, cappedFrame.w);

const clamped = physics.clampAngularVelocity({ x: 1, y: 2, z: 3 }, 0.02);
close(physics.velocityLength(clamped), 0.02);

const flick = physics.flickVelocityFromSamples([
  { clientX: 120, clientY: 175, timeStamp: 0 },
  { clientX: 160, clientY: 145, timeStamp: 45 },
  { clientX: 215, clientY: 105, timeStamp: 90 },
], rect, 0.022, 110);
assert.ok(physics.velocityLength(flick) > 0, "a release sample must create post-drag inertia");
assert.ok(Math.abs(flick.x) > 0 && Math.abs(flick.y) > 0,
  "a diagonal flick must preserve both vertical and horizontal rotation");

const stationaryRelease = physics.flickVelocityFromSamples([
  { clientX: 120, clientY: 175, timeStamp: 0 },
  { clientX: 215, clientY: 105, timeStamp: 70 },
  { clientX: 215, clientY: 105, timeStamp: 90 },
], rect, 0.022, 110);
assert.ok(physics.velocityLength(stationaryRelease) > 0,
  "a stationary pointerup must not erase a recent real flick");

const staleFlick = physics.flickVelocityFromSamples([
  { clientX: 120, clientY: 175, timeStamp: 0 },
  { clientX: 215, clientY: 105, timeStamp: 40 },
  { clientX: 215, clientY: 105, timeStamp: 300 },
], rect, 0.022, 110);
close(physics.velocityLength(staleFlick), 0);

let longRun = physics.identityQuaternion();
for (let i = 0; i < 10000; i += 1) {
  longRun = physics.integrateOrientation(longRun, { x: 0.001, y: 0.002, z: -0.0005 }, 16);
}
close(quaternionLength(longRun), 1, 1e-7);
assert.match(physics.quaternionToMatrix3d(longRun), /^matrix3d\(/);

console.log("TOP 3D spin physics tests passed");
