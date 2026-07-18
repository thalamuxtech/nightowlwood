import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// Crop the owl head from the brand logo and set it on a cream circle
// so the favicon stays legible at tab size on light and dark themes.
const SRC = "public/images/nightowl.png";

const circle = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#f5efe2"/>
     </svg>`
  );

async function makeIcon(size, out) {
  const meta = await sharp(SRC).metadata();
  // Owl head occupies the top-centre of the 480px logo lockup.
  const scale = meta.width / 480;
  const head = await sharp(SRC)
    .extract({
      left: Math.round(128 * scale),
      top: 0,
      width: Math.round(244 * scale),
      height: Math.round(166 * scale),
    })
    .resize(Math.round(size * 0.72), null, { fit: "inside" })
    .toBuffer();

  const headMeta = await sharp(head).metadata();
  await sharp(circle(size))
    .composite([
      {
        input: head,
        left: Math.round((size - headMeta.width) / 2),
        top: Math.round((size - headMeta.height) / 2),
      },
    ])
    .png()
    .toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

await mkdir("src/app", { recursive: true });
await makeIcon(512, "src/app/icon.png");
await makeIcon(180, "src/app/apple-icon.png");
