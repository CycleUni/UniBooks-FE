// Regenerates every raster icon from the SVG sources in public/icons/.
// Run with `npm run icons` after editing them; the PNG/ICO outputs are
// committed, so nothing here runs during a normal build.
//
//   logo-mark.svg -> manifest PNGs + apple-touch-icon.png (large sizes)
//   favicon.svg   -> favicon.ico (16/32/48; simplified for tiny sizes)
//
// Rasters can't follow the theme, so they use the light variant: its brighter
// book color holds more contrast against the green tile at small sizes.
// The *-dark.svg files are only swapped in by the site (header logo via CSS,
// tab icon via ThemeService) while the dark theme is active.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicDir = path.join(__dirname, '../public');
const iconsDir = path.join(publicDir, 'icons');

const logoMark = fs.readFileSync(path.join(iconsDir, 'logo-mark.svg'), 'utf8');
const favicon = fs.readFileSync(path.join(iconsDir, 'favicon.svg'));

// Home-screen and PWA icons are masked to the platform's own shape (iOS
// rounds the corners, Android applies a maskable mask), so they are drawn
// full-bleed: the tile's corner radius is dropped rather than baked in.
const fullBleed = Buffer.from(logoMark.replace(/(<rect\b[^>]*?)\s+rx="[^"]*"/, '$1'));

// The SVGs use a 120-unit viewBox; render at the target size (with 8x
// supersampling) instead of scaling a fixed bitmap.
const render = (svg, size) =>
  sharp(svg, { density: (72 * size / 120) * 8 }).resize(size, size).png().toBuffer();

// Sizes come from the manifest so the two can't drift apart.
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
const manifestIcons = manifest.icons.filter(icon => icon.type === 'image/png');

// ICO container holding PNG-encoded images (supported since Windows Vista).
function toIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);     // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt16LE(1, entry + 4);                    // color planes
    header.writeUInt16LE(32, entry + 6);                   // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(image => image.data)]);
}

async function main() {
  for (const icon of manifestIcons) {
    const size = Number(icon.sizes.split('x')[0]);
    fs.writeFileSync(path.join(publicDir, icon.src), await render(fullBleed, size));
    console.log(`  ${icon.src}`);
  }

  const appleTouchIconData = await render(fullBleed, 180);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouchIconData);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon-precomposed.png'), appleTouchIconData);
  console.log('  apple-touch-icon.png');
  console.log('  apple-touch-icon-precomposed.png');

  fs.writeFileSync(path.join(iconsDir, 'favicon-48x48.png'), await render(favicon, 48));
  console.log('  icons/favicon-48x48.png');

  const icoImages = await Promise.all(
    [16, 32, 48].map(async size => ({ size, data: await render(favicon, size) })),
  );
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), toIco(icoImages));
  console.log('  favicon.ico');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
