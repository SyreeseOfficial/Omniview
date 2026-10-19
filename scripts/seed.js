'use strict';

// Writes a demo copy of both libraries (30 entries with generated screenshots) into ./demo,
// so demos, README images and manual testing never touch the real data. Run it with
//   npm run seed    then    npm run demo
// Existing files in the target folder are replaced.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'demo'));
const uploads = path.join(target, 'uploads');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'db'), { recursive: true });
fs.mkdirSync(uploads, { recursive: true });

const day = n => new Date(Date.now() - n * 864e5).toISOString();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// A made-up page: a nav bar, a hero block and a row of cards in the given colours.
async function shot(name, [bg, fg, accent], w = 1280, h = 800) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${bg}"/>
    <rect width="${w}" height="64" fill="${fg}" opacity=".08"/>
    <circle cx="48" cy="32" r="14" fill="${accent}"/>
    <rect x="${w - 360}" y="26" width="64" height="12" rx="6" fill="${fg}" opacity=".4"/>
    <rect x="${w - 270}" y="26" width="64" height="12" rx="6" fill="${fg}" opacity=".4"/>
    <rect x="${w - 180}" y="18" width="100" height="28" rx="14" fill="${accent}"/>
    <text x="80" y="${h * 0.38}" font-family="sans-serif" font-size="64" font-weight="700" fill="${fg}">${esc(name)}</text>
    <rect x="80" y="${h * 0.38 + 36}" width="460" height="14" rx="7" fill="${fg}" opacity=".35"/>
    <rect x="80" y="${h * 0.38 + 64}" width="360" height="14" rx="7" fill="${fg}" opacity=".35"/>
    ${[0, 1, 2].map(i => `<rect x="${80 + i * 380}" y="${h * 0.66}" width="340" height="170" rx="16" fill="${fg}" opacity="${0.1 + i * 0.05}"/>`).join('')}
  </svg>`;
  const file = `${crypto.randomUUID()}.png`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(uploads, file));
  return file;
}

const entry = (extra, i) => ({
  id: crypto.randomUUID(), url: '', title: '', screenshots: [], remote_shots: [], palette: [], image_hashes: {}, type: null, color: null,
  style_tags: [], note: '', found_via: '', favicon: null, favorite: false, bought: false, visited_at: null, boards: [],
  date_added: day(i * 3), ...extra
});

const PALETTES = [
  ['#0f172a', '#f8fafc', '#38bdf8'], ['#fafaf9', '#1c1917', '#f97316'], ['#111827', '#e5e7eb', '#a78bfa'], ['#ffffff', '#111111', '#ef4444'],
  ['#052e16', '#ecfccb', '#84cc16'], ['#fdf2f8', '#500724', '#ec4899'], ['#1e1b4b', '#e0e7ff', '#818cf8'], ['#fffbeb', '#451a03', '#f59e0b']
];
const UI_SITES = ['Linear', 'Stripe', 'Vercel', 'Notion', 'Figma', 'Arc', 'Raycast', 'Framer', 'Loom', 'Cal', 'Resend', 'Clerk', 'Supabase', 'Plain', 'Height', 'Pitch', 'Mercury', 'Ramp', 'Arc Search', 'Craft'];
const UI_TAGS = ['Minimal', 'Dark Mode', 'Gradient', 'Bold', 'Clean', 'Playful', 'Editorial', 'Monochrome'];

async function main() {
  const boards = [
    { id: crypto.randomUUID(), name: 'Landing pages', description: 'Hero + pricing layouts', emoji: '🚀', color: '', pinned: true, order: [], created: day(40) },
    { id: crypto.randomUUID(), name: 'Dark UIs', description: '', emoji: '', color: '', pinned: false, order: [], created: day(20) }
  ];
  const ui = [];
  for (const [i, name] of UI_SITES.entries()) {
    const palette = PALETTES[i % PALETTES.length];
    const e = entry({
      url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example/`, title: `${name} — home`, screenshots: [await shot(name, palette)],
      type: i % 4 === 0 ? 'Web App' : 'Website', style_tags: [UI_TAGS[i % UI_TAGS.length], ...(i % 3 === 0 ? [UI_TAGS[(i + 3) % UI_TAGS.length]] : [])].filter((t, k, a) => a.indexOf(t) === k),
      found_via: ['Dribbble', 'Pinterest', 'Newsletter', 'Google'][i % 4], favorite: i % 5 === 0, note: i === 0 ? 'Great empty states.' : '',
      boards: i % 3 === 0 ? [boards[0].id] : i % 4 === 1 ? [boards[1].id] : []
    }, i);
    if (i % 7 === 6) e.style_tags = []; // a few untagged, for the triage view
    ui.push(e);
  }

  const FASHION = [
    ['Heritage Overcoat', 'Barbour', 425, 'Jacket', 'Black'], ['Beaufort Wax Jacket', 'Barbour', 425, 'Jacket', 'Green'], ['Iron Ranger', 'Red Wing', 320, 'Shoes', 'Brown'],
    ['1460 Boot', 'Dr. Martens', 170, 'Shoes', 'Black'], ['Jungle Boot', 'Dr. Martens', 150, 'Shoes', 'Brown'], ['Oxford Shirt', 'Bronson MFG', 98, 'Shirt', 'Blue'],
    ['Chore Coat', 'Bronson MFG', 185, 'Jacket', 'Brown'], ['Lambswool Crew', 'Drake’s', 215, 'Knitwear', 'Gray'], ['Field Cap', 'Bronson MFG', 45, 'Hat', 'Green'],
    ['Weekender Bag', 'Filson', 310, 'Bag', 'Brown']
  ];
  const shops = ['barbour', 'redwing', 'drmartens', 'bronsonshop', 'drakes', 'filson'];
  const fashion = [];
  for (const [i, [title, brand, price, type, color]] of FASHION.entries()) {
    const shop = shops[Math.min(shops.length - 1, ['Barbour', 'Red Wing', 'Dr. Martens', 'Bronson MFG', 'Drake’s', 'Filson'].indexOf(brand))];
    fashion.push(entry({
      url: `https://${shop}.example/products/${title.toLowerCase().replace(/\W+/g, '-')}`, title, brand, price: String(price), type, color,
      screenshots: [await shot(title, ['#ffffff', '#222222', '#b45309'], 800, 1000)], bought: i === 9, price_was: i === 3 ? '190' : ''
    }, i));
  }

  const write = (file, data) => fs.writeFileSync(path.join(target, 'db', file), JSON.stringify(data, null, 2));
  write('library.json', { entries: ui, boards, tags: UI_TAGS, types: ['Website', 'Web App'], foundVia: ['Dribbble', 'Google', 'Newsletter', 'Pinterest'] });
  write('fashion.json', { entries: fashion, boards: [], tags: [], types: ['Jacket', 'Shirt', 'Knitwear', 'Shoes', 'Hat', 'Bag'], foundVia: ['Google', 'Store'] });
  console.log(`Wrote ${ui.length + fashion.length} entries to ${target}\nRun it with: npm run demo`);
}

main().catch(err => { console.error(err); process.exit(1); });
