// seed-words.js — stable bidirectional mapping between numeric seeds
// (0..999_999) and human-readable <adjective>-<noun>-<NN> triples.
//
// Encoding uses tail as the high-order digit (not seed % 100) so the
// mapping is injective on the full [0, 1_000_000) range — 128*128*100
// provides 1_638_400 slots.

export const ADJECTIVES = [
  'amber','arctic','azure','bold','brave','bright','calm','celestial',
  'citrine','cobalt','cosmic','crystal','cyan','daring','deep','distant',
  'dusk','ebon','electric','ember','emerald','fabled','feral','fierce',
  'flickering','forest','frost','gentle','ghostly','gilded','glassy','gleaming',
  'glitter','glowing','golden','hazy','hidden','hollow','honeyed','humble',
  'icy','indigo','inky','iron','ivory','jagged','jaded','jewel',
  'keen','kindred','lacquer','lavender','lazy','lilac','lively','lucid',
  'lunar','luminous','marble','meadow','merry','midnight','milky','mirror',
  'misty','molten','mossy','muted','nebula','neon','nimble','noble',
  'nomad','northern','obsidian','ocean','onyx','opal','orbit','pastel',
  'pearl','placid','plum','polar','prism','proud','quartz','quiet',
  'radiant','raven','rose','royal','russet','rustic','saffron','sage',
  'sapphire','scarlet','serene','shadow','silent','silken','silver','smoky',
  'solar','somber','sparkle','starlit','steady','stellar','still','stone',
  'storm','sudden','sunset','swift','tawny','tender','tidal','tiger',
  'twilight','umber','valiant','velvet','verdant','violet','vivid','wandering',
  'warm','whispered','wild','willow','winter','wistful','woven','zephyr',
];

export const NOUNS = [
  'aura','badger','beacon','bear','birch','bloom','bolt','braid',
  'breeze','briar','brook','canyon','cascade','cedar','cinder','citadel',
  'cloud','comet','coral','cove','crane','crest','crow','crystal',
  'daisy','dawn','delta','dew','domain','drift','dune','eagle',
  'echo','ember','falcon','fawn','fern','fjord','flame','fog',
  'forge','fox','frost','garnet','glade','glen','goose','grove',
  'hare','harvest','haven','hawk','heath','hill','horizon','ibis',
  'iris','ivy','jay','kestrel','kite','lake','lantern','lark',
  'leaf','lichen','lion','lotus','lynx','mantle','maple','marsh',
  'meadow','mesa','mist','moor','moss','mountain','nebula','nest',
  'oak','ocean','oracle','orchid','otter','owl','panther','peak',
  'pebble','petal','pine','piper','planet','plume','pond','prism',
  'quasar','quill','rain','rapid','raven','reed','reef','ridge',
  'river','robin','rose','sable','sapling','seed','shore','silhouette',
  'skiff','sky','slope','sparrow','spear','spire','spring','stag',
  'star','stone','stream','summit','sun','swan','thicket','thistle',
  'thorn','tide','tower','trail','twig','valley','vault','veil',
  'vine','vista','wake','wave','whisker','willow','wing','wisp',
];

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0) % 1_000_000;
}

export function seedToWords(seed) {
  const n = Math.abs(Math.trunc(seed)) % 1_000_000;
  const L = ADJECTIVES.length;
  const N = NOUNS.length;
  const adj = ADJECTIVES[n % L];
  const noun = NOUNS[Math.floor(n / L) % N];
  const tail = String(Math.floor(n / (L * N)) % 100).padStart(2, '0');
  return `${adj}-${noun}-${tail}`;
}

export function wordsToSeed(s) {
  const m = typeof s === 'string' && s.match(/^([a-z]+)-([a-z]+)-(\d{1,3})$/);
  if (!m) return hashString(String(s));
  const ai = ADJECTIVES.indexOf(m[1]);
  const ni = NOUNS.indexOf(m[2]);
  const tail = parseInt(m[3], 10);
  if (ai < 0 || ni < 0 || isNaN(tail) || tail < 0 || tail >= 100) return hashString(s);
  const L = ADJECTIVES.length;
  const N = NOUNS.length;
  return ai + L * ni + L * N * tail;
}
