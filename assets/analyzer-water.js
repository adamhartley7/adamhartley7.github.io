(function () {
  "use strict";

  var world = document.querySelector(".journey-world");
  if (!world) return;

  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var active = null;

  function mark(state) {
    world.dataset.waterState = state;
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl) {
    var vertex = compile(gl, gl.VERTEX_SHADER, [
      "#version 300 es",
      "out vec2 vUv;",
      "void main(){",
      "  vec2 p=vec2((gl_VertexID==1)?3.0:-1.0,(gl_VertexID==2)?3.0:-1.0);",
      "  vUv=p*0.5+0.5;",
      "  gl_Position=vec4(p,0.0,1.0);",
      "}"
    ].join("\n"));
    var fragment = compile(gl, gl.FRAGMENT_SHADER, [
      "#version 300 es",
      "precision highp float;",
      "in vec2 vUv;",
      "out vec4 outColor;",
      "uniform float uTime;",
      "uniform float uProgress;",
      "uniform float uViewportAspect;",
      "const float IMAGE_ASPECT=1.5;",
      "vec2 imageUv(vec2 screenUv){",
      "  vec2 uv=screenUv;",
      "  if(uViewportAspect>IMAGE_ASPECT){",
      "    uv.y=(uv.y-0.5)*(IMAGE_ASPECT/uViewportAspect)+0.5;",
      "  }else{",
      "    uv.x=(uv.x-0.5)*(uViewportAspect/IMAGE_ASPECT)+0.5;",
      "  }",
      "  return vec2(uv.x,1.0-uv.y);",
      "}",
      "void main(){",
      "  vec2 photo=imageUv(vUv);",
      "  float belowHorizon=smoothstep(0.42,0.48,photo.y);",
      "  float depth=clamp((photo.y-0.42)/0.58,0.0,1.0);",
      "  float shore=mix(0.96,0.46,depth);",
      "  float water=belowHorizon*(1.0-smoothstep(shore-0.045,shore+0.025,photo.x));",
      "  float waveA=sin(photo.y*175.0+photo.x*13.0-uTime*1.35);",
      "  float waveB=sin(photo.y*106.0-photo.x*19.0-uTime*0.82);",
      "  float crests=pow(max(0.0,waveA*0.62+waveB*0.38),7.0);",
      "  float sunX=0.07+0.86*uProgress;",
      "  float reflectionWidth=mix(0.025,0.23,depth);",
      "  float reflection=exp(-pow((vUv.x-sunX)/max(reflectionWidth,0.001),2.0)*2.1);",
      "  float phase=clamp(uProgress*2.0,0.0,1.0);",
      "  vec3 warm=vec3(1.0,0.55,0.23);",
      "  vec3 day=vec3(0.78,0.95,1.0);",
      "  vec3 dusk=vec3(1.0,0.38,0.23);",
      "  vec3 color=uProgress<0.55?mix(warm,day,phase):mix(day,dusk,(uProgress-0.55)/0.33);",
      "  float nightFade=1.0-smoothstep(0.82,0.96,uProgress);",
      "  float alpha=water*nightFade*(0.018+crests*0.10+reflection*(0.025+crests*0.16));",
      "  outColor=vec4(color,clamp(alpha,0.0,0.22));",
      "}"
    ].join("\n"));
    if (!vertex || !fragment) return null;
    var program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function initialize() {
    if (active || motionQuery.matches) {
      if (motionQuery.matches) mark("reduced-motion");
      return;
    }

    var canvas = document.createElement("canvas");
    canvas.className = "journey-water";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    world.insertBefore(canvas, world.firstChild);

    var gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power"
    });
    if (!gl) {
      canvas.remove();
      mark("fallback");
      return;
    }

    var program = createProgram(gl);
    if (!program) {
      canvas.remove();
      mark("fallback");
      return;
    }

    var progressLocation = gl.getUniformLocation(program, "uProgress");
    var timeLocation = gl.getUniformLocation(program, "uTime");
    var aspectLocation = gl.getUniformLocation(program, "uViewportAspect");
    var progress = Number(document.documentElement.dataset.journeyProgress || 0.08);
    var frameId = 0;
    var endAt = 0;
    var lastFrame = 0;
    var frameInterval = 1000 / 30;
    var startedAt = performance.now();
    var destroyed = false;

    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    function resize() {
      var width = Math.max(1, world.clientWidth);
      var height = Math.max(1, world.clientHeight);
      var ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      ratio = Math.min(ratio, Math.sqrt(2000000 / (width * height)));
      ratio = Math.max(1 / Math.max(width, height), ratio);
      var pixelWidth = Math.max(1, Math.floor(width * ratio));
      var pixelHeight = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        gl.viewport(0, 0, pixelWidth, pixelHeight);
      }
      gl.uniform1f(aspectLocation, width / height);
    }

    function draw(now) {
      frameId = 0;
      if (destroyed || document.visibilityState === "hidden") return;
      if (now - lastFrame < frameInterval) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(timeLocation, (now - startedAt) / 1000);
      gl.uniform1f(progressLocation, progress);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (now < endAt) {
        frameId = requestAnimationFrame(draw);
      } else {
        mark("idle");
      }
    }

    function animateForBoundedPeriod() {
      if (destroyed || document.visibilityState === "hidden") return;
      endAt = performance.now() + 4000;
      mark("active");
      if (!frameId) frameId = requestAnimationFrame(draw);
    }

    function onProgress(event) {
      var next = event && event.detail ? Number(event.detail.progress) : NaN;
      if (Number.isFinite(next)) progress = Math.max(0, Math.min(1, next));
      animateForBoundedPeriod();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        endAt = 0;
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
        mark("paused");
      } else {
        resize();
        gl.uniform1f(progressLocation, progress);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        mark("idle");
      }
    }

    function destroy(state) {
      if (destroyed) return;
      destroyed = true;
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("top:journey-progress", onProgress);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteProgram(program);
      canvas.remove();
      active = null;
      mark(state || "fallback");
    }

    function onContextLost(event) {
      event.preventDefault();
      destroy("context-lost");
    }

    canvas.addEventListener("webglcontextlost", onContextLost, false);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("top:journey-progress", onProgress);
    document.addEventListener("visibilitychange", onVisibility);
    active = { destroy: destroy };
    resize();
    animateForBoundedPeriod();
  }

  function onMotionChange() {
    if (motionQuery.matches) {
      if (active) active.destroy("reduced-motion");
      else mark("reduced-motion");
    } else {
      initialize();
    }
  }

  if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
  else motionQuery.addListener(onMotionChange);
  initialize();
}());
