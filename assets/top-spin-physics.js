(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TopSpinPhysics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var EPSILON = 1e-9;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y, vector.z);
  }

  function normalizeVector(vector) {
    var length = vectorLength(vector);
    if (length < EPSILON) return { x: 0, y: 0, z: 1 };
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function identityQuaternion() {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  function normalizeQuaternion(quaternion) {
    var length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    if (length < EPSILON) return identityQuaternion();
    return {
      x: quaternion.x / length,
      y: quaternion.y / length,
      z: quaternion.z / length,
      w: quaternion.w / length,
    };
  }

  function multiplyQuaternions(a, b) {
    return normalizeQuaternion({
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    });
  }

  function quaternionFromAxisAngle(axis, angle) {
    var unit = normalizeVector(axis);
    var half = angle / 2;
    var sine = Math.sin(half);
    return normalizeQuaternion({
      x: unit.x * sine,
      y: unit.y * sine,
      z: unit.z * sine,
      w: Math.cos(half),
    });
  }

  function quaternionFromUnitVectors(from, to) {
    var a = normalizeVector(from);
    var b = normalizeVector(to);
    var cosine = clamp(dot(a, b), -1, 1);
    if (cosine < -1 + 1e-6) {
      var fallback = Math.abs(a.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      return quaternionFromAxisAngle(cross(a, fallback), Math.PI);
    }
    var axis = cross(a, b);
    return normalizeQuaternion({ x: axis.x, y: axis.y, z: axis.z, w: 1 + cosine });
  }

  function quaternionToAxisAngle(quaternion) {
    var q = normalizeQuaternion(quaternion);
    if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    var angle = 2 * Math.acos(clamp(q.w, -1, 1));
    var sine = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    if (sine < 1e-6 || angle < 1e-6) return { axis: { x: 0, y: 1, z: 0 }, angle: 0 };
    return { axis: { x: q.x / sine, y: q.y / sine, z: q.z / sine }, angle: angle };
  }

  function projectToTrackball(clientX, clientY, rect) {
    var radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    var x = (clientX - (rect.left + rect.width / 2)) / radius;
    var y = ((rect.top + rect.height / 2) - clientY) / radius;
    var distanceSquared = x * x + y * y;
    if (distanceSquared > 1) {
      var scale = 1 / Math.sqrt(distanceSquared);
      return { x: x * scale, y: y * scale, z: 0 };
    }
    return { x: x, y: y, z: Math.sqrt(1 - distanceSquared) };
  }

  function angularVelocityFromQuaternion(quaternion, elapsedMs) {
    var motion = quaternionToAxisAngle(quaternion);
    var time = Math.max(1, elapsedMs);
    return {
      x: motion.axis.x * motion.angle / time,
      y: motion.axis.y * motion.angle / time,
      z: motion.axis.z * motion.angle / time,
    };
  }

  function velocityLength(velocity) {
    return Math.hypot(velocity.x, velocity.y, velocity.z);
  }

  function clampAngularVelocity(velocity, maxSpeed) {
    var speed = velocityLength(velocity);
    if (speed <= maxSpeed || speed < EPSILON) return { x: velocity.x, y: velocity.y, z: velocity.z };
    var scale = maxSpeed / speed;
    return { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale };
  }

  function flickVelocityFromSamples(samples, rect, maxSpeed, windowMs) {
    if (!Array.isArray(samples) || samples.length < 2) return { x: 0, y: 0, z: 0 };
    var end = samples[samples.length - 1];
    var span = windowMs == null ? 110 : Math.max(20, windowMs);
    var start = null;
    for (var i = samples.length - 2; i >= 0; i -= 1) {
      var candidate = samples[i];
      if (end.timeStamp - candidate.timeStamp > span) break;
      var distance = Math.hypot(end.clientX - candidate.clientX, end.clientY - candidate.clientY);
      if (distance >= 1) start = candidate;
    }
    if (!start) return { x: 0, y: 0, z: 0 };
    var from = projectToTrackball(start.clientX, start.clientY, rect);
    var to = projectToTrackball(end.clientX, end.clientY, rect);
    var delta = quaternionFromUnitVectors(from, to);
    var velocity = angularVelocityFromQuaternion(delta, Math.max(1, end.timeStamp - start.timeStamp));
    return clampAngularVelocity(velocity, maxSpeed);
  }

  function integrateOrientation(orientation, velocity, elapsedMs, maxElapsedMs) {
    var elapsed = Math.max(0, Math.min(elapsedMs, maxElapsedMs == null ? 40 : maxElapsedMs));
    var speed = velocityLength(velocity);
    if (speed < EPSILON || elapsed === 0) return normalizeQuaternion(orientation);
    var delta = quaternionFromAxisAngle(velocity, speed * elapsed);
    return multiplyQuaternions(delta, orientation);
  }

  function dampAngularVelocity(velocity, elapsedMs, damping) {
    var factor = Math.exp(-Math.max(0, damping == null ? 0.001 : damping) * Math.max(0, elapsedMs));
    return { x: velocity.x * factor, y: velocity.y * factor, z: velocity.z * factor };
  }

  function quaternionToMatrix3d(quaternion) {
    var q = normalizeQuaternion(quaternion);
    var x = q.x, y = q.y, z = q.z, w = q.w;
    var xx = x * x, yy = y * y, zz = z * z;
    var xy = x * y, xz = x * z, yz = y * z;
    var wx = w * x, wy = w * y, wz = w * z;
    var values = [
      1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
      2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
      2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
      0, 0, 0, 1,
    ];
    return "matrix3d(" + values.map(function (value) { return Math.abs(value) < 1e-12 ? 0 : +value.toFixed(10); }).join(",") + ")";
  }

  return {
    identityQuaternion: identityQuaternion,
    normalizeQuaternion: normalizeQuaternion,
    multiplyQuaternions: multiplyQuaternions,
    quaternionFromAxisAngle: quaternionFromAxisAngle,
    quaternionFromUnitVectors: quaternionFromUnitVectors,
    quaternionToAxisAngle: quaternionToAxisAngle,
    projectToTrackball: projectToTrackball,
    angularVelocityFromQuaternion: angularVelocityFromQuaternion,
    velocityLength: velocityLength,
    clampAngularVelocity: clampAngularVelocity,
    flickVelocityFromSamples: flickVelocityFromSamples,
    integrateOrientation: integrateOrientation,
    dampAngularVelocity: dampAngularVelocity,
    quaternionToMatrix3d: quaternionToMatrix3d,
  };
});
