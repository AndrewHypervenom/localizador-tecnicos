// Regenera los iconos de la app a partir de positivo1024.jpg.
// Arregla el "zoom" del icono adaptativo de Android: extrae la "S+" del verde,
// la centra dentro del safe-zone (sin sangre completa) y usa un verde de fondo
// que coincide EXACTAMENTE con el del logo para que se vea uniforme.
const { Jimp, intToRGBA } = require("jimp");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
const res = path.join(root, "android", "app", "src", "main", "res");
const assets = path.join(root, "assets");

// Verde del logo de origen (esquina de positivo1024.jpg) -> usado como fondo.
const GREEN = { r: 17, g: 212, b: 82 };
const GREEN_HEX = "#11D452";

function bbox(img) {
  const { width: w, height: h, data } = img.bitmap;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Convierte el logo (S+ negra sobre verde) en S+ con fondo transparente.
function keyOutGreen(img) {
  const { width: w, height: h, data } = img.bitmap;
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const dr = data[idx] - GREEN.r;
    const dg = data[idx + 1] - GREEN.g;
    const db = data[idx + 2] - GREEN.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let f;
    if (dist <= 70) f = 0;
    else if (dist >= 150) f = 1;
    else f = (dist - 70) / 80;
    data[idx + 3] = Math.round(data[idx + 3] * f);
  }
  return img;
}

// Coloca `logo` centrado en un lienzo NxN, escalado para que su lado mayor
// ocupe `frac` del lienzo. `bg` = color de fondo (int) o null (transparente).
async function placeCentered(logo, N, frac, bg, round) {
  const canvas = new Jimp({ width: N, height: N, color: bg == null ? 0x00000000 : bg });
  if (round) canvas.circle();
  const bb = bbox(logo);
  const cropped = logo.clone().crop({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
  const target = Math.round(N * frac);
  const scale = target / Math.max(bb.w, bb.h);
  const nw = Math.max(1, Math.round(bb.w * scale));
  const nh = Math.max(1, Math.round(bb.h * scale));
  cropped.resize({ w: nw, h: nh });
  const x = Math.round((N - nw) / 2);
  const y = Math.round((N - nh) / 2);
  canvas.composite(cropped, x, y);
  return canvas;
}

const greenInt = (() => {
  // 0xRRGGBBAA
  return ((GREEN.r << 24) | (GREEN.g << 16) | (GREEN.b << 8) | 0xff) >>> 0;
})();

const DENS = [
  { name: "mdpi", fg: 108, legacy: 48 },
  { name: "hdpi", fg: 162, legacy: 72 },
  { name: "xhdpi", fg: 216, legacy: 96 },
  { name: "xxhdpi", fg: 324, legacy: 144 },
  { name: "xxxhdpi", fg: 432, legacy: 192 },
];

const FG_FRAC = 0.29;      // S+ chica + mucho margen: aguanta el zoom del launcher (Samsung)
const LEGACY_FRAC = 0.39;  // icono cuadrado/redondo (Android < 8)

(async () => {
  const src = await Jimp.read(path.join(repoRoot, "positivo1024.jpg"));
  const splus = keyOutGreen(src.clone()); // S+ sobre transparente (1080x1080)

  for (const d of DENS) {
    const dir = path.join(res, `mipmap-${d.name}`);

    // Foreground adaptivo (transparente, fondo lo pone iconBackground)
    const fg = await placeCentered(splus, d.fg, FG_FRAC, null, false);
    await fg.write(path.join(dir, "ic_launcher_foreground.png"));

    // Icono cuadrado legacy (fondo verde)
    const sq = await placeCentered(splus, d.legacy, LEGACY_FRAC, greenInt, false);
    await sq.write(path.join(dir, "ic_launcher.png"));

    // Icono redondo legacy (circulo verde)
    const rd = await placeCentered(splus, d.legacy, LEGACY_FRAC, greenInt, true);
    await rd.write(path.join(dir, "ic_launcher_round.png"));

    // Quita los .webp viejos (mismo nombre de recurso -> conflicto)
    for (const f of ["ic_launcher_foreground.webp", "ic_launcher.webp", "ic_launcher_round.webp"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    console.log(`mipmap-${d.name}: ok`);
  }

  // Assets de Expo (para futuros prebuild)
  const fgAsset = await placeCentered(splus, 1024, FG_FRAC, null, false);
  await fgAsset.write(path.join(assets, "adaptive-foreground.png"));

  // icon.png legacy a sangre completa (verde uniforme + S+ centrada)
  const iconAsset = await placeCentered(splus, 1024, LEGACY_FRAC, greenInt, false);
  await iconAsset.write(path.join(assets, "icon.png"));

  console.log(`assets: ok  | fondo ${GREEN_HEX}`);

  // --- Vista previa: simula como se ve en el launcher ---
  // (fondo verde + foreground centrado, recortado en circulo) y tambien con
  // un "zoom" tipo Samsung (~1.4x) para ver el peor caso.
  async function preview(zoom, name) {
    const N = 512;
    const bg = new Jimp({ width: N, height: N, color: greenInt });
    const fg = await placeCentered(splus, Math.round(N * zoom), FG_FRAC, null, false);
    bg.composite(fg, Math.round((N - fg.bitmap.width) / 2), Math.round((N - fg.bitmap.height) / 2));
    bg.circle();
    await bg.write(path.join(__dirname, name));
  }
  await preview(1.0, "_preview_normal.png");
  await preview(1.4, "_preview_samsung_zoom.png");
  console.log("preview: ok");
})();
