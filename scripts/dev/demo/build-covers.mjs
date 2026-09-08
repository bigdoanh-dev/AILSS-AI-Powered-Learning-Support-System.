import { writeFile } from "node:fs/promises";
const covers = [
  [
    "listening",
    "Luyện nghe",
    "#202d68",
    "#89cfea",
    '<path d="M660 390v-70a135 135 0 01270 0v70M660 345h40v115h-40q-30 0-30-30v-55q0-30 30-30M930 345h-40v115h40q30 0 30-30v-55q0-30-30-30"/>',
  ],
  [
    "reading",
    "Đọc hiểu",
    "#254e43",
    "#c5e9a0",
    '<path d="M795 490V235q-75-60-180-25v250q100-30 180 30zm0 0V235q75-60 180-25v250q-100-30-180 30z"/>',
  ],
  [
    "speaking",
    "Luyện nói",
    "#71355e",
    "#fac1dc",
    '<rect x="745" y="190" width="100" height="210" rx="50"/><path d="M700 320v45a95 95 0 00190 0v-45M795 460v65m-65 0h130"/>',
  ],
  [
    "writing",
    "Luyện viết",
    "#784222",
    "#ffd38e",
    '<path d="M650 455l45-115 180-180 70 70-180 180-115 45zm45-115 70 70M665 500h300"/>',
  ],
  [
    "grammar",
    "Ngữ pháp",
    "#304b77",
    "#9cdbfb",
    '<path d="M680 210l-65 135 65 135m230-270 65 135-65 135M825 190l-60 310"/>',
  ],
  [
    "pronunciation",
    "Phát âm",
    "#6c3630",
    "#ffb1a3",
    '<path d="M615 345h35m30-90v180m45-230v280m45-310v340m45-240v140m45-200v260m45-175v90m45-65v40m25-20h35"/>',
  ],
  [
    "vocabulary",
    "Từ vựng",
    "#514274",
    "#d6c1ff",
    '<rect x="610" y="190" width="180" height="230" rx="15" transform="rotate(-14 700 305)"/><rect x="785" y="265" width="180" height="230" rx="15" transform="rotate(12 875 380)"/><path d="M650 280h80m-80 45h80m95 25h85m-85 45h85"/>',
  ],
  [
    "python",
    "Python",
    "#252d4d",
    "#aebafd",
    '<path d="M660 220h245v280H660z"/><path d="M705 285l35 30-35 30m80 0h75m-155 65h155"/>',
  ],
  [
    "javascript",
    "JavaScript",
    "#41370f",
    "#f8df78",
    '<rect x="650" y="200" width="290" height="290" rx="24"/><path d="M750 275v110q0 45-50 25m170-120q-90-40-60 30l35 30q65 70-35 65"/>',
  ],
];
for (const [slug, title, bg, accent, art] of covers) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="853" viewBox="0 0 1100 700"><rect width="1100" height="700" fill="${bg}"/><circle cx="970" cy="150" r="270" fill="${accent}" opacity=".08"/><circle cx="830" cy="550" r="220" fill="${accent}" opacity=".1"/><text x="65" y="105" fill="${accent}" font-family="Arial,sans-serif" font-size="26" letter-spacing="5">AILSS</text><text x="65" y="345" fill="white" font-family="Arial,sans-serif" font-weight="700" font-size="54">${title}</text><text x="65" y="405" fill="${accent}" font-family="Arial,sans-serif" font-size="24">Học • Thực hành • Tiến bộ</text><g fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">${art}</g><path d="M65 575h350" stroke="${accent}" stroke-width="3"/></svg>`;
  await writeFile(new URL(`../../../apps/web/public/assets/media/cover-${slug}.svg`, import.meta.url), svg);
}
