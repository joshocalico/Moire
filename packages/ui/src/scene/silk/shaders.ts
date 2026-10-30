/**
 * GLSL ES 3.00 sources for the silk boot scene. The same source runs under WebGL2 (tests) and
 * native GLES 3 (VirGL, Mesa, vendor drivers).
 */

export const RIBBON_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 grid;      // x: s along length [0,1], y: w across [-1,1]
uniform sampler2D uFrame;               // row 0: centre xyz + half width; row 1: across xyz + billow
uniform int uSamples;
uniform float uTime;
uniform float uAspect;   // output width / height
uniform float uOffsetX;  // centres the 16:10 composition on other aspect ratios
uniform float uMorph;    // 0: free ribbon, 1: settled into the line-wave (greeter backdrop)
uniform float uFlipS;    // +1/-1: which ribbon end becomes the wave's left edge
uniform float uFlipW;    // +1/-1: which ribbon side becomes the wave's lower side
out vec2 vSW;
out vec2 vWave;          // wave sheet coordinates: along [0,1], across [-1,1]
out float vMorph;
out float vCrest;        // closeness to the wave's folded ridge
vec3 safeNormalize(vec3 v) {
  float l = length(v);
  return l > 1e-6 ? v / l : vec3(0.0, 0.0, 1.0);
}
out vec3 vNormal;
out vec3 vTangent;
out vec3 vAcross;
out float vDepth;
// The line-wave: a sheet of fine filaments sweeping down-left to up-right with a folded ridge,
// breathing slowly. Viewport coordinates, y down.
float waveCrest(float along, float across, float t) {
  float x = -0.08 + along * 1.16;
  float bend = exp(-pow((x - 0.8) / 0.3, 2.0));
  float ridge = 0.35 * cos(x * 6.3) + 0.25 + 0.04 * sin(t * 0.21);
  return bend * exp(-pow(22.0 * (across * 0.75 - ridge), 2.0));
}
vec2 waveAt(float along, float across, float t) {
  float x = -0.08 + along * 1.16;
  float v = across * 0.75;
  float bend = exp(-pow((x - 0.8) / 0.3, 2.0));
  float ridge = 0.35 * cos(x * 6.3) + 0.25 + 0.04 * sin(t * 0.21);
  float y = 1.15 - 0.9 * x + v * 0.9
    + 0.19 * sin(x * 6.3 + v * 1.2 + 0.30 * sin(t * 0.17))
    - (0.125 + 0.02 * sin(t * 0.29)) * bend * tanh(7.0 * (v - ridge))
    + 0.06 * bend * sin(x * 11.0 + v * 1.3 + t * 0.35)
    + 0.012 * sin(x * 4.0 - t * 0.4 + v * 2.0);
  return vec2(x, y);
}
vec4 frameAt(int row, float s) {
  float x = s * float(uSamples - 1);
  int i = int(floor(x));
  int j = min(i + 1, uSamples - 1);
  return mix(texelFetch(uFrame, ivec2(i, row), 0), texelFetch(uFrame, ivec2(j, row), 0), x - float(i));
}
void main() {
  float s = grid.x, w = grid.y;
  vec4 c = frameAt(0, s);
  vec4 a = frameAt(1, s);
  vec3 across = safeNormalize(a.xyz);
  float d = 1.0 / float(uSamples - 1);
  vec3 tangent = safeNormalize(frameAt(0, min(1.0, s + d)).xyz - frameAt(0, max(0.0, s - d)).xyz);
  vec3 up = safeNormalize(cross(tangent, across));
  // Billow: the sheet bows across its width; edges flutter in a fine travelling ripple.
  float billow = a.w;
  float flutter = 0.05 * sin(s * 55.0 - uTime * 4.0) * pow(abs(w), 6.0);
  float bow = billow * (w * w - 0.33) + flutter * 0.25;
  vec3 p = c.xyz + c.w * (across * w + up * bow);
  // Shading normal includes the bow: d/dw of the surface.
  vec3 dPdw = across + up * (2.0 * billow * w + flutter * 1.2 * sign(w) * pow(abs(w), 4.0));
  float persp = 1.0 / (1.0 - p.z * 0.45);
  vec2 q = vec2(0.5) + (vec2((p.x + uOffsetX) / uAspect, p.y) - vec2(0.5)) * persp;
  // Flow into the wave head first, so the ribbon visibly pours into the sheet.
  float along = uFlipS > 0.0 ? s : 1.0 - s;
  float m = clamp(uMorph * 1.25 - s * 0.25, 0.0, 1.0);
  m = m * m * m * (m * (m * 6.0 - 15.0) + 10.0);
  q = mix(q, waveAt(along, w * uFlipW, uTime), m);
  vSW = vec2(s, w);
  vWave = vec2(along, w * uFlipW);
  // Shading hands over in the first half, before edge-on twists can streak across the sheet.
  vMorph = smoothstep(0.0, 0.45, m);
  vCrest = waveCrest(along, w * uFlipW, uTime);
  vNormal = safeNormalize(cross(tangent, dPdw));
  vTangent = tangent;
  vAcross = across;
  vDepth = p.z * (1.0 - m);
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;

export const RIBBON_FS = `#version 300 es
precision highp float;
in vec2 vSW;
in vec3 vNormal;
in vec3 vTangent;
in vec3 vAcross;
in float vDepth;
in vec2 vWave;
in float vMorph;
in float vCrest;
uniform float uTime;
uniform int uMode;          // 0: emitted light (+ layer count in alpha), 1: thread transmission
uniform float uLayerScale;  // alpha written per layer (1, or 0.25 on 8-bit targets)
out vec4 outColor;

float ribs(float q) {
  float fw = max(fwidth(q), 1e-4);
  float d = abs(fract(q) - 0.5);
  float px = (0.5 - d) / fw;               // pixels from the rib centre
  float line = exp(-px * px * 0.9);
  return mix(line, 0.32, smoothstep(0.22, 0.55, fw));   // average out when minified
}

void main() {
  float s = vSW.x, w = vSW.y;
  vec3 n = normalize(vNormal);
  vec3 v = vec3(0.0, 0.0, 1.0);
  float facing = abs(n.z);
  // Fine helical ribs: mostly along the length, slanted across the width.
  float q1 = w * 16.0 + s * 34.0;
  float q2 = w * 17.2 + s * 37.0 + 0.37;
  float t1 = ribs(q1);
  // Moire taffeta: the beat envelope of two thread sets, its phase rippling like wood grain as
  // two slow waves drift through it. Rendered directly, so it is clean at any scale.
  float phase = 0.17 * q1 + 0.85 * sin(s * 6.0 + w * 1.6 + uTime * 0.22) + 0.35 * sin(s * 15.0 - w * 2.3 - uTime * 0.31);
  float watered = smoothstep(0.30, 1.0, 0.5 + 0.5 * cos(6.2831853 * phase));
  float ends = smoothstep(0.0, 0.07, s) * pow(smoothstep(1.0, 0.72, s), 1.5);
  if (uMode == 1) {
    // Sheer layers: light through each layer is cut by a coarse, high-contrast thread mesh;
    // overlapping layers multiply, and two slightly different meshes interfere.
    float qt = w * 11.0 + s * 23.0;
    float fw = max(fwidth(qt), 1e-4);
    float thread = smoothstep(0.30 + fw, 0.30 - fw, abs(fract(qt) - 0.5));
    thread = mix(thread, 0.4, smoothstep(0.35, 0.7, fw));
    outColor = vec4(vec3(1.0 - 0.85 * thread * ends * (1.0 - vMorph)), 1.0);
    return;
  }
  float r = (t1 * 0.60 + ribs(q2) * 0.25) * (0.30 + 1.45 * watered);

  // Satin: Kajiya-Kay highlights along the rib direction under a slowly orbiting light.
  vec3 fibre = normalize(vTangent * 6.0 + vAcross * 0.35);
  vec3 l = normalize(vec3(-0.35 + 0.25 * sin(uTime * 0.45), -0.75 + 0.12 * cos(uTime * 0.38), 0.55));
  vec3 h = normalize(l + v);
  float th = dot(fibre, h);
  float sinTH = sqrt(max(0.0, 1.0 - th * th));
  float sheen = pow(sinTH, 90.0);
  float glow = pow(sinTH, 8.0);
  float sheenBroad = pow(sinTH, 24.0);
  float fresnel = pow(1.0 - facing, 3.0);

  float edge = 1.0 - abs(w);
  float ew = max(fwidth(w), 1e-4);
  float hem = exp(-pow(edge / (ew * 1.4), 2.0));
  float hemSoft = exp(-edge * 18.0);

  vec3 lavender = vec3(0.36, 0.25, 0.74);
  vec3 lilac = vec3(0.58, 0.51, 1.0);
  vec3 warm = vec3(1.0, 0.90, 0.84);
  vec3 col = lavender * (0.045 + 0.07 * glow + 0.05 * fresnel);           // translucent body
  col += lilac * r * (0.065 + 0.16 * glow + 0.10 * fresnel);              // ribs catch the light
  col += mix(lilac, warm, 0.5) * r * sheenBroad * 0.24;                  // satin sheen band
  col += warm * r * sheen * 0.95;                                         // glossy crest
  col += lilac * fresnel * 0.12 + warm * pow(fresnel, 4.0) * 0.45;        // grazing light at twists
  vec3 hemColour = mix(vec3(0.86, 0.82, 1.0), warm, 0.35 + 0.45 * glow);
  col += hemColour * (hem * 1.35 + hemSoft * 0.05) * (0.45 + 0.75 * max(glow, fresnel));
  col *= ends;
  col *= 0.8 + 0.35 * clamp(vDepth * 2.5 + 0.5, 0.0, 1.0);

  // The line-wave: 512 hairline filaments, every fourth one bright, warming where they crest.
  // Folds stack sheets additively, so the ridge glows on its own.
  float across01 = vWave.y * 0.5 + 0.5;
  float bright = ribs(across01 * 127.75);
  float fine = ribs(across01 * 511.0);
  float lines = bright * 0.9 + fine * 0.22;
  float shimmer = 0.75 + 0.25 * sin(vWave.x * 9.0 - uTime * 0.6 + vWave.y * 3.0);
  vec3 filament = vec3(0.49, 0.40, 0.73);
  vec3 crest = mix(vec3(0.66, 0.55, 0.95), vec3(0.93, 0.76, 0.71), 0.35);
  vec3 waveCol = (filament * (0.075 + 0.045 * shimmer) + crest * vCrest * 0.85) * lines;
  waveCol += hemColour * hem * 0.05;
  // The sheet rises out of the dark on the left, like the original artwork.
  float quiet = smoothstep(0.22, 0.58, vWave.x);
  float waveEnds = quiet * smoothstep(1.0, 0.94, vWave.x);
  col = mix(col, waveCol * waveEnds, vMorph);
  // Mid-pour the sheet briefly folds over itself; keep the stacked layers from flaring.
  col *= 1.0 - 1.2 * vMorph * (1.0 - vMorph);
  float layer = mix(ends, waveEnds, vMorph);
  outColor = vec4(col, layer * uLayerScale);   // alpha accumulates the layers covering a pixel
}`;

export const FULLSCREEN_VS = `#version 300 es
layout(location = 0) in vec2 pos;
uniform bool uFlipY;  // compositor targets store rows top-down
out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos.x, uFlipY ? -pos.y : pos.y, 0.0, 1.0); }`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 uv; uniform sampler2D src; out vec4 o;
void main() { vec3 c = texture(src, uv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(0.55, 1.3, l), 1.0); }`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 uv; uniform sampler2D src; uniform vec2 dir; out vec4 o;
void main() {
  vec3 c = texture(src, uv).rgb * 0.2270270270;
  c += (texture(src, uv + dir * 1.3846153846).rgb + texture(src, uv - dir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(src, uv + dir * 3.2307692308).rgb + texture(src, uv - dir * 3.2307692308).rgb) * 0.0702702703;
  o = vec4(c, 1.0);
}`;

export const COMPOSE_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D scene, bloomA, bloomB, trans;
uniform float uTime, uLayerScale;
uniform float uBackdrop;  // XMB waves strength; quieter behind the greeter's line-wave
uniform bool uBgra;  // compositor textures store B,G,R,A
uniform vec2 res;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// Background waves (XMB-inspired): translucent sheets in deep focus, each a slow sum of sines,
// with a soft body beneath a glowing hairline edge.
float waveY(int i, float x, float t) {
  float fi = float(i);
  return 0.50 + 0.06 * fi - 0.04
    + 0.060 * sin(x * (1.6 + 0.35 * fi) + t * (0.32 + 0.07 * fi) + fi * 1.7)
    + 0.028 * sin(x * (3.1 - 0.4 * fi) - t * (0.21 + 0.05 * fi) + fi * 0.9)
    + 0.012 * sin(x * 6.3 + t * 0.47 + fi * 2.3);
}
vec3 backgroundWaves(vec2 p, float t, out float edgeLight) {
  vec3 light = vec3(0.0);
  edgeLight = 0.0;
  for (int i = 0; i < 4; i++) {
    float d = p.y - waveY(i, p.x, t);       // positive below the edge
    float body = smoothstep(0.0, 0.015, d) * exp(-d * (5.0 + float(i)));
    float line = exp(-pow(d / 0.0022, 2.0));
    float glow = exp(-pow(d / 0.03, 2.0));
    float k = 0.55 + 0.15 * float(i);
    light += vec3(0.20, 0.15, 0.38) * body * 0.16 * k + vec3(0.55, 0.47, 0.85) * (line * 0.10 + glow * 0.025) * k;
    edgeLight = max(edgeLight, glow);
  }
  return light;
}
// Sparkles: sparse soft points in parallax layers, rising slowly with a faint twinkle.
float motes(vec2 p, float t) {
  float total = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float cell = 0.11 - fl * 0.028;
    vec2 q = p + vec2(0.008 * sin(t * 0.2 + fl), t * (0.010 + fl * 0.008));
    vec2 id = floor(q / cell);
    vec2 f = q / cell - id;
    float h = hash(id + fl * 17.0);
    if (h > 0.30) continue;
    vec2 at = vec2(hash(id + 3.1 + fl), hash(id + 7.7 + fl)) * 0.8 + 0.1;
    float rpx = (1.4 + 1.6 * hash(id + 11.0)) / res.y;
    float dist = length((f - at) * cell);
    float twinkle = 0.65 + 0.35 * sin(t * (0.8 + h * 2.0) + h * 40.0);
    total += exp(-pow(dist / rpx, 2.0)) * (0.25 + 0.35 * hash(id + 5.0)) * twinkle * (0.6 + fl * 0.25);
  }
  return total;
}
void main() {
  float fade = smoothstep(0.0, 0.45, uTime);
  vec3 bg = vec3(0.010, 0.010, 0.014);
  float rr = length((uv - vec2(0.60, 0.45)) * vec2(1.6, 1.0));
  bg += vec3(0.012, 0.010, 0.020) * exp(-rr * rr * 2.0);
  vec4 lit = texture(scene, uv);
  // Interference: where two or more sheer layers overlap, light passes through both thread
  // meshes; their product forms moire fringes. Normalised so mean brightness is unchanged.
  float layers = lit.a / uLayerScale;
  float overlap = smoothstep(1.15, 1.85, layers);
  float fringe = texture(trans, uv).r / pow(0.66, layers);
  vec3 ribbon = lit.rgb * mix(1.0, clamp(fringe, 0.05, 2.6), overlap);
  vec2 pa = vec2(uv.x * res.x / res.y, 1.0 - uv.y);           // aspect-correct, y down
  float alive = smoothstep(0.3, 2.6, uTime);
  bg += vec3(0.020, 0.014, 0.040) * (1.0 - smoothstep(0.0, 1.0, pa.y)) * alive;
  float edgeLight;
  bg += backgroundWaves(pa, uTime, edgeLight) * alive * uBackdrop;
  bg += vec3(0.85, 0.78, 1.0) * motes(pa, uTime) * (0.18 + 0.85 * edgeLight) * smoothstep(0.8, 2.8, uTime);
  vec3 c = bg + ribbon + texture(bloomA, uv).rgb * 0.35 + texture(bloomB, uv).rgb * 0.12;

  // Saturation-preserving tone curve, vignette, and dither against banding.
  float peak = max(c.r, max(c.g, c.b));
  c *= (1.0 - exp(-peak * 1.35)) / max(peak, 1e-4);
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.25, 1.0)));
  c *= mix(0.72, 1.0, vig);
  c = pow(c, vec3(1.0 / 1.02));
  c += (hash(uv * res + uTime) - 0.5) / 255.0;
  c *= fade;

  o = vec4(uBgra ? c.bgr : c, 1.0);
}`;
