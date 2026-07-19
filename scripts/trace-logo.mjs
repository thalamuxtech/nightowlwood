// Vectorize the brand owl head (planning/brand/logomini.png) with the pupils
// isolated for animation. The pupils are fused to the dark eyelid in the
// artwork, so we cut a hairline arc to separate them topologically, then
// patch the arc back in body colour so the rendered mark is unchanged.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import ImageTracer from "imagetracerjs";

const SRC = "../planning/brand/logomini.png";
const png = PNG.sync.read(readFileSync(SRC));
const { width, height, data } = png;

// ---- 1. Quantize to the measured palette ----
const CENTERS = [
  { c: [252, 252, 252], out: [255, 255, 255] },
  { c: [49, 30, 15], out: [58, 42, 28] },
  { c: [115, 71, 44], out: [139, 94, 60] },
];
const cls = new Uint8Array(width * height); // 0 white, 1 dark, 2 light
for (let i = 0, p = 0; i < data.length; i += 4, p++) {
  let best = 0;
  if (data[i + 3] >= 128) {
    let bestD = Infinity;
    for (let k = 0; k < 3; k++) {
      const [r, g, b] = CENTERS[k].c;
      const d = (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
  }
  cls[p] = best;
  const [r, g, b] = CENTERS[best].out;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
}

// ---- 2. Locate the two eyes from interior white components ----
const seen = new Uint8Array(width * height);
function flood(sx, sy, match) {
  const stack = [sy * width + sx];
  const px = [];
  seen[stack[0]] = 1;
  while (stack.length) {
    const p = stack.pop();
    px.push(p);
    const x = p % width, y = (p / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (!seen[np] && cls[np] === match) { seen[np] = 1; stack.push(np); }
    }
  }
  return px;
}
flood(0, 0, 0); // background
const whiteComps = [];
for (let p = 0; p < cls.length; p++) {
  if (cls[p] === 0 && !seen[p]) {
    whiteComps.push(flood(p % width, (p / width) | 0, 0));
  }
}
whiteComps.sort((a, b) => b.length - a.length);
const eyeComps = whiteComps.slice(0, 2); // the two eye whites (C-rings)

const eyes = eyeComps.map((comp) => {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of comp) {
    const x = p % width, y = (p / width) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Pupil radius: scan the centre row inward from the ring
  const inComp = new Set(comp);
  let pl = null, pr = null;
  for (let x = Math.round(cx); x > minX; x--) {
    if (inComp.has(Math.round(cy) * width + x)) { pl = x; break; }
  }
  for (let x = Math.round(cx); x < maxX; x++) {
    if (inComp.has(Math.round(cy) * width + x)) { pr = x; break; }
  }
  const pupilR = (pr - pl) / 2 + 1;
  return { cx: (pl + pr) / 2, cy, pupilR, minX, maxX, minY, maxY };
});
eyes.sort((a, b) => a.cx - b.cx);
console.log("eyes:", eyes.map((e) => `c(${Math.round(e.cx)},${Math.round(e.cy)}) pupilR=${e.pupilR.toFixed(1)}`).join("  "));

// ---- 3. Cut a hairline arc across the pupil-eyelid bridge (top of pupil) ----
const patches = [];
for (const e of eyes) {
  const pts = [];
  const r0 = e.pupilR + 0.5, r1 = e.pupilR + 3.5;
  for (let y = Math.round(e.cy - r1 - 2); y <= Math.round(e.cy); y++) {
    for (let x = Math.round(e.cx - r1 - 2); x <= Math.round(e.cx + r1 + 2); x++) {
      const d = Math.hypot(x - e.cx, y - e.cy);
      if (d >= r0 && d <= r1) {
        const p = y * width + x;
        if (cls[p] === 1) {
          cls[p] = 0;
          const i = p * 4;
          data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        }
      }
    }
  }
  // Patch polygon: the same band, as an arc polygon (outer arc then inner arc back)
  const steps = 26;
  for (let s = 0; s <= steps; s++) {
    const a = Math.PI + (s / steps) * Math.PI; // 180deg..360deg (top half)
    pts.push([e.cx + Math.cos(a) * (r1 + 0.6), e.cy + Math.sin(a) * (r1 + 0.6)]);
  }
  for (let s = steps; s >= 0; s--) {
    const a = Math.PI + (s / steps) * Math.PI;
    pts.push([e.cx + Math.cos(a) * (r0 - 0.6), e.cy + Math.sin(a) * (r0 - 0.6)]);
  }
  patches.push(
    "M " + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ") + " Z"
  );
}

// ---- 4. Trace ----
const svgStr = ImageTracer.imagedataToSVG(
  { width, height, data },
  {
    pal: CENTERS.map(({ out }) => ({ r: out[0], g: out[1], b: out[2], a: 255 })),
    colorsampling: 0,
    numberofcolors: 3,
    ltres: 0.3,
    qtres: 0.3,
    pathomit: 12,
    roundcoords: 1,
    strokewidth: 0,
    linefilter: true,
  }
);

// ---- 5. Split layers into filled regions with attached holes ----
function subpathsOf(d) {
  return (d.match(/M[^M]+/g) ?? []).map((s) => s.trim());
}
function pointsOf(d) {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}
function bbox(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
function analyseLayer(d) {
  const subs = subpathsOf(d).map((sd) => {
    const pts = pointsOf(sd);
    return { d: sd, pts, bb: bbox(pts) };
  });
  for (const s of subs) {
    const probe = s.pts[0];
    s.depth = subs.filter((o) => o !== s && pointInPoly(probe, o.pts)).length;
  }
  const filled = subs.filter((s) => s.depth % 2 === 0);
  for (const f of filled) f.holes = [];
  for (const h of subs.filter((s) => s.depth % 2 === 1)) {
    const containers = filled
      .filter((f) => pointInPoly(h.pts[0], f.pts))
      .sort((a, b) => a.depth - b.depth);
    const owner = containers[containers.length - 1];
    if (owner) owner.holes.push(h);
  }
  return filled.map((f) => ({
    d: [f.d, ...f.holes.map((h) => h.d)].join(" "),
    bb: f.bb,
    area: (f.bb.maxX - f.bb.minX) * (f.bb.maxY - f.bb.minY),
    center: centroid(f.pts),
  }));
}

const layers = [...svgStr.matchAll(/<path fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*? d="([^"]+)"/g)];
const darkD = layers.filter((m) => m[1] === "58").map((m) => m[4]).join(" ");
const lightD = layers.filter((m) => m[1] === "139").map((m) => m[4]).join(" ");

const darkRegions = analyseLayer(darkD).filter((r) => r.area > 40);
const lightRegions = analyseLayer(lightD).filter((r) => r.area > 60);

const isPupil = (r) =>
  eyes.some(
    (e) =>
      Math.abs(r.center[0] - e.cx) < e.pupilR &&
      Math.abs(r.center[1] - e.cy) < e.pupilR * 1.4 &&
      r.bb.maxX - r.bb.minX < e.pupilR * 3
  );
const pupils = darkRegions.filter(isPupil);
const body = darkRegions.filter((r) => !isPupil(r)).map((r) => r.d).concat(patches);

// Splits for the outline (line-art) rendering style
const mainDarkR = darkRegions.filter((r) => !isPupil(r) && r.area > 10000);
const smallDarkR = darkRegions.filter((r) => !isPupil(r) && r.area <= 10000);
const mainBrowR = lightRegions.filter((r) => r.area > 2000);
const smallBrowR = lightRegions.filter((r) => r.area <= 2000);

console.log(`dark regions=${darkRegions.length}, pupils=${pupils.length} (expect 2), brow regions=${lightRegions.length}`);
pupils.forEach((p) => console.log(`  pupil bbox x[${Math.round(p.bb.minX)}-${Math.round(p.bb.maxX)}] y[${Math.round(p.bb.minY)}-${Math.round(p.bb.maxY)}]`));

// Safe pupil travel: stay under the cut arc
const travel = Math.max(2, Math.round(Math.min(...eyes.map((e) => e.pupilR)) * 0.45));
console.log("pupil travel px:", travel);

writeFileSync(
  "src/components/site/owl-paths.ts",
  `// Auto-generated by scripts/trace-logo.mjs from planning/brand/logomini.png.
export const OWL_VIEWBOX = "0 0 ${width} ${height}";
export const OWL_RATIO = ${(height / width).toFixed(4)};
export const OWL_TRAVEL = ${travel};
export const OWL_EYES: { cx: number; cy: number; r: number }[] = ${JSON.stringify(eyes.map((e) => ({ cx: Math.round(e.cx), cy: Math.round(e.cy), r: Math.round((e.maxX - e.minX) / 2 + 2) })))};
export const OWL_BODY: string[] = ${JSON.stringify(body)};
export const OWL_BROW: string[] = ${JSON.stringify(lightRegions.map((p) => p.d))};
export const OWL_PUPILS: string[] = ${JSON.stringify(pupils.map((p) => p.d))};
export const OWL_MAIN_DARK: string[] = ${JSON.stringify(mainDarkR.map((p) => p.d))};
export const OWL_SMALL_DARK: string[] = ${JSON.stringify(smallDarkR.map((p) => p.d))};
export const OWL_MAIN_BROW: string[] = ${JSON.stringify(mainBrowR.map((p) => p.d))};
export const OWL_SMALL_BROW: string[] = ${JSON.stringify(smallBrowR.map((p) => p.d))};
`
);

function standalone(bodyFill, browFill, browOpacity) {
  const p = (d, fill, extra = "") =>
    `  <path fill="${fill}"${extra} fill-rule="evenodd" d="${d}"/>`;
  const eyeR = eyes.map((e) => Math.round((e.maxX - e.minX) / 2 + 2));
  const lidHide = Math.max(...eyeR) * 2 + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="516" height="349">
  <style>
    @keyframes owl-glance {
      0%, 6% { transform: translate(0, 0); }
      11%, 30% { transform: translate(-${travel}px, ${Math.ceil(travel / 2)}px); }
      37%, 42% { transform: translate(0, 0); }
      49%, 68% { transform: translate(${travel}px, ${Math.ceil(travel / 2)}px); }
      76%, 100% { transform: translate(0, 0); }
    }
    .pupils { animation: owl-glance 7.5s ease-in-out infinite; }
    @keyframes owl-blink {
      0%, 88% { transform: translateY(-${lidHide}px); }
      92% { transform: translateY(0); }
      96%, 100% { transform: translateY(-${lidHide}px); }
    }
    .lid { animation: owl-blink 6.5s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .pupils, .lid { animation: none; } }
  </style>
  <defs>
${eyes.map((e, i) => `    <clipPath id="eye${i}"><circle cx="${Math.round(e.cx)}" cy="${Math.round(e.cy)}" r="${eyeR[i]}"/></clipPath>`).join("\n")}
  </defs>
${body.map((d) => p(d, bodyFill)).join("\n")}
${lightRegions.map((x) => p(x.d, browFill, browOpacity ? ` opacity="${browOpacity}"` : "")).join("\n")}
  <g class="pupils">
${pupils.map((x) => p(x.d, bodyFill)).join("\n")}
  </g>
${eyes.map((e, i) => `  <g clip-path="url(#eye${i})"><rect class="lid" x="${Math.round(e.cx) - eyeR[i] - 2}" y="${Math.round(e.cy) - eyeR[i] - 2}" width="${eyeR[i] * 2 + 4}" height="${eyeR[i] * 2 + 4}" fill="${bodyFill}"/></g>`).join("\n")}
</svg>
`;
}

// Outline (line-art) variant: big shapes stroked, small marks + pupils solid.
function outline(strokeColor, browColor) {
  const stroked = (d, c) =>
    `  <path fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round" d="${d}"/>`;
  const solid = (d, c) => `  <path fill="${c}" fill-rule="evenodd" d="${d}"/>`;
  const eyeR = eyes.map((e) => Math.round((e.maxX - e.minX) / 2 + 2));
  const lidHide = Math.max(...eyeR) * 2 + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="516" height="349">
  <style>
    @keyframes owl-glance {
      0%, 6% { transform: translate(0, 0); }
      11%, 30% { transform: translate(-${travel}px, ${Math.ceil(travel / 2)}px); }
      37%, 42% { transform: translate(0, 0); }
      49%, 68% { transform: translate(${travel}px, ${Math.ceil(travel / 2)}px); }
      76%, 100% { transform: translate(0, 0); }
    }
    .pupils { animation: owl-glance 7.5s ease-in-out infinite; }
    @keyframes owl-blink {
      0%, 88% { transform: translateY(-${lidHide}px); }
      92% { transform: translateY(0); }
      96%, 100% { transform: translateY(-${lidHide}px); }
    }
    .lid { animation: owl-blink 6.5s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .pupils, .lid { animation: none; } }
  </style>
  <defs>
${eyes.map((e, i) => `    <clipPath id="oeye${i}"><circle cx="${Math.round(e.cx)}" cy="${Math.round(e.cy)}" r="${eyeR[i]}"/></clipPath>`).join("\n")}
  </defs>
${mainDarkR.map((r) => stroked(r.d, strokeColor)).join("\n")}
${mainBrowR.map((r) => stroked(r.d, browColor)).join("\n")}
${smallDarkR.map((r) => solid(r.d, strokeColor)).join("\n")}
${smallBrowR.map((r) => solid(r.d, browColor)).join("\n")}
  <g class="pupils">
${pupils.map((x) => solid(x.d, strokeColor)).join("\n")}
  </g>
${eyes.map((e, i) => `  <g clip-path="url(#oeye${i})"><rect class="lid" x="${Math.round(e.cx) - eyeR[i] - 2}" y="${Math.round(e.cy) - eyeR[i] - 2}" width="${eyeR[i] * 2 + 4}" height="${eyeR[i] * 2 + 4}" fill="${strokeColor}"/></g>`).join("\n")}
</svg>
`;
}

writeFileSync("../planning/brand/nightowl-header-mark-brass.svg", standalone("#c98f43", "#ecc98f"));
writeFileSync("../planning/brand/nightowl-header-mark-cream.svg", standalone("#f5efe2", "#f5efe2", "0.72"));
writeFileSync("../planning/brand/nightowl-header-mark-outline.svg", outline("#dba95f", "#ecc98f"));
writeFileSync("public/brand/nightowl-header-mark-brass.svg", standalone("#c98f43", "#ecc98f"));
writeFileSync("public/brand/nightowl-header-mark-cream.svg", standalone("#f5efe2", "#f5efe2", "0.72"));
writeFileSync("public/brand/nightowl-header-mark-outline.svg", outline("#dba95f", "#ecc98f"));
console.log("wrote standalone SVGs incl. outline variant (planning + public)");
