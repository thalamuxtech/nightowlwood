import sharp from "sharp";

// Crop the clean grain area of the client's own walnut door photo into a
// reusable background texture (dark, high-detail, no handle/frame).
const SRC = "public/images/doors.jpg";

const meta = await sharp(SRC).metadata();
const sx = meta.width / 800; // crop coords measured on an 800px-wide preview

await sharp(SRC)
  .extract({
    left: Math.round(300 * sx),
    top: Math.round(160 * sx),
    width: Math.round(275 * sx),
    height: Math.round(420 * sx),
  })
  .resize(1200, null, { fit: "inside" })
  .modulate({ brightness: 0.72, saturation: 1.12 })
  .jpeg({ quality: 68 })
  .toFile("public/images/wood-texture.jpg");

console.log("wrote public/images/wood-texture.jpg");
