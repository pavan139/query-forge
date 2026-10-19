#!/usr/bin/env node
/**
 * SQL Quest - practice dataset generator.
 *
 * Deterministically generates every practice dataset (seeded PRNG, fixed dates,
 * no use of Math.random() or the current time) and writes:
 *
 *   public/datasets/<id>.sql         DDL + multi-row INSERTs + ANALYZE
 *   content/datasets/catalog.json    machine-readable catalog for the app
 *   content/DATASETS.md              author documentation (facts are computed
 *                                    by querying the generated data in PGlite)
 *
 * Usage:
 *   node scripts/gen-datasets.mjs                 # everything (takes ~1 minute)
 *   node scripts/gen-datasets.mjs --skip-docs     # SQL + catalog only (fast)
 *   node scripts/gen-datasets.mjs --only cafe,app # dev mode: just those SQL files
 *
 * Re-running produces byte-identical output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'public', 'datasets');
const CATALOG_FILE = path.join(ROOT, 'content', 'datasets', 'catalog.json');
const DOCS_FILE = path.join(ROOT, 'content', 'DATASETS.md');

// =============================================================================
// Seeded PRNG (mulberry32) and helpers
// =============================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) {
    this._n = mulberry32(seed);
  }
  next() {
    return this._n();
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this._n();
  }
  /** integer in [a, b] inclusive */
  int(a, b) {
    return a + Math.floor(this._n() * (b - a + 1));
  }
  chance(p) {
    return this._n() < p;
  }
  pick(arr) {
    return arr[Math.floor(this._n() * arr.length)];
  }
  weightedIndex(weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this._n() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
  weighted(items, weights) {
    return items[this.weightedIndex(weights)];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this._n() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  sample(arr, n) {
    return this.shuffle(arr).slice(0, n);
  }
  normal(mean = 0, sd = 1) {
    let u = 0;
    while (u === 0) u = this._n();
    const v = this._n();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  logNormal(mu = 0, sigma = 1) {
    return Math.exp(this.normal(mu, sigma));
  }
  poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this._n();
    } while (p > L);
    return k - 1;
  }
  /** weighted sample WITHOUT replacement (Efraimidis-Spirakis) */
  weightedSample(items, weights, n) {
    const keyed = items.map((it, i) => ({
      it,
      k: weights[i] > 0 ? Math.pow(this._n(), 1 / weights[i]) : -1,
    }));
    keyed.sort((a, b) => b.k - a.k);
    return keyed.slice(0, n).map((x) => x.it);
  }
}

/** Distribute `total` over weights (largest remainder), each slot gets at least `min`. */
function allocate(total, weights, min = 0) {
  const n = weights.length;
  const rest = total - min * n;
  if (rest < 0) throw new Error('allocate: total too small');
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * rest);
  const out = raw.map((x) => Math.floor(x));
  let left = rest - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let i = 0; left > 0; i++, left--) out[order[i % n][1]]++;
  return out.map((x) => x + min);
}

/** Cumulative-weight sampler over index range (for "pick a day by weight"). */
function makeSampler(weights) {
  const cum = [];
  let t = 0;
  for (const w of weights) {
    t += w;
    cum.push(t);
  }
  return {
    total: t,
    cum,
    rangeWeight(lo, hi) {
      return cum[hi] - (lo > 0 ? cum[lo - 1] : 0);
    },
    draw(rng, lo = 0, hi = weights.length - 1) {
      const a = lo > 0 ? cum[lo - 1] : 0;
      const r = a + rng.next() * (cum[hi] - a);
      let l = lo;
      let h = hi;
      while (l < h) {
        const m = (l + h) >> 1;
        if (cum[m] > r) h = m;
        else l = m + 1;
      }
      return l;
    },
  };
}

// ---- dates & timestamps (all UTC, no dependence on "today") ----------------
const DAY = 86400;
const dnum = (s) =>
  Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const dstr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (s, k) => dstr(dnum(s) + k);
const daysBetween = (a, b) => dnum(b) - dnum(a);
/** 0 = Sunday ... 6 = Saturday */
const dow = (s) => (((dnum(s) + 4) % 7) + 7) % 7;
const monthOf = (s) => +s.slice(5, 7);
const yearOf = (s) => +s.slice(0, 4);
/** epoch seconds for a date + time of day */
const tsec = (s, h = 0, m = 0, sec = 0) => dnum(s) * DAY + h * 3600 + m * 60 + sec;
const tstr = (t) => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
const tdate = (t) => dstr(Math.floor(t / DAY));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
function dateRange(from, to) {
  const out = [];
  for (let n = dnum(from); n <= dnum(to); n++) out.push(dstr(n));
  return out;
}
function lastDayOfMonth(y, m) {
  return dstr(Math.floor(Date.UTC(y, m, 0) / 86400000));
}
/** nth (1-based) given weekday (0=Sun) of a month, e.g. 4th Thursday of Nov */
function nthWeekday(y, m, wd, n) {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const off = (wd - dow(first) + 7) % 7;
  return addDays(first, off + 7 * (n - 1));
}

// ---- names -------------------------------------------------------------------
const NAME_GROUPS = [
  {
    w: 30,
    first: 'Emma Liam Olivia Noah Ava Ethan Sophia Lucas Mia Mason Isabella Logan Amelia Oliver Harper Elijah Evelyn James Abigail Benjamin Emily Henry Ella Jack Scarlett Daniel Grace Samuel Chloe Owen Lily Caleb Hannah Nathan Zoe Isaac Nora Miles Ruby Theo Violet Felix Stella Oscar Clara Hugo Alice Arthur Megan Connor Fiona Declan Maeve Rory'.split(' '),
    last: 'Smith Johnson Williams Brown Jones Miller Davis Wilson Anderson Thomas Taylor Moore Jackson Martin Thompson White Harris Clark Lewis Robinson Walker Young Allen King Wright Scott Hill Green Adams Nelson Baker Hall Campbell Mitchell Carter Roberts Murphy Kelly Walsh Byrne Cooper Bennett Foster Reed Brooks Hayes Price Morgan'.split(' '),
  },
  {
    w: 16,
    first: 'Mateo Santiago Valentina Camila Diego Lucia Sofia Carlos Elena Javier Gabriela Andres Ximena Rafael Marisol Alejandro Paola Emilio Daniela Tomas Ines Joaquin Mariana Pablo Rosa Beatriz Thiago'.split(' '),
    last: 'Garcia Rodriguez Martinez Hernandez Lopez Gonzalez Perez Sanchez Ramirez Torres Flores Rivera Fernandez Morales Castillo Ortiz Vargas Silva Santos Oliveira Costa Pereira Almeida Mendoza Reyes Cruz'.split(' '),
  },
  {
    w: 12,
    first: 'Aarav Priya Rohan Ananya Arjun Diya Vikram Meera Ishaan Kavya Rahul Neha Sanjay Aisha Imran Farah Tariq Zainab Omar Layla Sneha Karan Pooja Amit'.split(' '),
    last: 'Patel Sharma Singh Kumar Gupta Reddy Iyer Khan Ali Hussain Mehta Nair Joshi Rao Banerjee Chowdhury Malik Verma'.split(' '),
  },
  {
    w: 12,
    first: 'Wei Mei Hiroshi Yuki Kenji Sakura Minjun Jiwoo Takumi Haruka Jun Xin Hana Daichi Aiko Sungmin Eunji Ming Lian Yuna Kaito Mina Hyun Jia'.split(' '),
    last: 'Chen Wang Li Zhang Liu Yang Huang Kim Park Choi Tanaka Suzuki Sato Watanabe Ito Nakamura Lin Wu Zhao Jung Kang Yamamoto Kobayashi Nguyen Tran Pham'.split(' '),
  },
  {
    w: 7,
    first: 'Chidi Amara Kwame Zuri Tunde Nia Kofi Adaeze Sipho Thandi Amina Yusuf Folake Ayodele Imani Jabari Fatima Seun Naledi Tendai'.split(' '),
    last: 'Okafor Adeyemi Mensah Nkosi Diallo Osei Abdi Kamau Mwangi Balogun Okonkwo Dlamini Ndlovu Boateng Traore Omondi'.split(' '),
  },
  {
    w: 14,
    first: 'Lars Ingrid Sven Freya Matteo Giulia Luca Chiara Pierre Camille Anya Dmitri Katya Nikolai Elif Emre Greta Jonas Lena Pavel Marta Stefan Sofie Nils Anton Elsa Milan Ilse'.split(' '),
    last: 'Muller Schmidt Fischer Weber Meyer Rossi Ferrari Russo Bianchi Dubois Laurent Moreau Petrov Ivanov Kowalski Novak Nielsen Johansson Larsen Andersson Virtanen Olsen Horvat Popov Yilmaz Demir Koval Lindqvist'.split(' '),
  },
  {
    w: 5,
    first: 'Leila Hassan Noor Karim Yasmin Rami Salma Nadia Samir Dina'.split(' '),
    last: 'Haddad Nasser Mansour Khalil Saleh Farouk Aziz Rahman Cohen Levi'.split(' '),
  },
];

/** Unique {first,last} pairs, culturally coherent most of the time. */
function makeNames(rng, n, used = new Set()) {
  const out = [];
  const weights = NAME_GROUPS.map((g) => g.w);
  let guard = 0;
  while (out.length < n) {
    if (++guard > 100000) throw new Error('makeNames: pool exhausted');
    const g = rng.weighted(NAME_GROUPS, weights);
    const first = rng.pick(g.first);
    const last = rng.chance(0.9) ? rng.pick(g.last) : rng.pick(rng.pick(NAME_GROUPS).last);
    const key = `${first} ${last}`;
    if (used.has(key)) continue;
    used.add(key);
    out.push({ first, last, g: NAME_GROUPS.indexOf(g) });
  }
  return out;
}
const emailOf = (first, last, domain = 'example.com') =>
  `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@' + domain;

// =============================================================================
// SQL / table model
// =============================================================================

/** Format a JS value as a SQL literal, using the declared column type. */
function lit(v, type = '') {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number in dataset');
    const m = /^numeric\(\d+,\s*(\d+)\)$/.exec(type);
    if (m) return v.toFixed(+m[1]);
    if (type === 'numeric') return v.toFixed(2);
    if (Number.isInteger(v)) return String(v);
    throw new Error(`non-integer number ${v} for column type ${type}`);
  }
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === 'object') return lit(JSON.stringify(v));
  throw new Error('unsupported literal ' + typeof v);
}

/**
 * Define a table. columns: [name, type, constraints, description]. rows: arrays in
 * column order. opts.constraints: table-level constraint clauses (e.g. composite PK).
 */
function T(name, description, columns, rows, opts = {}) {
  return {
    name,
    description,
    columns: columns.map(([n, type, constraints, desc]) => ({
      name: n,
      type,
      constraints: constraints || '',
      description: desc,
    })),
    rows,
    constraints: opts.constraints || [],
  };
}

function tableDdl(t) {
  const w = Math.max(...t.columns.map((c) => c.name.length));
  const lines = t.columns.map(
    (c) => `    ${c.name.padEnd(w)} ${c.type}${c.constraints ? ' ' + c.constraints : ''}`,
  );
  for (const c of t.constraints) lines.push(`    ${c}`);
  return `CREATE TABLE ${t.name} (\n${lines.join(',\n')}\n);`;
}

function tableInserts(t, chunk = 500) {
  const cols = t.columns.map((c) => c.name).join(', ');
  const types = t.columns.map((c) => c.type);
  const stmts = [];
  for (let i = 0; i < t.rows.length; i += chunk) {
    const part = t.rows.slice(i, i + chunk).map((row) => {
      if (row.length !== types.length)
        throw new Error(`${t.name}: row has ${row.length} values, expected ${types.length}`);
      return '  (' + row.map((v, j) => lit(v, types[j])).join(', ') + ')';
    });
    stmts.push(`INSERT INTO ${t.name} (${cols}) VALUES\n${part.join(',\n')};`);
  }
  return stmts.join('\n\n');
}

function datasetSql(ds) {
  if (ds.sqlOverride) return ds.sqlOverride;
  const out = [
    `-- SQL Quest practice dataset "${ds.id}": ${ds.name}`,
    '-- Generated by scripts/gen-datasets.mjs (deterministic) - edit the generator, not this file.',
    '',
  ];
  for (const t of ds.tables) out.push(tableDdl(t), '');
  for (const t of ds.tables) out.push(tableInserts(t), '');
  out.push('ANALYZE;', '');
  return out.join('\n');
}

/** Human description for the catalog, with PK / FK hints appended automatically. */
function columnCatalogDescription(t, c) {
  let d = c.description;
  const fk = /REFERENCES\s+(\w+)\s*\((\w+)\)/.exec(c.constraints);
  if (fk) d += ` → ${fk[1]}.${fk[2]}`;
  if (/PRIMARY KEY/.test(c.constraints)) d += ' (primary key)';
  else if (
    t.constraints.some((k) => {
      const m = /PRIMARY KEY\s*\(([^)]*)\)/.exec(k);
      return m && m[1].split(',').map((s) => s.trim()).includes(c.name);
    })
  )
    d += ' (part of the primary key)';
  return d;
}

function catalogEntry(ds) {
  return {
    id: ds.id,
    name: ds.name,
    icon: ds.icon,
    tagline: ds.tagline,
    description: ds.description,
    tables: ds.tables.map((t) => ({
      name: t.name,
      description: t.description,
      rowCount: t.rows.length,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        description: columnCatalogDescription(t, c),
      })),
    })),
  };
}

// =============================================================================
// 1. cafe - Bean & Bloom Cafe
// =============================================================================

function buildCafe() {
  const rng = new Rng(1001);

  // ---- menu_items (hand-written, 32 rows) -----------------------------------
  const MENU = [
    // name, category, price, calories, vegan, available, added_on
    ['Drip Coffee', 'Coffee', 1.5, 5, true, true, '2022-03-01'],
    ['Espresso', 'Coffee', 2.5, 5, true, true, '2022-03-01'],
    ['Americano', 'Coffee', 3.0, 10, true, true, '2022-03-01'],
    ['Iced Americano', 'Coffee', 3.5, 10, true, true, '2022-03-01'],
    ['Cappuccino', 'Coffee', 4.25, 120, false, true, '2022-03-01'],
    ['Vanilla Latte', 'Coffee', 4.75, 190, false, true, '2022-03-01'],
    ['Caramel Latte', 'Coffee', 4.95, 250, false, true, '2022-06-15'],
    ['Mocha', 'Coffee', 5.25, 290, false, true, '2022-03-01'],
    ['Earl Grey Tea', 'Tea', 2.75, 0, true, true, '2022-03-01'],
    ['Green Tea', 'Tea', 2.75, 0, true, true, '2022-03-01'],
    ['Peppermint Tea', 'Tea', 2.75, 0, true, true, '2022-03-01'],
    ['Chai Latte', 'Tea', 4.5, 210, false, true, '2022-09-12'],
    ['Matcha Latte', 'Tea', 5.25, 180, false, true, '2023-04-03'],
    ['Butter Croissant', 'Pastry', 3.25, 270, false, true, '2022-03-01'],
    ['Blueberry Muffin', 'Pastry', 3.5, 380, false, true, '2022-03-01'],
    ['Almond Danish', 'Pastry', 3.95, 340, false, true, '2022-03-01'],
    ['Cinnamon Roll', 'Pastry', 4.25, 420, false, true, '2022-10-05'],
    ['Chocolate Chip Cookie', 'Pastry', 2.5, 220, false, true, '2022-03-01'],
    ['Vegan Banana Bread', 'Pastry', 3.75, 290, true, true, '2023-09-18'],
    ['Avocado Toast', 'Sandwich', 8.5, 350, true, true, '2022-05-02'],
    ['Turkey Club', 'Sandwich', 10.5, 620, false, true, '2022-03-01'],
    ['Caprese Panini', 'Sandwich', 9.5, 540, false, true, '2022-08-22'],
    ['Veggie Hummus Wrap', 'Sandwich', 8.95, 410, true, true, '2023-02-13'],
    ['Smoked Salmon Bagel', 'Sandwich', 12.5, null, false, false, '2023-06-05'],
    ['Cheesecake Slice', 'Dessert', 6.5, 450, false, true, '2022-03-01'],
    ['Chocolate Brownie', 'Dessert', 4.25, 410, false, true, '2022-03-01'],
    ['Tiramisu Cup', 'Dessert', 6.95, null, false, false, '2023-11-20'],
    ['Lemon Tart', 'Dessert', 5.5, 330, false, false, '2024-04-08'],
    ['Fresh Orange Juice', 'Juice', 4.95, 110, true, true, '2022-03-01'],
    ['Green Detox Juice', 'Juice', 6.5, null, true, true, '2023-05-15'],
    ['Carrot Ginger Juice', 'Juice', 5.5, 95, true, true, '2024-03-11'],
    ['Berry Smoothie', 'Juice', 6.25, null, true, true, '2024-11-30'],
  ];
  const menuRows = MENU.map((m, i) => [i + 1, ...m]);
  const itemPop = MENU.map((m) => rng.float(0.6, 1.8));
  // a few house favourites
  for (const nm of ['Drip Coffee', 'Caramel Latte', 'Butter Croissant', 'Avocado Toast', 'Vanilla Latte', 'Blueberry Muffin']) {
    itemPop[MENU.findIndex((m) => m[0] === nm)] *= 1.8;
  }

  // ---- customers (28) ----------------------------------------------------------
  const NEVER_ORDERED = [9, 17, 25];
  const names = makeNames(rng, 28);
  const cities = ['Portland', 'Seattle', 'Austin', 'Denver', 'Boston'];
  const joinDays = Array.from({ length: 28 }, () => rng.int(dnum('2022-03-15'), dnum('2024-11-20'))).sort((a, b) => a - b);
  const nullEmailIds = new Set([4, 8, 13, 21, 27]);
  const custRows = names.map((n, i) => {
    const id = i + 1;
    const joined = dstr(joinDays[i]);
    const tenure = daysBetween(joined, '2024-12-31');
    let pts = Math.round(clamp((tenure / 1020) * 650 + rng.float(0, 220), 15, 840) / 5) * 5;
    return [
      id,
      n.first,
      n.last,
      nullEmailIds.has(id) ? null : emailOf(n.first, n.last),
      rng.weighted(cities, [26, 24, 18, 16, 16]),
      joined,
      pts,
    ];
  });
  // loyalty-point quirks: two customers with 0 points, one with the max of 850
  custRows[9 - 1][6] = 0;
  custRows[25 - 1][6] = 0;
  custRows[17 - 1][6] = 25;
  const topIdx = custRows
    .filter((r) => !NEVER_ORDERED.includes(r[0]))
    .reduce((a, b) => (b[6] > a[6] ? b : a));
  topIdx[6] = 850;

  // ---- staff (10) --------------------------------------------------------------
  const staffRows = [
    [1, 'Maria Santos', 'Manager', 28.5, '2022-02-14', null],
    [2, 'Ben Carter', 'Barista', 19.75, '2022-03-01', 1],
    [3, 'Aiko Tanaka', 'Baker', 21.5, '2022-03-01', 1],
    [4, 'Priya Nair', 'Barista', 17.5, '2022-07-18', 2],
    [5, 'Diego Alvarez', 'Barista', 16.75, '2023-02-06', 2],
    [6, 'Hannah Weiss', 'Baker', 18.25, '2023-05-22', 3],
    [7, 'Omar Haddad', 'Cashier', 16.0, '2023-09-11', 2],
    [8, 'Chloe Dubois', 'Cashier', 15.5, '2024-02-19', 2],
    [9, 'Kofi Mensah', 'Barista', 16.25, '2024-06-03', 2],
    [10, 'Lena Fischer', 'Cashier', 15.25, '2024-09-16', 1],
  ];
  const servers = [1, 2, 4, 5, 7, 8, 9, 10];
  const serverW = [3, 24, 20, 18, 10, 8, 12, 5];

  // ---- orders (180) --------------------------------------------------------------
  const N = 180;
  const days = dateRange('2024-10-01', '2024-12-31');
  const closed = new Set(['2024-11-28', '2024-12-25']);
  const dayW = days.map((d, i) => {
    if (closed.has(d)) return 0;
    let w = [1.1, 1.0, 1.0, 1.0, 1.0, 1.1, 1.3][dow(d)];
    w *= 1 + (0.25 * i) / 91;
    if (d >= '2024-12-14' && d <= '2024-12-24') w *= 1.2;
    return w;
  });
  // per-day order counts: proportional to the weights with some day-to-day noise
  const perDay = allocate(N, dayW.map((w) => w * rng.logNormal(0, 0.4)));
  const hourW = [12, 16, 12, 8, 7, 11, 10, 6, 6, 5, 4, 3]; // 07..18
  const slots = [];
  days.forEach((day, di) => {
    for (let k = 0; k < perDay[di]; k++) {
      const h = 7 + rng.weightedIndex(hourW);
      slots.push({ day, h, t: tsec(day, h, rng.int(0, 59), rng.int(0, 59)) });
    }
  });
  slots.sort((a, b) => a.t - b.t);

  // walk-ins: exactly 45 (25%)
  const walkIn = new Set(rng.sample([...Array(N).keys()], 45));
  // regular customers get at least one order each, then weighted by loyalty
  const orderers = custRows.filter((r) => !NEVER_ORDERED.includes(r[0]));
  const custW = new Map(orderers.map((r) => [r[0], rng.logNormal(0, 0.6)]));
  const assigned = new Array(N).fill(null);
  const free = [...Array(N).keys()].filter((i) => !walkIn.has(i));
  const freeSet = new Set(free);
  for (const c of orderers) {
    const options = free.filter((i) => freeSet.has(i) && slots[i].day >= c[5]);
    const pickI = rng.pick(options);
    assigned[pickI] = c[0];
    freeSet.delete(pickI);
  }
  for (const i of free) {
    if (!freeSet.has(i)) continue;
    for (let tries = 0; tries < 200; tries++) {
      const c = rng.weighted(orderers, orderers.map((r) => custW.get(r[0])));
      if (c[5] <= slots[i].day) {
        assigned[i] = c[0];
        break;
      }
    }
    if (assigned[i] === null) throw new Error('cafe: could not assign customer');
  }

  const catW = {
    morning: { Coffee: 46, Tea: 8, Pastry: 26, Sandwich: 8, Dessert: 2, Juice: 10 },
    midday: { Coffee: 22, Tea: 8, Pastry: 8, Sandwich: 34, Dessert: 10, Juice: 18 },
    afternoon: { Coffee: 30, Tea: 18, Pastry: 14, Sandwich: 6, Dessert: 24, Juice: 8 },
  };
  const payM = ['card', 'cash', 'app'];
  const orderBase = slots.map((s, i) => {
    const band = s.h <= 10 ? 'morning' : s.h <= 14 ? 'midday' : 'afternoon';
    const avail = MENU.map((m, k) => k).filter((k) => MENU[k][6] <= s.day);
    const w = avail.map((k) => catW[band][MENU[k][1]] * itemPop[k]);
    const k = rng.weighted(avail, w);
    const qty = rng.weighted([1, 2, 3, 4], [78, 14, 5, 3]);
    const method = rng.weighted(payM, walkIn.has(i) ? [40, 42, 18] : [54, 22, 24]);
    return { s, itemId: k + 1, qty, method, cust: assigned[i] };
  });
  // exactly 54 NULL tips (30%), cash payers more likely
  const nullTip = new Set(
    rng.weightedSample([...Array(N).keys()], orderBase.map((o) => (o.method === 'cash' ? 2.2 : 1)), 54),
  );
  const orderRows = orderBase.map((o, i) => {
    let tip = null;
    if (!nullTip.has(i)) {
      tip =
        o.method === 'cash'
          ? rng.weighted([0, 0.25, 0.5, 1], [45, 15, 25, 15])
          : rng.weighted([0, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5], [6, 10, 6, 22, 8, 14, 14, 6, 8, 4, 2]);
    }
    return [
      i + 1,
      o.cust,
      o.itemId,
      rng.weighted(servers, serverW),
      o.qty,
      tstr(o.s.t),
      o.method,
      tip,
    ];
  });

  const tables = [
    T(
      'menu_items',
      'Everything on the menu: one row per drink, pastry, sandwich, dessert or juice.',
      [
        ['item_id', 'integer', 'PRIMARY KEY', 'Unique id of the menu item'],
        ['name', 'text', 'NOT NULL', 'Name of the item as printed on the menu'],
        ['category', 'text', 'NOT NULL', 'Menu section: Coffee, Tea, Pastry, Sandwich, Dessert or Juice'],
        ['price', 'numeric(5,2)', 'NOT NULL', 'Current price in dollars'],
        ['calories', 'integer', '', 'Calories per serving (empty when we have not measured it yet)'],
        ['is_vegan', 'boolean', 'NOT NULL', 'TRUE if the item contains no animal products'],
        ['is_available', 'boolean', 'NOT NULL', 'TRUE if we can sell it today'],
        ['added_on', 'date', 'NOT NULL', 'Date the item was added to the menu'],
      ],
      menuRows,
    ),
    T(
      'customers',
      'Café regulars who joined the loyalty program.',
      [
        ['customer_id', 'integer', 'PRIMARY KEY', 'Unique id of the customer'],
        ['first_name', 'text', 'NOT NULL', 'Given name'],
        ['last_name', 'text', 'NOT NULL', 'Family name'],
        ['email', 'text', '', 'Email address (empty if the customer did not share one)'],
        ['city', 'text', 'NOT NULL', 'City where the customer lives'],
        ['joined_on', 'date', 'NOT NULL', 'Date the customer joined the loyalty program'],
        ['loyalty_points', 'integer', 'NOT NULL DEFAULT 0', 'Loyalty points collected so far'],
      ],
      custRows,
    ),
    T(
      'staff',
      'The café team, including who reports to whom.',
      [
        ['staff_id', 'integer', 'PRIMARY KEY', 'Unique id of the staff member'],
        ['name', 'text', 'NOT NULL', 'Full name'],
        ['role', 'text', 'NOT NULL', 'Job role: Manager, Barista, Baker or Cashier'],
        ['hourly_rate', 'numeric(5,2)', 'NOT NULL', 'Pay per hour in dollars'],
        ['hired_on', 'date', 'NOT NULL', 'Date the person was hired'],
        ['manager_id', 'integer', 'REFERENCES staff (staff_id)', 'The staff member this person reports to (empty for the top manager)'],
      ],
      staffRows,
    ),
    T(
      'orders',
      'One row per order: a single menu item (with a quantity) bought by a customer or a walk-in.',
      [
        ['order_id', 'integer', 'PRIMARY KEY', 'Unique id of the order'],
        ['customer_id', 'integer', 'REFERENCES customers (customer_id)', 'Who ordered (empty for walk-in customers without a loyalty card)'],
        ['item_id', 'integer', 'NOT NULL REFERENCES menu_items (item_id)', 'What was ordered'],
        ['staff_id', 'integer', 'NOT NULL REFERENCES staff (staff_id)', 'Staff member who served the order'],
        ['quantity', 'integer', 'NOT NULL CHECK (quantity > 0)', 'How many of the item were ordered'],
        ['order_time', 'timestamp', 'NOT NULL', 'Date and time the order was placed'],
        ['payment_method', 'text', 'NOT NULL', 'How the customer paid: cash, card or app'],
        ['tip', 'numeric(4,2)', '', 'Tip in dollars (empty when no tip information was recorded)'],
      ],
      orderRows,
    ),
  ];

  return {
    id: 'cafe',
    name: 'Bean & Bloom Café',
    icon: '☕',
    tagline: 'A tiny neighborhood café: perfect for your very first queries.',
    description:
      'Bean & Bloom is a cosy café with a short menu, a handful of regulars and a few months of orders. ' +
      'The tables are small enough to read at a glance, so it is the ideal place to learn SELECT, WHERE, ORDER BY and your first JOIN. ' +
      'Some values are missing on purpose (emails, calories, tips) so you can meet NULL early.',
    tables,
    extra: { NEVER_ORDERED },
  };
}

// ---- documentation: cafe ----------------------------------------------------------------
async function docCafe(q) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const nullCal = await list('SELECT name AS v FROM menu_items WHERE calories IS NULL ORDER BY item_id');
  const unavailable = await list('SELECT name AS v FROM menu_items WHERE NOT is_available ORDER BY item_id');
  const neverOrdered = await list('SELECT customer_id::text AS v FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id) ORDER BY customer_id');
  const noEmail = await list('SELECT customer_id::text AS v FROM customers WHERE email IS NULL ORDER BY customer_id');
  const zeroPts = await list('SELECT customer_id::text AS v FROM customers WHERE loyalty_points = 0 ORDER BY customer_id');
  const span = (await q.rows("SELECT min(order_time)::text AS a, max(order_time)::text AS b, min(extract(hour FROM order_time))::int AS h1, max(extract(hour FROM order_time))::int AS h2, count(DISTINCT order_time::date) AS days FROM orders"))[0];
  const walk = await q.val('SELECT count(*) FROM orders WHERE customer_id IS NULL');
  const nOrders = await q.val('SELECT count(*) FROM orders');
  const nullTips = await q.val('SELECT count(*) FROM orders WHERE tip IS NULL');
  const zeroTips = await q.val('SELECT count(*) FROM orders WHERE tip = 0');
  const multi = await q.val('SELECT count(*) FROM orders WHERE quantity > 1');
  const closedDays = await q.val("SELECT count(*) FROM orders WHERE order_time::date IN ('2024-11-28', '2024-12-25')");
  const noServ = await q.val('SELECT count(*) FROM menu_items m WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.item_id = m.item_id)');
  const veganAvail = await q.val('SELECT count(*) FROM menu_items WHERE is_vegan');
  const perDay = (await q.rows("WITH d AS (SELECT order_time::date AS d, count(*) AS n FROM orders GROUP BY 1) SELECT round(avg(n) FILTER (WHERE extract(dow FROM d) NOT IN (0, 6)), 2)::text AS weekday, round(avg(n) FILTER (WHERE extract(dow FROM d) IN (0, 6)), 2)::text AS weekend FROM d"))[0];
  const tipsBy = await list("SELECT payment_method || ' ' || round(avg(tip), 2) AS v FROM orders GROUP BY payment_method ORDER BY payment_method");
  const tipRange = (await q.rows('SELECT min(tip) FILTER (WHERE tip > 0)::text AS lo, max(tip)::text AS hi FROM orders'))[0];
  const catUnits = await list('SELECT m.category || \' \' || sum(o.quantity) AS v FROM orders o JOIN menu_items m ON m.item_id = o.item_id GROUP BY m.category ORDER BY sum(o.quantity) DESC, m.category');
  const bakerOrders = await q.val("SELECT count(*) FROM orders o JOIN staff s ON s.staff_id = o.staff_id WHERE s.role = 'Baker'");
  const monthOrders = await list("SELECT to_char(order_time, 'Mon') || ' ' || count(*) AS v FROM orders GROUP BY date_trunc('month', order_time), to_char(order_time, 'Mon') ORDER BY date_trunc('month', order_time)");

  return {
    about:
      'The café is deliberately tiny so that learners can look at a whole table on one screen. Start single-table lessons with `menu_items` (32 rows) and `customers` (28 rows); `orders` is the only table big enough to need LIMIT and aggregation. ' +
      '"As of" date: **2024-12-31** (the last order is in the morning of that day).',
    conventions: [
      `Orders cover **${span.a.slice(0, 10)} to ${span.b.slice(0, 10)}** (${span.days} of the 92 calendar days have at least one order). Order times are between ${String(span.h1).padStart(2, '0')}:00 and ${String(span.h2 + 1).padStart(2, '0')}:00 (opening hours 07:00-19:00, last hour is ${span.h2}:xx). The busiest time of day is the morning rush (see the facts below); orders per month: ${monthOrders}. On days that have orders, a weekday averages ${perDay.weekday} orders and a Saturday or Sunday ${perDay.weekend}.`,
      `The café is closed on Thanksgiving (2024-11-28) and Christmas Day (2024-12-25): ${closedDays} orders on those two dates.`,
      'There is **no separate price column on orders**: the line total is `quantity * menu_items.price` (current menu price). `menu_items.is_available` describes today\'s menu, so past orders may contain items that are unavailable now. No order contains an item before its `added_on` date.',
      `Units sold per category (best first): ${catUnits}. The item mix follows the time of day: coffee and pastries in the morning, sandwiches and juice around lunch, coffee, tea and dessert in the afternoon.`,
      `Staff hierarchy has three levels: manager (staff 1) → shift leads (staff 2 the senior barista, staff 3 the head baker) → the rest. Bakers (staff 3 and 6) do not work the counter: ${bakerOrders} orders were served by a baker, so \`orders.staff_id\` only contains baristas, cashiers and the manager.`,
      'Customers who joined the loyalty program are numbered in join-date order. Loyalty points roughly track how long someone has been a member; they are **not** computed from the orders table.',
    ],
    quirks: [
      `**${(await q.val('SELECT count(*) FROM menu_items WHERE calories IS NULL'))} menu items have NULL calories:** ${nullCal}. (Teas have calories = 0, which is a real value and not NULL.)`,
      `**${(await q.val('SELECT count(*) FROM menu_items WHERE NOT is_available'))} items are unavailable:** ${unavailable}. ${veganAvail} of the 32 items are vegan. ${noServ} menu items were never ordered.`,
      `**${(await q.val('SELECT count(*) FROM customers WHERE email IS NULL'))} customers have no email** (customer_id ${noEmail}).`,
      `**Customers who never ordered:** customer_id ${neverOrdered} (anti-join / \`NOT EXISTS\` / \`LEFT JOIN ... IS NULL\` practice). Customers ${zeroPts} have 0 loyalty points; the maximum is ${await q.val('SELECT max(loyalty_points) FROM customers')}.`,
      `**Walk-in orders:** ${walk} of ${nOrders} orders (${((walk / nOrders) * 100).toFixed(0)}%) have \`customer_id\` NULL.`,
      `**Tips:** ${nullTips} orders (${((nullTips / nOrders) * 100).toFixed(0)}%) have a NULL tip ("not recorded"), another ${zeroTips} have an explicit tip of 0.00; the rest are between ${tipRange.lo} and ${tipRange.hi}. Average recorded tip by payment method: ${tipsBy} (cash payers tip the least).`,
      `**Quantity** is 1 for most orders; ${multi} orders have quantity 2 to 4.`,
      '`staff.manager_id` is NULL for exactly one person (the manager) and the table is a classic self-join / recursive-CTE example in miniature.',
    ],
    facts: [
      await f('Orders in total', 'SELECT count(*) FROM orders', 'int'),
      await f('Revenue in the quarter (sum of quantity * price)', 'SELECT sum(o.quantity * m.price) FROM orders o JOIN menu_items m ON m.item_id = o.item_id', 'money'),
      await f('Orders per month', "SELECT to_char(order_time, 'YYYY-MM') AS month, count(*) AS orders FROM orders GROUP BY 1 ORDER BY 1", 'pairs'),
      await f('Orders per payment method', 'SELECT payment_method, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Best-selling item by units sold', 'SELECT m.name || \' (\' || sum(o.quantity) || \' units)\' FROM orders o JOIN menu_items m ON m.item_id = o.item_id GROUP BY m.item_id, m.name ORDER BY sum(o.quantity) DESC, m.name LIMIT 1'),
      await f('Units sold per category', 'SELECT m.category, sum(o.quantity) AS units FROM orders o JOIN menu_items m ON m.item_id = o.item_id GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Busiest hour of the day (by number of orders)', "SELECT extract(hour FROM order_time)::int || ':00 (' || count(*) || ' orders)' FROM orders GROUP BY extract(hour FROM order_time) ORDER BY count(*) DESC, 1 LIMIT 1"),
      await f('Average tip where a tip was recorded', 'SELECT round(avg(tip), 2) FROM orders WHERE tip IS NOT NULL', 'text'),
      await f('Customer with the most orders', 'SELECT c.first_name || \' \' || c.last_name || \' (customer \' || c.customer_id || \', \' || count(*) || \' orders)\' FROM orders o JOIN customers c ON c.customer_id = o.customer_id GROUP BY c.customer_id, c.first_name, c.last_name ORDER BY count(*) DESC, c.customer_id LIMIT 1'),
      await f('Average menu price per category', 'SELECT category, round(avg(price), 2) AS avg_price FROM menu_items GROUP BY 1 ORDER BY 1', 'pairs'),
    ],
    topics: [
      'SELECT, WHERE, ORDER BY, LIMIT, DISTINCT on `menu_items` and `customers`.',
      'IS NULL / IS NOT NULL, COALESCE on `calories`, `email`, `tip`, `customer_id`.',
      'Aggregates and GROUP BY on `orders` (revenue per category, orders per hour or per weekday).',
      'First JOIN (`orders` to `menu_items`), LEFT JOIN to find customers without orders, self join on `staff`.',
      'Date functions on `order_time` (`date_trunc`, `extract`, `to_char`).',
    ],
  };
}

// =============================================================================
// 2. shop - ShopSmart online store
// =============================================================================

const SHOP_CODES = {
  WELCOME10: 0.1,
  SUMMER15: 0.15,
  BLACKFRIDAY: 0.2,
  LOYALTY5: 0.05,
  FREESHIP: 0,
};

const REVIEW_TEXT = {
  5: [
    'Absolutely love it, exactly what I needed.',
    'Great quality and arrived earlier than expected.',
    'Works perfectly. Would buy again.',
    'Exceeded my expectations for the price.',
    'Five stars - my whole family uses it every day.',
    'Beautifully made and easy to use.',
    'Best purchase I have made this year.',
    'Fantastic value, highly recommended.',
    'Setup took two minutes and it just works.',
    'Looks even better in person.',
    'Solid build and great design.',
    'Cannot recommend this enough.',
  ],
  4: [
    'Very good overall, just a small niggle with the packaging.',
    'Does what it says. Happy with it.',
    'Good quality for the money.',
    'Nice product, shipping was a little slow.',
    'Works well, would have liked a longer cable.',
    'Pretty happy, instructions could be clearer.',
    'Solid choice. Almost perfect.',
    'Good value and good looks.',
    'Better than the one it replaced.',
    'Comfortable and sturdy, minor scuffs on arrival.',
  ],
  3: [
    'It is okay. Nothing special.',
    'Average quality, but it does the job.',
    'Decent for the price, not amazing.',
    'Works, but feels a bit flimsy.',
    'Fine for occasional use.',
    'Took a while to arrive, product is acceptable.',
    'Not bad, not great.',
    'Expected a little more from the description.',
  ],
  2: [
    'Disappointed - it feels cheaper than it looks.',
    'Stopped working properly after a few weeks.',
    'Smaller than I expected.',
    'Instructions were confusing and parts were missing.',
    'Poor finish and a strange smell at first.',
    'Would not buy again.',
    'Not as described.',
    'Customer service was helpful but the product was not.',
  ],
  1: [
    'Arrived broken.',
    'Complete waste of money.',
    'Died after two uses.',
    'Nothing like the photos. Returning it.',
    'Terrible quality, avoid.',
    'Did not work out of the box.',
    'Very disappointed, asking for a refund.',
    'Fell apart on day three.',
  ],
};

function buildShop() {
  const rng = new Rng(2002);
  const START = '2023-01-01';
  const END = '2024-12-31';

  // ---- categories (14 rows, 3-level tree) --------------------------------------
  const catRows = [
    [1, 'Electronics', null],
    [2, 'Home', null],
    [3, 'Sports', null],
    [4, 'Books', null],
    [5, 'Toys', null],
    [6, 'Beauty', null],
    [7, 'Computers', 1],
    [8, 'Phones', 1],
    [9, 'Kitchen', 2],
    [10, 'Furniture', 2],
    [11, 'Outdoor', 3],
    [12, 'Laptops', 7],
    [13, 'Peripherals', 7],
    [14, 'Camping', 11],
  ];

  // ---- suppliers (8) ----------------------------------------------------------------
  const supRows = [
    [1, 'Lumen Trading Co.', 'United States', 'sales.lumen@example.com'],
    [2, 'Kestrel Supply GmbH', 'Germany', 'info.kestrel@example.org'],
    [3, 'Tanuki Goods Ltd.', 'Japan', null],
    [4, 'Jade River Manufacturing', 'China', 'export.jaderiver@example.com'],
    [5, 'Nordlys Distribution', 'Sweden', 'hej.nordlys@example.org'],
    [6, 'Casa Verde Exports', 'Mexico', 'ventas.casaverde@example.com'],
    [7, 'Orchid & Oak Imports', 'United Kingdom', null],
    [8, 'Pioneer Peak Supply', 'Canada', 'orders.pioneerpeak@example.org'],
  ];

  // ---- products (60 rows) -------------------------------------------------------------
  // [name, category_id, price, supplier_id]
  const P = [
    ['Aurora 14-inch Laptop', 12, 899.99, 4],
    ['Aurora 16-inch Pro Laptop', 12, 1499.99, 4],
    ['Nimbus Air 13 Ultrabook', 12, 1099.99, 3],
    ['Terra Student Laptop 15', 12, 549.99, 4],
    ['Zephyr Gaming Laptop X', 12, 1299.99, 4], // 5  never ordered (new)
    ['Wireless Ergonomic Mouse', 13, 29.99, 3],
    ['Mechanical Keyboard K75', 13, 89.99, 4],
    ['27-inch 4K Monitor', 13, 379.99, 3],
    ['HD Webcam 1080p', 13, 49.99, 4],
    ['Noise-Cancelling Headset', 13, 129.99, 2],
    ['7-Port USB-C Hub', 13, 39.99, 4],
    ['Laptop Stand, Aluminum', 13, 34.99, 2],
    ['Desk Mat XL', 13, 19.99, 4], // 13 inactive
    ['Mini Desktop PC Cube', 7, 649.99, 3],
    ['10-inch Tablet Lite', 7, 229.99, 4],
    ['Portable SSD 1TB', 7, 99.99, 3],
    ['Lumio Phone S5', 8, 699.99, 3],
    ['Lumio Phone S5 Plus', 8, 899.99, 3],
    ['Budget Phone Go', 8, 179.99, 4], // 19 inactive
    ['Fast Charger 65W', 8, 34.99, 4],
    ['Phone Case, Clear', 8, 14.99, 4],
    ['Wireless Earbuds Pulse', 8, 79.99, 3],
    ['Screen Protector 3-Pack', 8, 9.99, 4],
    ['Power Bank 20000mAh', 8, 44.99, 4],
    ['Stainless Steel Cookware Set', 9, 189.99, 5],
    ["Chef's Knife 8-inch", 9, 59.99, 2],
    ['Programmable Coffee Maker', 9, 79.99, 2],
    ['Blender Pro 1200', 9, 99.99, 1],
    ['Air Fryer 5L', 9, 119.99, 4],
    ['Cast Iron Skillet 12-inch', 9, 39.99, 1],
    ['Glass Food Storage Set', 9, 29.99, 5],
    ['Electric Kettle 1.7L', 9, 34.99, 2],
    ['Ergonomic Office Chair', 10, 249.99, 8],
    ['Standing Desk 140cm', 10, 449.99, 5], // 34 never ordered (new)
    ['Bookshelf, Walnut Finish', 10, 129.99, 5],
    ['Floor Lamp, Brass', 10, 69.99, 5],
    ['Memory Foam Pillow', 10, 39.99, 8], // 37 inactive
    ['Trail Running Backpack 25L', 11, 79.99, 8],
    ['Insulated Water Bottle 1L', 11, 24.99, 8],
    ['Yoga Mat Premium', 11, 34.99, 1],
    ['2-Person Camping Tent', 14, 159.99, 8],
    ['Sleeping Bag -5C', 14, 89.99, 8],
    ['Headlamp 400 Lumens', 14, 24.99, 1],
    ['Portable Camp Stove', 14, 44.99, 8],
    ["The Beginner's Guide to Sourdough", 4, 19.99, 7],
    ['Mysteries of the Deep Sea', 4, 29.99, 7], // 46 never ordered (dead stock)
    ['Learn SQL in 30 Days', 4, 34.99, null], // 47 no supplier
    ['Atlas of Hidden Cities', 4, 39.99, 7],
    ['The Midnight Gardener', 4, 14.99, 7],
    ['Mindful Mornings Journal', 4, 16.99, null], // 50 no supplier
    ['Quick & Easy Weeknight Dinners', 4, 24.99, 1],
    ['Wooden Building Blocks 100pc', 5, 29.99, 2],
    ['Remote Control Rover', 5, 49.99, 4],
    ['Jigsaw Puzzle 1000pc: Harbor Sunrise', 5, 19.99, 2],
    ['Plush Dragon, Large', 5, 24.99, 4], // 55 inactive
    ['Science Lab Starter Kit', 5, 39.99, 2], // 56 never ordered (new)
    ['Strategy Board Game: Trade Winds', 5, 44.99, 2],
    ['Hydrating Face Serum', 6, 28.99, 6],
    ['Vitamin C Moisturizer', 6, 24.49, 6],
    ['Natural Bamboo Hairbrush', 6, 12.49, null], // 60 no supplier, never ordered
  ];
  const NEVER_ORDERED_PRODUCTS = new Set([5, 34, 46, 56, 60]);
  const FIXED_CREATED = { 5: '2024-12-02', 34: '2024-11-20', 56: '2024-12-05' };
  const INACTIVE = { 13: '2023-10-15', 19: '2024-03-01', 37: '2024-05-20', 55: '2023-12-01' }; // id -> last day sold
  const ZERO_STOCK = new Set([9, 13, 19, 22, 49, 55]);
  // price changes: id -> [change date, old price]
  const PRICE_CHANGE = {};
  for (const id of [6, 20, 27, 45]) {
    const price = P[id - 1][2];
    PRICE_CHANGE[id] = ['2023-09-01', Math.floor(price * 0.92) + 0.99];
  }
  for (const id of [1, 8, 17, 31]) {
    const price = P[id - 1][2];
    PRICE_CHANGE[id] = ['2024-06-01', Math.floor(price * 1.1) + 0.99];
  }

  const prodInfo = P.map(([name, cat, price, sup], i) => {
    const id = i + 1;
    let created;
    if (FIXED_CREATED[id]) created = FIXED_CREATED[id];
    else if (rng.chance(0.62)) created = dstr(rng.int(dnum('2022-05-10'), dnum('2022-12-20')));
    else created = dstr(rng.int(dnum('2023-02-01'), dnum('2024-09-30')));
    if (INACTIVE[id]) created = dstr(rng.int(dnum('2022-05-10'), dnum('2022-12-20')));
    if (NEVER_ORDERED_PRODUCTS.has(id) && !FIXED_CREATED[id]) created = dstr(rng.int(dnum('2022-06-01'), dnum('2022-11-30')));
    const cost = r2(price * rng.float(0.45, 0.72));
    let stock;
    if (ZERO_STOCK.has(id)) stock = 0;
    else if (id === 37) stock = 14;
    else if (price > 400) stock = rng.int(4, 45);
    else if (price > 100) stock = rng.int(15, 140);
    else stock = rng.int(40, 480);
    const pop = (1 / Math.pow(price, 0.35)) * rng.logNormal(0, 0.55);
    return { id, name, cat, price, sup, created, cost, stock, active: !INACTIVE[id], pop };
  });
  const productRows = prodInfo.map((p) => [p.id, p.name, p.cat, p.sup, p.price, p.cost, p.stock, p.active, p.created]);

  // ---- customers (150 rows) ----------------------------------------------------------------
  const CITIES = [
    ['Seattle', 'WA', '206', 8],
    ['Portland', 'OR', '503', 4],
    ['San Francisco', 'CA', '415', 8],
    ['Los Angeles', 'CA', '213', 11],
    ['Austin', 'TX', '512', 7],
    ['Houston', 'TX', '713', 8],
    ['Denver', 'CO', '303', 6],
    ['Chicago', 'IL', '312', 10],
    ['Boston', 'MA', '617', 6],
    ['New York', 'NY', '212', 14],
    ['Atlanta', 'GA', '404', 6],
    ['Miami', 'FL', '305', 5],
    ['Phoenix', 'AZ', '602', 5],
    ['Minneapolis', 'MN', '612', 3],
  ];
  const cNames = makeNames(rng, 150);
  const signupDays = [
    ...Array.from({ length: 140 }, () => dnum('2022-06-01') + Math.floor(Math.pow(rng.next(), 1.7) * (dnum('2024-10-11') - dnum('2022-06-01')))).sort((a, b) => a - b),
    ...Array.from({ length: 10 }, () => rng.int(dnum('2024-10-12'), dnum('2024-10-31'))).sort((a, b) => a - b),
  ];
  signupDays[0] = dnum('2022-06-01');
  signupDays[149] = dnum('2024-10-31');
  const noPhone = new Set(rng.sample([...Array(150).keys()], 30));
  const noBirth = new Set(rng.sample([...Array(150).keys()], 15));
  const cust = cNames.map((n, i) => {
    const id = i + 1;
    const [city, state, area] = rng.weighted(CITIES, CITIES.map((c) => c[3]));
    const signup = dstr(signupDays[i]);
    const birth = dstr(rng.int(dnum('1950-01-01'), dnum('2005-06-30')));
    return {
      id,
      first: n.first,
      last: n.last,
      email: emailOf(n.first, n.last, rng.chance(0.8) ? 'example.com' : 'example.org'),
      phone: noPhone.has(i) ? null : `(${area}) 555-01${String(rng.int(0, 99)).padStart(2, '0')}`,
      city,
      state,
      signup,
      birth: noBirth.has(i) ? null : birth,
      segment: rng.weighted(['Consumer', 'Corporate', 'Home Office'], [60, 25, 15]),
    };
  });
  const customerRows = cust.map((c) => [c.id, c.first, c.last, c.email, c.phone, c.city, c.state, c.signup, c.birth, c.segment]);

  // ---- orders ---------------------------------------------------------------------------------
  const days = dateRange(START, END);
  const BF = { 2023: '2023-11-24', 2024: '2024-11-29' };
  const MONTH_W = [0.78, 0.74, 0.84, 0.9, 0.95, 0.95, 0.98, 0.9, 0.95, 1.05, 1.45, 1.7];
  const dayW = days.map((d, i) => {
    const y = yearOf(d);
    const m = monthOf(d);
    let w = MONTH_W[m - 1] * (1 + (0.25 * i) / 730) * [1.05, 0.95, 0.95, 1, 1, 1.05, 1.1][dow(d)];
    const off = daysBetween(BF[y], d);
    if (off === 0) w *= 3.2;
    else if (off === 3) w *= 2.4;
    else if (off >= -1 && off <= 4) w *= 1.5;
    return w;
  });
  const sampler = makeSampler(dayW);
  const TARGET_ORDERS = 900;
  const active = cust.slice(0, 140);
  const lo = active.map((c) => dnum(addDays(c.signup, 1) > START ? addDays(c.signup, 1) : START) - dnum(START));
  const expected = active.map((c, i) => Math.min(rng.logNormal(0, 0.9), 4) * sampler.rangeWeight(lo[i], days.length - 1));
  const counts = allocate(TARGET_ORDERS, expected, 1);
  let skel = [];
  active.forEach((c, i) => {
    for (let k = 0; k < counts[i]; k++) skel.push({ cust: c, date: days[sampler.draw(rng, lo[i])] });
  });
  skel.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cust.id - b.cust.id));
  const firstOrderOf = new Map();
  const orderCount = new Map();
  for (const o of skel) {
    if (!firstOrderOf.has(o.cust.id)) firstOrderOf.set(o.cust.id, o);
  }
  const lagW = [8, 30, 30, 17, 10, 5];
  const orders = skel.map((o, idx) => {
    const id = idx + 1;
    const age = daysBetween(o.date, END);
    const lag = rng.weightedIndex(lagW);
    const r = rng.next();
    let status;
    if (age <= 3) status = r < 0.6 ? 'processing' : r < 0.88 ? 'shipped' : 'cancelled';
    else if (age <= 7) status = r < 0.55 ? 'shipped' : r < 0.8 ? 'delivered' : r < 0.88 ? 'processing' : 'cancelled';
    else if (age <= 14) status = r < 0.72 ? 'delivered' : r < 0.82 ? 'shipped' : r < 0.87 ? 'returned' : 'cancelled';
    else status = r < 0.715 ? 'delivered' : r < 0.835 ? 'returned' : r < 0.99 ? 'cancelled' : 'shipped';
    let shipped = null;
    if (status === 'shipped' || status === 'delivered' || status === 'returned') {
      shipped = addDays(o.date, Math.min(lag, age));
    }
    // discount code
    const y = yearOf(o.date);
    const off = daysBetween(BF[y], o.date);
    const mmdd = o.date.slice(5);
    const prior = orderCount.get(o.cust.id) || 0;
    orderCount.set(o.cust.id, prior + 1);
    let code = null;
    if (off >= -1 && off <= 4 && rng.chance(0.45)) code = 'BLACKFRIDAY';
    else if (mmdd >= '06-15' && mmdd <= '08-31' && rng.chance(0.2)) code = 'SUMMER15';
    else if (prior === 0 && rng.chance(0.3)) code = 'WELCOME10';
    else if (prior >= 4 && rng.chance(0.05)) code = 'LOYALTY5';
    else if (rng.chance(0.015)) code = 'FREESHIP';
    const shipCity = rng.chance(0.88) ? o.cust.city : rng.pick(CITIES)[0];
    return { id, cust: o.cust, date: o.date, status, shipped, shipCity, code };
  });
  const orderRows = orders.map((o) => [o.id, o.cust.id, o.date, o.status, o.shipped, o.shipCity, o.code]);

  // ---- order_items ---------------------------------------------------------------------------------
  const nItemsW = [26, 30, 23, 13, 8];
  const items = [];
  const lastSold = (id) => INACTIVE[id] || '9999-12-31';
  for (const o of orders) {
    const avail = prodInfo.filter((p) => !NEVER_ORDERED_PRODUCTS.has(p.id) && p.created <= o.date && o.date <= lastSold(p.id));
    const n = Math.min(rng.weighted([1, 2, 3, 4, 5], nItemsW), avail.length);
    const chosen = rng.weightedSample(avail, avail.map((p) => p.pop), n);
    o.lines = chosen.map((p) => {
      const change = PRICE_CHANGE[p.id];
      const unit = change && o.date < change[0] ? change[1] : p.price;
      let qty;
      if (p.price > 500) qty = 1;
      else if (p.price > 150) qty = rng.chance(0.88) ? 1 : 2;
      else if (p.price < 20) qty = rng.weighted([1, 2, 3, 4, 5], [48, 26, 14, 8, 4]);
      else qty = rng.weighted([1, 2, 3, 4], [70, 20, 7, 3]);
      let disc = 0;
      if (o.code) disc = SHOP_CODES[o.code];
      else if (rng.chance(0.06)) disc = rng.pick([0.05, 0.1]);
      return { p, unit, qty, disc };
    });
  }
  const itemRows = [];
  for (const o of orders) {
    let subtotal = 0; // in 1e-4 dollars
    for (const l of o.lines) {
      itemRows.push([itemRows.length + 1, o.id, l.p.id, l.qty, l.unit, l.disc]);
      subtotal += l.qty * Math.round(l.unit * 100) * (100 - Math.round(l.disc * 100));
    }
    o.totalCents = Math.floor((subtotal + 50) / 100);
  }

  // ---- payments -------------------------------------------------------------------------------------------
  const nonCancelled = orders.filter((o) => o.status !== 'cancelled');
  const unpaid = new Set();
  const pickUnpaid = (pred, n) => {
    const pool = rng.shuffle(nonCancelled.filter((o) => !unpaid.has(o.id) && pred(o)));
    for (const o of pool.slice(0, n)) unpaid.add(o.id);
  };
  pickUnpaid((o) => o.status === 'processing', 6);
  pickUnpaid((o) => o.status === 'shipped' && daysBetween(o.date, END) <= 14, 3);
  pickUnpaid((o) => o.status === 'delivered' && o.cust.segment === 'Corporate' && o.date >= '2024-10-01' && o.totalCents >= 20000, 15 - unpaid.size);
  pickUnpaid((o) => o.status === 'delivered' && o.date >= '2024-10-01', 15 - unpaid.size);
  const paidOrders = nonCancelled.filter((o) => !unpaid.has(o.id));
  const splitIds = new Set(rng.sample(paidOrders.filter((o) => o.totalCents >= 8000).map((o) => o.id), 20));
  const payList = [];
  const endTs = tsec(END, 23, 59, 59);
  for (const o of paidOrders) {
    const seg = o.cust.segment;
    const method = rng.weighted(
      ['card', 'paypal', 'gift_card', 'bank_transfer'],
      seg === 'Corporate' ? [45, 10, 4, 41] : [62, 24, 6, 8],
    );
    const base = tsec(o.date, rng.int(6, 23), rng.int(0, 59), rng.int(0, 59));
    const when = (m, t) => {
      let ts = t;
      if (m === 'bank_transfer') ts += rng.int(1, 3) * DAY;
      return Math.min(ts, endTs);
    };
    if (splitIds.has(o.id)) {
      const total = o.totalCents;
      let first = Math.round((total * rng.float(0.25, 0.55)) / 500) * 500;
      first = Math.min(Math.max(first, 500), total - 500);
      const m1 = rng.chance(0.6) ? 'gift_card' : rng.pick(['card', 'paypal']);
      const m2 = m1 === 'gift_card' ? rng.pick(['card', 'paypal', 'card']) : rng.pick(['card', 'paypal'].filter((x) => x !== m1).concat(['gift_card']));
      const t1 = when(m1, base);
      payList.push({ o, cents: first, method: m1, ts: t1 });
      payList.push({ o, cents: total - first, method: m2, ts: Math.min(t1 + rng.int(60, 7200), endTs) });
    } else {
      payList.push({ o, cents: o.totalCents, method, ts: when(method, base) });
    }
  }
  payList.sort((a, b) => a.ts - b.ts || a.o.id - b.o.id);
  const paymentRows = payList.map((p, i) => [i + 1, p.o.id, p.cents / 100, p.method, tstr(p.ts)]);

  // ---- reviews ------------------------------------------------------------------------------------------------
  const quality = new Map(prodInfo.map((p) => [p.id, rng.normal(0, 0.5)]));
  const pairs = new Map(); // "cust|prod" -> earliest delivered order
  for (const o of orders) {
    if (o.status !== 'delivered') continue;
    for (const l of o.lines) {
      const key = `${o.cust.id}|${l.p.id}`;
      if (!pairs.has(key) || pairs.get(key).date > o.date) pairs.set(key, { o, p: l.p });
    }
  }
  const cand = [...pairs.values()].filter((x) => daysBetween(addDays(x.o.shipped, 3), END) >= 0);
  const chosen = rng.weightedSample(cand, cand.map((x) => Math.sqrt(x.p.pop) * rng.float(0.5, 1.5)), 320);
  const revs = chosen.map((x) => {
    const room = Math.min(45, daysBetween(x.o.shipped, END));
    const created = addDays(x.o.shipped, rng.int(3, room));
    const rating = clamp(Math.round(4.3 + quality.get(x.p.id) + rng.normal(0, 1.0)), 1, 5);
    const text = rng.chance(0.3) ? null : rng.pick(REVIEW_TEXT[rating]);
    return { prod: x.p.id, cust: x.o.cust.id, rating, text, created };
  });
  revs.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.cust - b.cust || a.prod - b.prod));
  const reviewRows = revs.map((r, i) => [i + 1, r.prod, r.cust, r.rating, r.text, r.created]);

  const tables = [
    T('categories', 'Product categories arranged as a tree: top-level departments with sub-categories below them.', [
      ['category_id', 'integer', 'PRIMARY KEY', 'Unique id of the category'],
      ['name', 'text', 'NOT NULL UNIQUE', 'Category name'],
      ['parent_id', 'integer', 'REFERENCES categories (category_id)', 'The category this one sits under (empty for top-level departments)'],
    ], catRows),
    T('suppliers', 'Companies that supply the products we sell.', [
      ['supplier_id', 'integer', 'PRIMARY KEY', 'Unique id of the supplier'],
      ['name', 'text', 'NOT NULL', 'Company name'],
      ['country', 'text', 'NOT NULL', 'Country where the supplier is based'],
      ['contact_email', 'text', '', 'Contact email (empty if we do not have one)'],
    ], supRows),
    T('products', 'The product catalog: one row per item we sell, with price, cost and stock.', [
      ['product_id', 'integer', 'PRIMARY KEY', 'Unique id of the product'],
      ['name', 'text', 'NOT NULL', 'Product name'],
      ['category_id', 'integer', 'NOT NULL REFERENCES categories (category_id)', 'Category the product belongs to'],
      ['supplier_id', 'integer', 'REFERENCES suppliers (supplier_id)', 'Who supplies the product (empty when sourced directly)'],
      ['price', 'numeric(10,2)', 'NOT NULL', 'Current selling price in dollars'],
      ['cost', 'numeric(10,2)', 'NOT NULL', 'What the product costs us, in dollars'],
      ['stock_qty', 'integer', 'NOT NULL', 'Units currently in the warehouse'],
      ['is_active', 'boolean', 'NOT NULL', 'TRUE if the product is still for sale'],
      ['created_at', 'date', 'NOT NULL', 'Date the product was added to the catalog'],
    ], productRows),
    T('customers', 'People who have created an account on the shop.', [
      ['customer_id', 'integer', 'PRIMARY KEY', 'Unique id of the customer'],
      ['first_name', 'text', 'NOT NULL', 'Given name'],
      ['last_name', 'text', 'NOT NULL', 'Family name'],
      ['email', 'text', 'NOT NULL UNIQUE', 'Email address (unique per customer)'],
      ['phone', 'text', '', 'Phone number (empty if not provided)'],
      ['city', 'text', 'NOT NULL', 'City where the customer lives'],
      ['state', 'text', 'NOT NULL', 'Two-letter US state code'],
      ['signup_date', 'date', 'NOT NULL', 'Date the account was created'],
      ['birth_date', 'date', '', 'Date of birth (empty if not provided)'],
      ['segment', 'text', 'NOT NULL', 'Customer type: Consumer, Corporate or Home Office'],
    ], customerRows),
    T('orders', 'One row per order placed in the shop.', [
      ['order_id', 'integer', 'PRIMARY KEY', 'Unique id of the order'],
      ['customer_id', 'integer', 'NOT NULL REFERENCES customers (customer_id)', 'Customer who placed the order'],
      ['order_date', 'date', 'NOT NULL', 'Day the order was placed'],
      ['status', 'text', 'NOT NULL', 'Order status: processing, shipped, delivered, cancelled or returned'],
      ['shipped_date', 'date', '', 'Day the order left the warehouse (empty if it has not shipped, or was cancelled)'],
      ['ship_city', 'text', 'NOT NULL', 'City the order is shipped to'],
      ['discount_code', 'text', '', 'Promo code used at checkout (empty when no code was used)'],
    ], orderRows),
    T('order_items', 'The products inside each order (one row per product per order).', [
      ['order_item_id', 'integer', 'PRIMARY KEY', 'Unique id of the order line'],
      ['order_id', 'integer', 'NOT NULL REFERENCES orders (order_id)', 'Order this line belongs to'],
      ['product_id', 'integer', 'NOT NULL REFERENCES products (product_id)', 'Product that was bought'],
      ['quantity', 'integer', 'NOT NULL', 'How many units were bought'],
      ['unit_price', 'numeric(10,2)', 'NOT NULL', 'Price per unit at the time of the order, in dollars'],
      ['discount', 'numeric(3,2)', 'NOT NULL DEFAULT 0', 'Discount on this line as a fraction (0.10 = 10% off)'],
    ], itemRows, { constraints: ['UNIQUE (order_id, product_id)'] }),
    T('payments', 'Payments received for orders (an order can be paid in more than one payment).', [
      ['payment_id', 'integer', 'PRIMARY KEY', 'Unique id of the payment'],
      ['order_id', 'integer', 'NOT NULL REFERENCES orders (order_id)', 'Order the payment is for'],
      ['amount', 'numeric(10,2)', 'NOT NULL', 'Amount paid in dollars'],
      ['method', 'text', 'NOT NULL', 'Payment method: card, paypal, gift_card or bank_transfer'],
      ['paid_at', 'timestamp', 'NOT NULL', 'Date and time the payment was received'],
    ], paymentRows),
    T('reviews', 'Star ratings and comments written by customers about products they bought.', [
      ['review_id', 'integer', 'PRIMARY KEY', 'Unique id of the review'],
      ['product_id', 'integer', 'NOT NULL REFERENCES products (product_id)', 'Product being reviewed'],
      ['customer_id', 'integer', 'NOT NULL REFERENCES customers (customer_id)', 'Customer who wrote the review'],
      ['rating', 'integer', 'NOT NULL CHECK (rating BETWEEN 1 AND 5)', 'Star rating from 1 (bad) to 5 (great)'],
      ['review_text', 'text', '', 'Written comment (empty when the customer only left stars)'],
      ['created_at', 'date', 'NOT NULL', 'Day the review was written'],
    ], reviewRows),
  ];

  return {
    id: 'shop',
    name: 'ShopSmart',
    icon: '🛒',
    tagline: 'An online store with customers, orders, payments and reviews.',
    description:
      'ShopSmart is a small online store with two years of orders, 60 products, 150 customers and their payments and reviews. ' +
      'It is the main playground for joins, GROUP BY, subqueries and CTEs, with realistic quirks like customers who never ordered and orders that are not paid yet. ' +
      'Dates run from January 2023 to December 2024, with busy Black Friday seasons.',
    tables,
    extra: { NEVER_ORDERED_PRODUCTS: [...NEVER_ORDERED_PRODUCTS], INACTIVE, PRICE_CHANGE, unpaidOrders: [...unpaid], splitOrders: [...splitIds] },
  };
}

// ---- documentation: shop ------------------------------------------------------------------
async function docShop(q, ds) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const one = async (sql) => (await q.rows(sql))[0];
  const ex = ds.extra;

  const neverCust = await one("SELECT count(*) AS n, min(customer_id) AS lo, max(customer_id) AS hi, min(signup_date)::text AS s1, max(signup_date)::text AS s2 FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)");
  const neverProd = await list("SELECT product_id || ' ' || name AS v FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = p.product_id) ORDER BY product_id");
  const nullSup = await list('SELECT product_id || \' \' || name AS v FROM products WHERE supplier_id IS NULL ORDER BY product_id');
  const inactive = await list('SELECT product_id || \' \' || name AS v FROM products WHERE NOT is_active ORDER BY product_id');
  const zeroStock = await list('SELECT product_id::text AS v FROM products WHERE stock_qty = 0 ORDER BY product_id');
  const nullSupEmail = await list('SELECT name AS v FROM suppliers WHERE contact_email IS NULL ORDER BY supplier_id');
  const orderDates = await one('SELECT min(order_date)::text AS lo, max(order_date)::text AS hi, count(*) AS n FROM orders');
  const years = await list("SELECT extract(year FROM order_date)::int || ': ' || count(*) AS v FROM orders GROUP BY extract(year FROM order_date) ORDER BY 1");
  const months = await list("SELECT to_char(order_date, 'Mon') || ' ' || count(*) AS v FROM orders WHERE order_date >= '2024-01-01' GROUP BY date_trunc('month', order_date), to_char(order_date, 'Mon') ORDER BY date_trunc('month', order_date)");
  const bf = await list("SELECT order_date::text || ' (' || count(*) || ' orders)' AS v FROM orders WHERE order_date IN ('2023-11-24', '2024-11-29') GROUP BY order_date ORDER BY order_date");
  const statusShare = await list('SELECT status || \' \' || count(*) || \' (\' || round(100.0 * count(*) / (SELECT count(*) FROM orders), 1) || \'%)\' AS v FROM orders GROUP BY status ORDER BY count(*) DESC');
  const proc = await one("SELECT count(*) AS n, min(order_date)::text AS lo FROM orders WHERE status = 'processing'");
  const shipped = await one("SELECT count(*) AS n, count(*) FILTER (WHERE order_date < '2024-12-01') AS old FROM orders WHERE status = 'shipped'");
  const noShipDate = await one("SELECT count(*) FILTER (WHERE shipped_date IS NULL) AS nulls, count(*) FILTER (WHERE shipped_date IS NULL AND status IN ('processing', 'cancelled')) AS expected FROM orders");
  const codes = await list('SELECT discount_code || \' \' || count(*) AS v FROM orders WHERE discount_code IS NOT NULL GROUP BY discount_code ORDER BY count(*) DESC, discount_code');
  const codeShare = await one('SELECT count(*) FILTER (WHERE discount_code IS NOT NULL) AS n, round(100.0 * count(*) FILTER (WHERE discount_code IS NOT NULL) / count(*), 1)::text AS pct FROM orders');
  const noCodeDisc = await one('SELECT count(*) AS lines, count(*) FILTER (WHERE discount > 0) AS disc FROM order_items i JOIN orders o USING (order_id) WHERE o.discount_code IS NULL');
  const priceDiff = await one('SELECT count(*) AS lines, count(DISTINCT i.product_id) AS prods FROM order_items i JOIN products p USING (product_id) WHERE i.unit_price <> p.price');
  const priceChangeText = Object.entries(ex.PRICE_CHANGE).map(([id, [d, old]]) => `product ${id} cost ${old.toFixed(2)} before ${d}`).join('; ');
  const codeRates = await q.val("SELECT count(*) FROM orders o JOIN order_items i USING (order_id) WHERE o.discount_code IS NOT NULL AND i.discount <> CASE o.discount_code WHEN 'WELCOME10' THEN 0.10 WHEN 'SUMMER15' THEN 0.15 WHEN 'BLACKFRIDAY' THEN 0.20 WHEN 'LOYALTY5' THEN 0.05 ELSE 0 END");
  must(codeRates === 0, 'discount codes fix the line discount');
  must(noShipDate.nulls === noShipDate.expected, 'shipped_date is NULL only for processing/cancelled');
  const bfAvg = await list("SELECT y || ': ' || bf || ' orders on Black Friday vs ' || round(nov / 30.0, 1) || ' on an average November day' AS v FROM (SELECT extract(year FROM order_date)::int AS y, count(*) FILTER (WHERE order_date IN ('2023-11-24', '2024-11-29')) AS bf, count(*) FILTER (WHERE extract(month FROM order_date) = 11) AS nov FROM orders GROUP BY 1) t ORDER BY y");
  const pay = await one(`WITH t AS (SELECT order_id, round(sum(quantity * unit_price * (1 - discount)), 2) AS total FROM order_items GROUP BY order_id),
    p AS (SELECT order_id, sum(amount) AS paid, count(*) AS n FROM payments GROUP BY order_id)
    SELECT count(*) FILTER (WHERE p.order_id IS NULL AND o.status <> 'cancelled') AS unpaid,
           count(*) FILTER (WHERE p.n = 2) AS split,
           count(*) FILTER (WHERE p.order_id IS NOT NULL AND p.paid <> t.total) AS mismatch,
           count(*) FILTER (WHERE p.order_id IS NOT NULL AND o.status = 'cancelled') AS paid_cancelled,
           count(*) FILTER (WHERE p.order_id IS NULL AND o.status = 'cancelled') AS cancelled_unpaid
    FROM orders o JOIN t USING (order_id) LEFT JOIN p USING (order_id)`);
  const unpaidStatus = await list("WITH p AS (SELECT DISTINCT order_id FROM payments) SELECT o.status || ' ' || count(*) AS v FROM orders o WHERE o.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM p WHERE p.order_id = o.order_id) GROUP BY o.status ORDER BY count(*) DESC, o.status");
  const rev = await one('SELECT count(*) AS n, count(review_text) AS txt, round(avg(rating), 2)::text AS av, min(created_at)::text AS lo, max(created_at)::text AS hi FROM reviews');
  const ratingDist = await list('SELECT rating || \' stars: \' || count(*) AS v FROM reviews GROUP BY rating ORDER BY rating DESC');
  const badReviews = await q.val("SELECT count(*) FROM reviews r WHERE NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o USING (order_id) WHERE o.customer_id = r.customer_id AND i.product_id = r.product_id AND o.status = 'delivered' AND o.order_date < r.created_at)");
  const skew = await one("WITH c AS (SELECT customer_id, count(*) AS n FROM orders GROUP BY 1) SELECT max(n) AS mx, percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::text AS med, count(*) FILTER (WHERE n = 1) AS once, count(*) AS buyers FROM c");
  const signupOrder = await q.val('SELECT count(*) FROM customers a JOIN customers b ON b.customer_id = a.customer_id + 1 WHERE b.signup_date < a.signup_date');
  const states = await one('SELECT count(DISTINCT state) AS states, count(DISTINCT city) AS cities FROM customers');
  const segs = await list('SELECT segment || \' \' || count(*) AS v FROM customers GROUP BY segment ORDER BY count(*) DESC');
  const giftShip = await q.val('SELECT count(*) FROM orders o JOIN customers c USING (customer_id) WHERE o.ship_city <> c.city');
  const tree = await list('WITH RECURSIVE t AS (SELECT category_id, name, 1 AS depth FROM categories WHERE parent_id IS NULL UNION ALL SELECT c.category_id, c.name, t.depth + 1 FROM categories c JOIN t ON c.parent_id = t.category_id) SELECT \'level \' || depth || \': \' || count(*) AS v FROM t GROUP BY depth ORDER BY depth');
  const emptyCats = await list('SELECT name AS v FROM categories c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.category_id) ORDER BY category_id');

  return {
    about:
      'ShopSmart is the workhorse dataset: eight related tables that are small enough to query instantly but rich enough for joins, aggregation, subqueries, CTEs, window functions and date analysis. ' +
      'The "as of" date is **2024-12-31**: the newest orders are still being processed or shipped, and nothing is dated later.',
    conventions: [
      `**Dates.** Customers signed up between 2022-06-01 and 2024-10-31 (customer ids are in signup order: ${signupOrder} out-of-order pairs). Orders run **${orderDates.lo} to ${orderDates.hi}** (${commas(orderDates.n)} orders); every order is placed after its customer's signup date. Orders per year: ${years}. 2024 orders per month: ${months}.`,
      `**Seasonality and growth.** Order volume is lowest in January and February, grows through the year and peaks in November and December, with spikes on Black Friday (${bfAvg}). 2024 has clearly more orders than 2023 because the customer base grew.`,
      `**Order status** share: ${statusShare}. \`processing\` orders are the newest ones (${proc.n} orders, oldest from ${proc.lo}). ${shipped.n} orders are \`shipped\`; ${shipped.old} of them were placed before 2024-12-01 and are "stuck" in shipped (lost parcels) - a deliberate oddity you can query. \`shipped_date\` is on or after \`order_date\` (0 to 5 days later) and is NULL exactly for \`processing\` and \`cancelled\` orders (${noShipDate.nulls} NULLs).`,
      `**Order total.** There is no total column. The total of an order is \`ROUND(SUM(quantity * unit_price * (1 - discount)), 2)\` over its \`order_items\`, and the \`payments\` of that order add up to exactly this amount (${pay.mismatch} orders differ).`,
      `**Discount codes** appear on ${codeShare.n} orders (${codeShare.pct}%): ${codes}. A code fixes the line discount of the whole order: WELCOME10 = 0.10 (first orders), SUMMER15 = 0.15 (mid-June to August), BLACKFRIDAY = 0.20 (Black Friday window), LOYALTY5 = 0.05 (repeat customers), FREESHIP = 0 (free shipping only). Orders *without* a code have discount 0 on most lines; ${noCodeDisc.disc} of their ${commas(noCodeDisc.lines)} lines carry a 0.05 or 0.10 clearance discount.`,
      `**Prices over time.** \`order_items.unit_price\` is the price at the time of the order. 8 products changed price (${priceChangeText}); ${priceDiff.prods} of them have order lines at the old price, ${priceDiff.lines} lines in total, and all other lines equal today's \`products.price\`. Always use \`order_items.unit_price\` for revenue, never \`products.price\`.`,
      `**Order size.** 1 to 5 distinct products per order; the same product never appears twice in one order (UNIQUE on order_id + product_id). Quantities are mostly 1; cheap products (under $20) are often bought in 2 to 5 units, expensive ones (over $500) always 1.`,
      `**Customer behaviour is skewed.** ${skew.buyers} customers have orders: the most active has ${skew.mx} orders, the median is ${skew.med}, and ${skew.once} customers ordered exactly once. Customers live in ${states.cities} cities in ${states.states} states; segments: ${segs}. For ${commas(giftShip)} orders \`ship_city\` differs from the customer's own city (gifts).`,
      `**Reviews** (${rev.n} rows, ${rev.lo} to ${rev.hi}) are written only by customers who received a *delivered* order containing the product, and always after that order (${badReviews} violations). Ratings are skewed to 4 and 5 stars: ${ratingDist} (average ${rev.av}). ${rev.n - rev.txt} reviews have no text.`,
      `**Category tree.** ${tree}. Products only point to leaf or mid-level categories; categories without any product: ${emptyCats}.`,
    ],
    quirks: [
      `**Customers ${neverCust.lo} to ${neverCust.hi} never ordered** (${neverCust.n} customers, all signed up between ${neverCust.s1} and ${neverCust.s2}): the classic \`LEFT JOIN ... WHERE o.order_id IS NULL\` / \`NOT EXISTS\` exercise.`,
      `**Products never ordered:** ${neverProd}.`,
      `**Products with NULL supplier_id:** ${nullSup}.`,
      `**Inactive products** (\`is_active = FALSE\`): ${inactive}. They have no orders after they were discontinued. **Products with stock_qty = 0:** ids ${zeroStock}.`,
      `**Suppliers without a contact email:** ${nullSupEmail}. **Customers without a phone:** ${await q.val('SELECT count(*) FROM customers WHERE phone IS NULL')}; **without a birth_date:** ${await q.val('SELECT count(*) FROM customers WHERE birth_date IS NULL')}.`,
      `**Unpaid orders:** ${pay.unpaid} non-cancelled orders have no payment row (${unpaidStatus}). Cancelled orders never have payments (${pay.paid_cancelled} do, ${pay.cancelled_unpaid} don't).`,
      `**Split payments:** ${pay.split} orders were paid in two payments (often a gift card plus card or PayPal). Returned orders were paid in full - there are no refund rows or negative payments.`,
      `**Order status vs. dates.** \`shipped_date\` is NULL for ${noShipDate.nulls} orders; \`discount_code\` is NULL for ${commas(await q.val('SELECT count(*) FROM orders WHERE discount_code IS NULL'))} orders.`,
    ],
    facts: [
      await f('Orders by status', 'SELECT status, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Revenue of delivered orders (all time)', "SELECT sum(i.quantity * i.unit_price * (1 - i.discount)) FROM order_items i JOIN orders o ON o.order_id = i.order_id WHERE o.status = 'delivered'", 'money'),
      await f('Revenue of delivered orders placed in 2024', "SELECT sum(i.quantity * i.unit_price * (1 - i.discount)) FROM order_items i JOIN orders o ON o.order_id = i.order_id WHERE o.status = 'delivered' AND o.order_date >= '2024-01-01'", 'money'),
      await f('Number of orders placed in 2024', "SELECT count(*) FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01'", 'int'),
      await f('Average delivered order value', "SELECT round(avg(t.total), 2) FROM (SELECT o.order_id, sum(i.quantity * i.unit_price * (1 - i.discount)) AS total FROM orders o JOIN order_items i ON i.order_id = o.order_id WHERE o.status = 'delivered' GROUP BY o.order_id) t", 'money'),
      await f('Month with the most orders', "SELECT to_char(order_date, 'YYYY-MM') || ' (' || count(*) || ' orders)' FROM orders GROUP BY to_char(order_date, 'YYYY-MM') ORDER BY count(*) DESC LIMIT 1"),
      await f('Best-selling product by units (delivered orders)', "SELECT p.name || ' (' || sum(i.quantity) || ' units)' FROM order_items i JOIN orders o ON o.order_id = i.order_id JOIN products p ON p.product_id = i.product_id WHERE o.status = 'delivered' GROUP BY p.product_id, p.name ORDER BY sum(i.quantity) DESC, p.name LIMIT 1"),
      await f('Top customer by delivered revenue', "SELECT c.first_name || ' ' || c.last_name || ' (customer ' || c.customer_id || ', ' || round(sum(i.quantity * i.unit_price * (1 - i.discount)), 2) || ')' FROM customers c JOIN orders o ON o.customer_id = c.customer_id JOIN order_items i ON i.order_id = o.order_id WHERE o.status = 'delivered' GROUP BY c.customer_id, c.first_name, c.last_name ORDER BY sum(i.quantity * i.unit_price * (1 - i.discount)) DESC LIMIT 1"),
      await f('Payments received by method (count and dollars)', "SELECT method, count(*) || ' / ' || round(sum(amount), 2) FROM payments GROUP BY 1 ORDER BY sum(amount) DESC", 'pairs'),
      await f('Average review rating', 'SELECT round(avg(rating), 2) FROM reviews'),
      await f('Products with at least 8 reviews, best average first', 'SELECT p.name, round(avg(r.rating), 2) || \' (\' || count(*) || \' reviews)\' AS rating FROM reviews r JOIN products p ON p.product_id = r.product_id GROUP BY p.product_id, p.name HAVING count(*) >= 8 ORDER BY avg(r.rating) DESC, p.name LIMIT 3', 'pairs'),
      await f('Orders using a discount code', 'SELECT count(*) FROM orders WHERE discount_code IS NOT NULL', 'int'),
    ],
    topics: [
      'INNER / LEFT JOIN across `customers`, `orders`, `order_items`, `products`, `categories`; anti-joins for customers 141-150 and the never-ordered products.',
      'GROUP BY / HAVING for revenue per category, month, segment or state; conditional aggregation with `FILTER` and `CASE`.',
      'Subqueries and CTEs: order totals, customers above the average, products never ordered, top-N per group.',
      'Self-referencing `categories` (3 levels) with recursive CTEs.',
      'Window functions: running revenue per month, rank customers by spend, previous order date per customer (`LAG`).',
      'Date analysis: seasonality, 2023 vs 2024, days between order and shipment.',
      'Data-quality reasoning: unpaid orders, split payments, price changes, stuck shipments.',
    ],
  };
}

// =============================================================================
// 3. company - Acme Corp HR
// =============================================================================

function buildCompany() {
  const rng = new Rng(3003);

  const deptRows = [
    [1, 'Executive', 'Chicago', 2500000.0],
    [2, 'Engineering', 'Austin', 9800000.0],
    [3, 'Sales', 'New York', 6200000.0],
    [4, 'Marketing', 'Los Angeles', 3400000.0],
    [5, 'Finance', 'Chicago', 1900000.0],
    [6, 'HR', 'Chicago', 1200000.0],
    [7, 'Research', 'Boston', 2800000.0],
  ];

  // id, title, dept, manager, type, city, hire, salary, terminated
  const E = [
    [1, 'Chief Executive Officer', 1, null, 'full_time', 'Chicago', '2012-03-05', 320000],
    [2, 'Chief of Staff', 1, 1, 'full_time', 'Chicago', '2016-09-12', 175000],
    [3, 'VP of Engineering', 2, 1, 'full_time', 'Austin', '2012-05-14', 265000],
    [4, 'VP of Sales', 3, 1, 'full_time', 'New York', '2012-08-20', 245000],
    [5, 'VP of Marketing', 4, 1, 'full_time', 'Los Angeles', '2013-02-11', 225000],
    [6, 'VP of Finance', 5, 1, 'full_time', 'Chicago', '2012-04-23', 240000],
    [7, 'VP of People', 6, 1, 'full_time', 'Chicago', '2014-01-06', 215000],
    [8, 'Director of Platform Engineering', 2, 3, 'full_time', 'Austin', '2013-06-17', 198000],
    [9, 'Director of Product Engineering', 2, 3, 'full_time', 'Austin', '2014-03-10', 198000],
    [10, 'Engineering Manager, Data', 2, 3, 'full_time', 'Austin', '2017-05-22', 168000],
    [11, 'Director of Sales, Americas', 3, 4, 'full_time', 'New York', '2013-01-14', 185000],
    [12, 'Director of Sales, EMEA', 3, 4, 'full_time', 'New York', '2016-04-04', 185000],
    [13, 'Marketing Director', 4, 5, 'full_time', 'Los Angeles', '2014-09-15', 150000],
    [14, 'Brand Manager', 4, 5, 'full_time', 'Los Angeles', '2018-07-09', 118000],
    [15, 'Controller', 5, 6, 'full_time', 'Chicago', '2013-10-28', 142000],
    [16, 'HR Manager', 6, 7, 'full_time', 'Chicago', '2015-02-02', 108000],
    [17, 'Backend Team Lead', 2, 8, 'full_time', 'Austin', '2015-07-13', 150000],
    [18, 'Infrastructure Team Lead', 2, 8, 'full_time', 'Austin', '2016-02-01', 152000],
    [19, 'Frontend Team Lead', 2, 9, 'full_time', 'Austin', '2017-09-18', 145000],
    [20, 'Mobile Team Lead', 2, 9, 'full_time', 'Seattle', '2018-04-02', 148000],
    [21, 'Data Team Lead', 2, 10, 'full_time', 'Austin', '2019-01-14', 140000],
    [22, 'Sales Team Lead, West', 3, 11, 'full_time', 'Los Angeles', '2017-06-05', 118000],
    [23, 'Sales Team Lead, East', 3, 11, 'full_time', 'New York', '2016-03-21', 118000],
    [24, 'Sales Team Lead, EMEA', 3, 12, 'full_time', 'New York', '2019-10-07', 112000],
    [25, 'Content Marketing Lead', 4, 13, 'full_time', 'Los Angeles', '2018-11-05', 105000],
    [26, 'Growth Marketing Lead', 4, 13, 'full_time', 'Los Angeles', '2020-03-02', 102000],
    [27, 'Senior Accountant', 5, 15, 'full_time', 'Chicago', '2016-08-15', 96000],
    [28, 'Recruiting Lead', 6, 16, 'full_time', 'Chicago', '2019-06-03', 92000],
    [29, 'Backend Engineer', 2, 17, 'full_time', 'Austin', '2019-08-12', 128000],
    [30, 'Backend Engineer', 2, 17, 'full_time', 'Austin', '2021-02-01', 128000],
    [31, 'DevOps Engineer', 2, 18, 'full_time', 'Austin', '2019-11-04', 122000],
    [32, 'Site Reliability Engineer', 2, 18, 'full_time', 'Austin', '2020-05-18', 135000],
    [33, 'Frontend Engineer', 2, 19, 'full_time', 'Austin', '2018-10-01', 118000],
    [34, 'Frontend Engineer', 2, 19, 'full_time', 'Denver', '2022-07-11', 118000],
    [35, 'iOS Engineer', 2, 20, 'full_time', 'Seattle', '2020-01-13', 125000],
    [36, 'Android Engineer', 2, 20, 'full_time', 'Seattle', '2021-03-15', 122000],
    [37, 'Data Engineer', 2, 21, 'full_time', 'Austin', '2021-09-27', 124000],
    [38, 'Data Analyst', 2, 21, 'part_time', 'Austin', '2022-09-12', 54000],
    [39, 'QA Engineer', 2, 19, 'contractor', 'Austin', '2021-06-07', 95000],
    [40, 'Account Executive', 3, 22, 'full_time', 'Los Angeles', '2018-09-10', 88000],
    [41, 'Account Executive', 3, 22, 'full_time', 'Los Angeles', '2020-02-17', 88000],
    [42, 'Account Executive', 3, 23, 'full_time', 'New York', '2019-05-06', 88000],
    [43, 'Account Executive', 3, 23, 'full_time', 'Boston', '2021-10-04', 92000],
    [44, 'Account Executive', 3, 24, 'full_time', 'New York', '2022-03-14', 85000],
    [45, 'Sales Development Rep', 3, 24, 'full_time', 'New York', '2024-03-04', 62000],
    [46, 'Content Writer', 4, 25, 'full_time', 'Los Angeles', '2019-04-15', 72000],
    [47, 'SEO Specialist', 4, 26, 'part_time', 'Denver', '2023-01-09', 48000],
    [48, 'Graphic Designer', 4, 25, 'full_time', 'Los Angeles', '2020-08-24', 76000],
    [49, 'Accountant', 5, 27, 'full_time', 'Chicago', '2021-01-11', 78000],
    [50, 'Financial Analyst', 5, 27, 'full_time', 'Chicago', '2022-06-06', 84000],
    [51, 'Recruiter', 6, 28, 'full_time', 'Chicago', '2022-02-07', 70000],
    [52, 'HR Generalist', 6, 28, 'part_time', 'Chicago', '2023-09-18', 46000],
    [53, 'Technical Writer', null, 19, 'contractor', 'Austin', '2023-04-03', 82000],
    [54, 'Business Consultant', null, 22, 'contractor', 'Los Angeles', '2024-02-12', 135000],
    [55, 'Marketing Coordinator', 4, 26, 'part_time', 'Los Angeles', '2024-06-17', 45000],
  ];
  const TERMINATED = { 31: '2024-03-29', 36: '2023-08-31', 41: '2024-06-14', 46: '2022-12-16', 51: '2024-09-27' };
  const names = makeNames(rng, E.length);
  const emp = E.map((e, i) => ({
    id: e[0],
    first: names[i].first,
    last: names[i].last,
    title: e[1],
    dept: e[2],
    mgr: e[3],
    type: e[4],
    city: e[5],
    hire: e[6],
    salary: e[7],
    term: TERMINATED[e[0]] || null,
  }));
  const empRows = emp.map((e) => [
    e.id, e.first, e.last, emailOf(e.first, e.last), e.dept, e.mgr, e.title, e.hire, e.salary, e.type, e.city, e.term,
  ]);

  // ---- salary_history --------------------------------------------------------------
  const PAY_CUTS = { 23: '2020-04-01', 40: '2020-04-01' }; // temporary pandemic pay cut
  const round500 = (x) => Math.round(x / 500) * 500;
  const histRows = [];
  for (const e of emp) {
    const end = e.term || '2024-12-31';
    let rows; // [date, salary]
    if (PAY_CUTS[e.id]) {
      const S = e.salary;
      rows = [
        [e.hire, round500(S * 0.8)],
        ['2019-04-01', round500(S * 0.92)],
        [PAY_CUTS[e.id], round500(S * 0.85)],
        ['2022-04-01', round500(S * 0.94)],
        ['2024-04-01', S],
      ];
    } else {
      const years = daysBetween(e.hire, end) / 365;
      const maxRows = clamp(1 + Math.floor(years / 1.7), 1, 5);
      const n = clamp(rng.int(Math.max(1, maxRows - 1), maxRows), 1, 5);
      // effective dates: hire date, then raises roughly every 12-30 months
      const dates = [e.hire];
      for (let j = 1; j < n; j++) {
        const prev = dates[j - 1];
        const next = addDays(prev, rng.int(330, 900));
        if (next > end) break;
        dates.push(next);
      }
      const m = dates.length;
      const sal = new Array(m);
      sal[m - 1] = e.salary;
      for (let j = m - 2; j >= 0; j--) {
        const raise = j === 0 && m > 2 && rng.chance(0.3) ? rng.float(0.12, 0.2) : rng.float(0.03, 0.1);
        let s = round500(sal[j + 1] / (1 + raise));
        if (s >= sal[j + 1]) s = sal[j + 1] - 500;
        sal[j] = s;
      }
      rows = dates.map((d, j) => [d, sal[j]]);
    }
    for (const [d, s] of rows) histRows.push([e.id, d, s]);
  }

  // ---- projects --------------------------------------------------------------------------
  const projRows = [
    [1, 'Atlas Platform Rewrite', 2, '2022-02-01', '2023-09-30', 1850000, 'completed'],
    [2, 'Mobile App 3.0', 2, '2023-03-01', null, 1200000, 'active'],
    [3, 'Customer Data Lake', 2, '2025-02-03', null, 900000, 'planned'],
    [4, 'Security Hardening', 2, '2024-01-15', null, 650000, 'active'],
    [5, 'Search Relevance Upgrade', 7, '2023-06-01', '2024-02-29', 480000, 'completed'],
    [6, 'Churn Prediction Pilot', 7, '2024-04-01', null, 350000, 'on_hold'],
    [7, 'Brand Refresh', 4, '2022-10-03', '2023-06-30', 520000, 'completed'],
    [8, 'Referral Program Launch', 4, '2024-07-01', null, 280000, 'active'],
    [9, 'Q4 Sales Kickoff', 3, '2024-08-15', '2024-11-15', 175000, 'completed'],
    [10, 'Partner Portal', 3, '2024-02-12', null, 760000, 'active'],
    [11, 'Payroll Migration', 5, '2023-01-09', '2023-12-15', 420000, 'completed'],
    [12, 'Annual Budget Planning 2025', 5, '2024-09-02', null, 120000, 'active'],
    [13, 'Hiring Pipeline Revamp', 6, '2024-05-06', null, 210000, 'on_hold'],
    [14, 'Employee Onboarding Portal', 6, '2025-01-20', null, 330000, 'planned'],
  ].map((p) => [p[0], p[1], p[2], p[3], p[4], p[5], p[6]]);
  const projById = new Map(projRows.map((p) => [p[0], p]));
  const TEAMS = {
    1: [8, 17, 18, 29, 30, 31, 32, 33, 34, 39, 10, 9],
    2: [20, 35, 36, 19, 33, 34, 39, 9, 29, 53, 48],
    4: [18, 31, 32, 17, 29, 30, 10, 37],
    5: [21, 37, 38, 29, 30, 50, 31],
    6: [10, 21, 37, 38, 50],
    7: [13, 14, 25, 26, 46, 47, 48, 33],
    8: [26, 47, 25, 48, 14, 50, 34, 43],
    9: [11, 12, 22, 23, 24, 40, 42, 43],
    10: [11, 22, 40, 44, 19, 33, 29, 53, 54, 42],
    11: [15, 27, 49, 50, 28, 16, 30],
    12: [15, 27, 49, 50, 13],
    13: [28, 16, 51, 52],
    14: [16, 52, 34],
  };
  const empById = new Map(emp.map((e) => [e.id, e]));
  const roleFor = (e) => {
    const t = e.title;
    if (e.type === 'contractor' && t !== 'QA Engineer') return 'consultant';
    if (/QA/.test(t)) return 'tester';
    if (/Designer|Writer/.test(t)) return 'designer';
    if (/Engineer|Reliability/.test(t)) return rng.chance(0.12) ? 'tester' : 'developer';
    if (/Analyst|Accountant|Controller|Data|SEO|Recruit|Generalist|Coordinator/.test(t)) return 'analyst';
    return rng.chance(0.5) ? 'consultant' : 'analyst';
  };
  const assignRows = [];
  for (const [pidStr, team] of Object.entries(TEAMS)) {
    const pid = +pidStr;
    const p = projById.get(pid);
    const [, , , start, end] = p;
    team.forEach((eid, idx) => {
      const e = empById.get(eid);
      const isLead = idx === 0;
      let assigned;
      if (p[6] === 'planned') assigned = addDays('2024-12-02', rng.int(0, 18));
      else assigned = addDays(start > e.hire ? start : e.hire, isLead ? rng.int(0, 5) : rng.int(0, 45));
      const limit = [end, e.term, '2024-12-31'].filter(Boolean).sort()[0];
      if (assigned > limit) return; // not feasible for this person
      if (assigned < e.hire) assigned = e.hire;
      const hours = isLead
        ? rng.int(8, 20)
        : e.type === 'part_time'
          ? rng.pick([2, 4, 6, 8])
          : rng.pick([4, 6, 8, 10, 12, 16, 20, 24, 30]);
      assignRows.push([eid, pid, isLead ? 'lead' : roleFor(e), hours, assigned]);
    });
  }
  assignRows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const tables = [
    T('departments', 'The departments of Acme Corp, with where they are based and their yearly budget.', [
      ['dept_id', 'integer', 'PRIMARY KEY', 'Unique id of the department'],
      ['name', 'text', 'NOT NULL UNIQUE', 'Department name'],
      ['location', 'text', 'NOT NULL', 'City where the department is headquartered'],
      ['budget', 'numeric(12,2)', 'NOT NULL', 'Yearly budget in dollars'],
    ], deptRows),
    T('employees', 'Everyone who works (or used to work) at Acme Corp, including who their manager is.', [
      ['emp_id', 'integer', 'PRIMARY KEY', 'Unique id of the employee'],
      ['first_name', 'text', 'NOT NULL', 'Given name'],
      ['last_name', 'text', 'NOT NULL', 'Family name'],
      ['email', 'text', 'NOT NULL UNIQUE', 'Work email address'],
      ['dept_id', 'integer', 'REFERENCES departments (dept_id)', 'Department the employee belongs to (empty if not assigned to one yet)'],
      ['manager_id', 'integer', 'REFERENCES employees (emp_id)', 'The employee this person reports to (empty for the CEO)'],
      ['job_title', 'text', 'NOT NULL', 'Job title'],
      ['hire_date', 'date', 'NOT NULL', 'First day at the company'],
      ['salary', 'numeric(10,2)', 'NOT NULL', 'Current yearly salary in dollars'],
      ['employment_type', 'text', 'NOT NULL', 'full_time, part_time or contractor'],
      ['city', 'text', 'NOT NULL', 'City where the employee works'],
      ['terminated_on', 'date', '', 'Last day at the company (empty for current employees)'],
    ], empRows),
    T('salary_history', 'Every salary change an employee has had, from the day they were hired.', [
      ['emp_id', 'integer', 'NOT NULL REFERENCES employees (emp_id)', 'Employee whose salary changed'],
      ['effective_date', 'date', 'NOT NULL', 'Day the new salary started'],
      ['salary', 'numeric(10,2)', 'NOT NULL', 'Yearly salary in dollars from that day on'],
    ], histRows, { constraints: ['PRIMARY KEY (emp_id, effective_date)'] }),
    T('projects', 'Company projects, each owned by one department.', [
      ['project_id', 'integer', 'PRIMARY KEY', 'Unique id of the project'],
      ['name', 'text', 'NOT NULL', 'Project name'],
      ['dept_id', 'integer', 'NOT NULL REFERENCES departments (dept_id)', 'Department that owns the project'],
      ['start_date', 'date', 'NOT NULL', 'Planned or actual start date'],
      ['end_date', 'date', '', 'Day the project finished (empty while it is still going or not started)'],
      ['budget', 'numeric(12,2)', 'NOT NULL', 'Project budget in dollars'],
      ['status', 'text', 'NOT NULL', 'planned, active, completed or on_hold'],
    ], projRows),
    T('project_assignments', 'Which employees work on which projects, in what role and for how many hours a week.', [
      ['emp_id', 'integer', 'NOT NULL REFERENCES employees (emp_id)', 'Employee assigned to the project'],
      ['project_id', 'integer', 'NOT NULL REFERENCES projects (project_id)', 'Project the employee works on'],
      ['role', 'text', 'NOT NULL', 'Role on the project: lead, developer, analyst, designer, tester or consultant'],
      ['hours_per_week', 'integer', 'NOT NULL', 'Weekly hours the employee spends on the project'],
      ['assigned_on', 'date', 'NOT NULL', 'Day the employee joined the project'],
    ], assignRows, { constraints: ['PRIMARY KEY (emp_id, project_id)'] }),
  ];

  return {
    id: 'company',
    name: 'Acme Corp',
    icon: '🏢',
    tagline: 'Departments, employees, managers, salaries and projects.',
    description:
      'Acme Corp is a mid-sized company with 55 employees spread across seven departments and a five-level management chain from the CEO down to individual contributors. ' +
      'Use it to learn self joins, recursive CTEs and window functions such as RANK() over salaries, and to practice finding departments without people. ' +
      'It also has a full salary history and a handful of projects with assignments.',
    tables,
    extra: { TERMINATED, PAY_CUTS },
  };
}

// ---- documentation: company -------------------------------------------------------------------
async function docCompany(q, ds) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const one = async (sql) => (await q.rows(sql))[0];

  const levels = await list('WITH RECURSIVE t AS (SELECT emp_id, 1 AS lvl FROM employees WHERE manager_id IS NULL UNION ALL SELECT e.emp_id, t.lvl + 1 FROM employees e JOIN t ON e.manager_id = t.emp_id) SELECT \'level \' || lvl || \': \' || count(*) AS v FROM t GROUP BY lvl ORDER BY lvl');
  const maxDepth = await q.val('WITH RECURSIVE t AS (SELECT emp_id, 1 AS lvl FROM employees WHERE manager_id IS NULL UNION ALL SELECT e.emp_id, t.lvl + 1 FROM employees e JOIN t ON e.manager_id = t.emp_id) SELECT max(lvl) FROM t');
  must(maxDepth === 5, 'hierarchy depth is 5');
  const chain = async (id) => q.val(`WITH RECURSIVE c AS (SELECT emp_id, manager_id, job_title, 1 AS d FROM employees WHERE emp_id = ${id} UNION ALL SELECT e.emp_id, e.manager_id, e.job_title, c.d + 1 FROM employees e JOIN c ON e.emp_id = c.manager_id) SELECT string_agg(job_title, ' → ' ORDER BY d) FROM c`);
  const chain1 = await chain(29);
  const chain2 = await chain(54);
  const headcount = await list('SELECT d.name || \' \' || count(e.emp_id) AS v FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY d.dept_id');
  const noDept = await list('SELECT emp_id || \' \' || first_name || \' \' || last_name || \' (\' || job_title || \', \' || employment_type || \')\' AS v FROM employees WHERE dept_id IS NULL ORDER BY emp_id');
  const noMgr = await list('SELECT emp_id || \' \' || job_title AS v FROM employees WHERE manager_id IS NULL');
  const types = await list('SELECT employment_type || \' \' || count(*) AS v FROM employees GROUP BY employment_type ORDER BY count(*) DESC');
  const term = await list('SELECT emp_id || \' \' || first_name || \' \' || last_name || \' (\' || terminated_on || \')\' AS v FROM employees WHERE terminated_on IS NOT NULL ORDER BY terminated_on');
  const termReports = await q.val('SELECT count(*) FROM employees m WHERE m.terminated_on IS NOT NULL AND EXISTS (SELECT 1 FROM employees e WHERE e.manager_id = m.emp_id)');
  must(termReports === 0, 'terminated employees have no direct reports');
  const ties = await list('SELECT \'dept \' || coalesce(dept_id::text, \'NULL\') || \' salary \' || salary || \' x\' || count(*) || \' (emp \' || string_agg(emp_id::text, \', \' ORDER BY emp_id) || \')\' AS v FROM employees GROUP BY dept_id, salary HAVING count(*) > 1 ORDER BY dept_id, salary');
  const sal = await one('SELECT min(salary)::text AS lo, max(salary)::text AS hi, round(avg(salary), 2)::text AS av FROM employees');
  const hist = await one('SELECT count(*) AS n, count(DISTINCT emp_id) AS emps, min(effective_date)::text AS lo, max(effective_date)::text AS hi FROM salary_history');
  const perEmp = await list('SELECT n || \' row\' || (CASE WHEN n = 1 THEN \'\' ELSE \'s\' END) || \': \' || count(*) AS v FROM (SELECT emp_id, count(*) AS n FROM salary_history GROUP BY emp_id) t GROUP BY n ORDER BY n');
  const lastMatches = await q.val('SELECT count(*) FROM employees e WHERE e.salary = (SELECT h.salary FROM salary_history h WHERE h.emp_id = e.emp_id ORDER BY h.effective_date DESC LIMIT 1)');
  const firstHire = await q.val('SELECT count(*) FROM employees e WHERE e.hire_date = (SELECT min(h.effective_date) FROM salary_history h WHERE h.emp_id = e.emp_id)');
  must(lastMatches === 55 && firstHire === 55, 'salary_history starts at hire date and ends at current salary');
  const cuts = await list('SELECT emp_id || \' on \' || effective_date || \' (\' || prev || \' to \' || salary || \')\' AS v FROM (SELECT *, lag(salary) OVER (PARTITION BY emp_id ORDER BY effective_date) AS prev FROM salary_history) t WHERE salary < prev ORDER BY emp_id');
  const hires = await one('SELECT min(hire_date)::text AS lo, max(hire_date)::text AS hi FROM employees');
  const projStatus = await list('SELECT status || \' \' || count(*) AS v FROM projects GROUP BY status ORDER BY count(*) DESC, status');
  const emptyProj = await list('SELECT p.project_id || \' \' || p.name || \' (\' || p.status || \')\' AS v FROM projects p WHERE NOT EXISTS (SELECT 1 FROM project_assignments a WHERE a.project_id = p.project_id)');
  const researchProj = await list('SELECT p.project_id || \' \' || p.name AS v FROM projects p JOIN departments d ON d.dept_id = p.dept_id WHERE d.name = \'Research\' ORDER BY p.project_id');
  const unassigned = await one('SELECT count(*) AS n, string_agg(emp_id::text, \', \' ORDER BY emp_id) AS ids FROM employees e WHERE NOT EXISTS (SELECT 1 FROM project_assignments a WHERE a.emp_id = e.emp_id)');
  const roles = await list('SELECT role || \' \' || count(*) AS v FROM project_assignments GROUP BY role ORDER BY count(*) DESC, role');
  const planned = await one("SELECT string_agg(project_id::text, ', ' ORDER BY project_id) AS ids FROM projects WHERE status = 'planned'");
  const assignBeforeStart = await q.val("SELECT count(*) FROM project_assignments a JOIN projects p USING (project_id) WHERE a.assigned_on < p.start_date");
  const nAssign = await q.val('SELECT count(*) FROM project_assignments');
  const hoursRange = await one('SELECT min(hours_per_week) AS lo, max(hours_per_week) AS hi, round(avg(hours_per_week), 1)::text AS av FROM project_assignments');

  must((await q.val('SELECT count(*) FROM employees e JOIN employees m ON m.emp_id = e.manager_id WHERE m.emp_id >= e.emp_id OR m.hire_date > e.hire_date')) === 0, 'managers have lower ids and earlier hire dates');
  must((await q.val("SELECT string_agg(job_title, ',' ORDER BY salary DESC, emp_id) FROM (SELECT * FROM employees ORDER BY salary DESC, emp_id LIMIT 6) t")).split(',').every((t) => t === 'Chief Executive Officer' || /^VP of /.test(t)), 'top 6 salaries are the CEO and five VPs');
  must((await q.val('SELECT count(*) FROM employees WHERE salary % 500 <> 0')) === 0, 'salaries are multiples of 500');
  must((await q.val("SELECT max(a.hours_per_week) FROM project_assignments a JOIN employees e USING (emp_id) WHERE e.employment_type = 'part_time'")) <= 8, 'part-timers work at most 8 hours per project');
  must((await q.val("SELECT count(*) FROM projects WHERE (status = 'completed') <> (end_date IS NOT NULL)")) === 0, 'only completed projects have an end_date');
  must(unassigned.ids === '1, 2, 3, 4, 5, 6, 7, 41, 45, 55', 'unassigned employee list');
  const budgets = await one('SELECT min(budget)::text AS lo, max(budget)::text AS hi FROM projects');
  return {
    about:
      'Acme Corp is a deliberately tidy organisation chart: one CEO at the top, a five-level management chain and enough salary data to make ranking and window-function questions interesting. ' +
      '"As of" date: **2024-12-31** (that is when "current" salaries and project statuses are measured).',
    conventions: [
      `**Hierarchy.** \`employees.manager_id\` forms a tree with the CEO (emp_id 1) as the only root. Employees per level: ${levels}; the **maximum depth is ${maxDepth}** (CEO = level 1). Level 2 are the five VPs and the Chief of Staff, level 3 directors and managers, level 4 team leads, level 5 individual contributors. A manager always has a lower \`emp_id\` than their reports, and nobody was hired before their manager. Example chains: ${code(chain1)}; ${code(chain2)}.`,
      `**Headcount per department:** ${headcount}.`,
      `**Employment types:** ${types}. Part-time and contractor \`salary\` values are annualised rates, so they are comparable with full-time salaries. Hire dates run from ${hires.lo} to ${hires.hi}.`,
      `**Salaries** run from ${money(sal.lo)} to ${money(sal.hi)} (average ${money(sal.av)}); the CEO earns the most, followed by the five VPs; below that, pay overlaps between levels (some team leads and contractors earn more than some directors). Salaries are multiples of 500.`,
      `**salary_history** has ${hist.n} rows for all ${hist.emps} employees (${perEmp}). The first row of every employee is dated on their \`hire_date\`, the last row always equals the current \`employees.salary\`, and later raises come roughly every year to two and a half years, typically 3% to 10% (occasionally up to 20% for a promotion; the two pay-cut employees follow a fixed pattern). Dates range from ${hist.lo} to ${hist.hi}. Terminated employees have no row after their last day.`,
      `**Projects** (${projStatus}): \`completed\` projects have an \`end_date\`; active, on-hold and planned projects have \`end_date\` NULL. Planned projects start in 2025 (project ids ${planned.ids}). Project budgets are between ${money(budgets.lo)} and ${money(budgets.hi)}. The owning department (\`projects.dept_id\`) is not necessarily where the team comes from: the Research department owns two projects but has no employees at all.`,
      `**project_assignments** (${nAssign} rows): roles ${roles}. Weekly hours run from ${hoursRange.lo} to ${hoursRange.hi} (average ${hoursRange.av}); part-timers get at most 8. \`assigned_on\` is on or after the project start and the employee's hire date and never after a project's end or the employee's last day (the only exception: ${assignBeforeStart} assignments to the planned project 14, which were made in December 2024 before its January 2025 start).`,
    ],
    quirks: [
      `**Research has no employees.** \`Research\` (dept_id 7) is a department with zero rows in \`employees\` - use it for \`LEFT JOIN\` / \`NOT EXISTS\` lessons. It still owns projects: ${researchProj}.`,
      `**Two employees have no department** (NULL \`dept_id\`): ${noDept}. They are not counted in any department headcount.`,
      `**Only one NULL manager:** ${noMgr}.`,
      `**Terminated employees (\`terminated_on\` not NULL):** ${term}. They still appear in \`salary_history\`, \`project_assignments\` (only for dates before they left) and as normal rows in \`employees\`; none of them managed anybody.`,
      `**Salary ties** (useful for \`RANK()\` vs \`DENSE_RANK()\` vs \`ROW_NUMBER()\`): ${ties}.`,
      `**Pay cuts:** exactly two salary decreases exist in \`salary_history\`: ${cuts} (a temporary reduction in April 2020 that was later reversed with raises).`,
      `**${unassigned.n} employees are on no project:** emp_id ${unassigned.ids} (the CEO, the Chief of Staff, the five VPs, one terminated account executive, one sales development rep and one marketing coordinator).`,
      `**Projects without assignments:** ${emptyProj}.`,
    ],
    facts: [
      await f('Employees in total / currently employed (terminated_on IS NULL)', "SELECT count(*) || ' / ' || count(*) FILTER (WHERE terminated_on IS NULL) FROM employees"),
      await f('Employees per department (including those with none)', 'SELECT d.name, count(e.emp_id) FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY d.dept_id', 'pairs'),
      await f('Total yearly payroll of current employees', 'SELECT sum(salary) FROM employees WHERE terminated_on IS NULL', 'money'),
      await f('Average salary per department', 'SELECT d.name, round(avg(e.salary), 2) FROM departments d JOIN employees e ON e.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY avg(e.salary) DESC', 'pairs'),
      await f('Second-highest distinct salary in Engineering (dept 2)', 'SELECT DISTINCT salary FROM employees WHERE dept_id = 2 ORDER BY salary DESC OFFSET 1 LIMIT 1', 'money'),
      await f('Employees with the top salary of their department (rank 1, ties included)', 'SELECT count(*) FROM (SELECT RANK() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS r FROM employees WHERE dept_id IS NOT NULL) t WHERE r = 1', 'int'),
      await f('Direct reports of the CEO', 'SELECT count(*) FROM employees WHERE manager_id = 1', 'int'),
      await f('Manager with the most direct reports', 'SELECT m.job_title || \' (emp \' || m.emp_id || \', \' || count(*) || \' reports)\' FROM employees e JOIN employees m ON m.emp_id = e.manager_id GROUP BY m.emp_id, m.job_title ORDER BY count(*) DESC, m.emp_id LIMIT 1'),
      await f('Total raise of the CEO since hire (first vs last salary_history row)', 'SELECT round(100.0 * (max(salary) - min(salary)) / min(salary), 1) || \'%\' FROM salary_history WHERE emp_id = 1'),
      await f('Total budget of active projects', "SELECT sum(budget) FROM projects WHERE status = 'active'", 'money'),
      await f('Projects per department (including departments with none)', 'SELECT d.name, count(p.project_id) FROM departments d LEFT JOIN projects p ON p.dept_id = d.dept_id GROUP BY d.dept_id, d.name ORDER BY d.dept_id', 'pairs'),
      await f('Employee working on the most projects', 'SELECT e.first_name || \' \' || e.last_name || \' (emp \' || e.emp_id || \', \' || count(*) || \' projects)\' FROM project_assignments a JOIN employees e ON e.emp_id = a.emp_id GROUP BY e.emp_id, e.first_name, e.last_name ORDER BY count(*) DESC, e.emp_id LIMIT 1'),
    ],
    topics: [
      'LEFT JOIN with departments that have no employees; COALESCE for the two employees without a department.',
      'Self joins: employee with manager name, employees earning more than their manager, peers with the same manager.',
      'Recursive CTEs: whole reporting chain of an employee, all reports below a VP, depth of each person, org chart paths.',
      'Aggregation by department and job level; HAVING; salary bands with CASE.',
      'Window functions: RANK / DENSE_RANK / ROW_NUMBER over salary, running payroll, LAG on `salary_history` to compute raises and spot pay cuts.',
      'Date arithmetic: tenure at hire date, time between raises, who was employed on a given day.',
      'Many-to-many through `project_assignments` (employees x projects), anti-joins for people on no project.',
    ],
  };
}

// =============================================================================
// 4. movies - FlickNest streaming
// =============================================================================

const MOVIE_GENRE_NAMES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Family', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi', 'Thriller'];
const GCODE = { AC: 1, AD: 2, AN: 3, CO: 4, CR: 5, DR: 6, FA: 7, FN: 8, HO: 9, RO: 10, SF: 11, TH: 12 };

// 110 invented titles with up to three genres each (first genre = primary genre)
const MOVIE_TITLES = `Thunder Corridor|AC,TH
Redline Protocol|AC,TH
The Last Bridge to Kestrel|AD,AC
Ashfall Run|AC,AD
Steel Monsoon|AC
Night Courier|AC,CR
Harbor of Knives|CR,TH
Operation Glass Meridian|AC,TH
Canyon Sundown|AD
Voltage Kings|AC,CO
Dagger Season|AC,TH
Glacier Run 9|AC,AD
Rogue Lantern|AC,SF
The Iron Orchard|CR,DR
Black Tide Rising|AC,AD
Mirage Division|AC,TH
Velocity Falls|AC
Smoke and Sparrow|CR,TH
The Gilded Heist|CR,CO
Cold Harbor Nights|CR,DR
Lockwood Vice|CR,TH
The Marrow Bay Ledger|CR,DR
Sixth Floor Alibi|TH
Whisper Under the Floor|HO,TH
The Quiet Cellar|HO
Hollow Pines|HO
The Hungry Lighthouse|HO
Seven Candles for Marla|HO,TH
Orbit of Strangers|SF,DR
Station Nine|SF,TH
The Lantern Planet|SF,AD
Neon Archive|SF,TH
Echoes of Andromeda Bay|SF
Quantum Tea Party|SF,CO
Starlit Cartographers|SF,AD
The Last Terraformer|SF,DR
Signal From Pallas|SF,TH
Moonwalk Motel|SF,CO
Dragon of the Salt Marsh|FN,AD
The Glass Orchard Kingdom|FN
Embers of the Wolf Crown|FN,AC
A Spell for Wednesday|FN,CO
The Cloud Cobbler|FN,FA
Mothlight|FN,DR
Willow and the Wind Library|AN,FN,FA
Pocket Dragons Academy|AN,FA,FN
Captain Pickle and the Moon Pirates|AN,FA,AD
The Little Cloud Who Wouldn't Rain|AN,FA
Robo Bakery|AN,FA,CO
Fox Lantern|AN,FN
Penny and the Paper Sea|AN,FA
Turbo Turtles|AN,CO,FA
Mango Island Mystery|AN,AD,FA
The Snowglobe Detectives|AN,FA
Zig the Zebra Goes to Space|AN,FA,SF
The Great Marshmallow Mix-Up|AN,CO,FA
Second Cousins Once Removed|CO
Plan B for Beatrice|CO,RO
The Seating Chart Disaster|CO,RO
Pizza Night Rebellion|CO,FA
Office Plant Wars|CO
My Grandmother the Spy|CO,AD
Dating in Zero Gravity|CO,RO,SF
The Honest Liar|CO,DR
Roommates on Elm Court|CO
Love Letters in Wrong Mailboxes|RO,CO
Summer at Lake Marigold|RO
The Violinist's Promise|RO,DR
Two Tickets to Lisbon|RO,DR
Rain Over Valparaiso|RO,DR
Winter Proposal at Pine Hollow|RO,CO
The Baker of Rosewater Lane|RO,DR
Kiss Me at the Harvest Fair|RO,CO
Letters from the Tea Plantation|RO,DR
The Long Way to Dawn|DR
Ashes and Orchards|DR
Silent Harvest Moon|DR
The Weight of Feathers|DR
Salt, Sugar, and Smoke|DR
Fourteen Winters|DR
The Clockmaker of Pell Street|DR,FN
A Cup of Borrowed Rain|DR
Daughters of the Copper Mine|DR
The Piano Under the Bridge|DR
Letters to Nowhere, Kansas|DR,CO
The Orchard Keeper's Son|DR
Ten Thousand Steps Home|DR,AD
Lighthouse Season|DR,RO
The Understudy|DR,CO
Gravel Road Gospel|DR
Marigold Street|DR,FA
The Great Kite Festival|FA,AD
Gus the Brave Goat|FA,AD
Detective Dot and the Missing Cupcake|FA,CO
Treehouse Summer Club|FA,AD
Penguin Postmen|FA,CO,AN
The Garden Behind the Bus Stop|FA,FN
Backyard Astronauts|FA,SF,CO
Twelve Grandmas and a Goat|CO,FA
Winter Break Ghost Club|FA,FN
Skatepark Saints|DR,CO
The Marathon Baker|DR,CO
Bridge to the Western Lights|AD,FN
Treasure of the Drowned Choir|AD,FN
Jungle Express 1912|AD,AC
The Cartographer of Wind|AD,FN
Raft of the Midnight Sun|AD,DR
Sahara Sky Rally|AD,AC
The Violet Carnival Murders|CR,TH
Frostbite Harbor|HO,TH`.split('\n').map((l) => {
  const [title, g] = l.split('|');
  return { title, genres: g.split(',').map((c) => GCODE[c]) };
});

const MOVIE_LANG = {
  'Rain Over Valparaiso': 'Spanish',
  'Daughters of the Copper Mine': 'Spanish',
  'Skatepark Saints': 'Spanish',
  'Two Tickets to Lisbon': 'Portuguese',
  'Jungle Express 1912': 'Portuguese',
  'Letters from the Tea Plantation': 'Hindi',
  'Marigold Street': 'Hindi',
  'Fox Lantern': 'Japanese',
  'A Cup of Borrowed Rain': 'Japanese',
  'The Baker of Rosewater Lane': 'French',
  'The Piano Under the Bridge': 'French',
  'Salt, Sugar, and Smoke': 'French',
  'Night Courier': 'French',
  'Silent Harvest Moon': 'Korean',
  'Harbor of Knives': 'Korean',
  'Ten Thousand Steps Home': 'Mandarin',
  Mothlight: 'German',
  'Ashes and Orchards': 'German',
  'Hollow Pines': 'German',
  'The Honest Liar': 'Italian',
  'Kiss Me at the Harvest Fair': 'Italian',
  'Quantum Tea Party': 'Japanese',
};

const COUNTRY_BY_GROUP = [
  ['United States', 'United Kingdom', 'Canada', 'Australia', 'Ireland'],
  ['Mexico', 'Spain', 'Brazil', 'Argentina', 'Colombia'],
  ['India', 'India', 'Pakistan', 'United Kingdom'],
  ['China', 'Japan', 'South Korea', 'Vietnam'],
  ['Nigeria', 'Ghana', 'South Africa', 'Kenya'],
  ['Germany', 'France', 'Italy', 'Sweden', 'Poland', 'Russia', 'Turkey', 'Norway'],
  ['Lebanon', 'Egypt', 'Israel', 'Iran'],
];

const CHAR_TITLES = ['Detective', 'Captain', 'Dr.', 'Professor', 'Sergeant', 'Agent', 'Mayor', 'Coach', 'Father', 'Judge'];

function buildMovies() {
  const rng = new Rng(4004);
  if (MOVIE_TITLES.length !== 110) throw new Error('movies: expected 110 titles, got ' + MOVIE_TITLES.length);

  // ---- movies --------------------------------------------------------------------
  const BASE_BUDGET = { 1: 70, 2: 60, 3: 90, 4: 25, 5: 22, 6: 15, 7: 45, 8: 80, 9: 8, 10: 14, 11: 85, 12: 20 };
  const DUR = { 3: [78, 98], 7: [82, 105], 9: [82, 108], 4: [88, 112], 10: [95, 120], 6: [100, 145], 1: [100, 140], 2: [105, 145], 11: [105, 150], 12: [95, 125], 5: [100, 135], 8: [105, 150] };
  const RATING_W = { 3: [35, 60, 5, 0], 7: [30, 60, 10, 0], 9: [0, 0, 20, 80], 4: [0, 20, 50, 30], 10: [0, 20, 65, 15], 6: [0, 15, 40, 45], 1: [0, 10, 62, 28], 2: [0, 30, 60, 10], 11: [0, 15, 60, 25], 12: [0, 0, 45, 55], 5: [0, 0, 30, 70], 8: [0, 35, 55, 10] };
  const raw = MOVIE_TITLES.map((m) => {
    const primary = m.genres[0];
    let year = 1975 + Math.floor(Math.pow(rng.next(), 0.65) * 50);
    if (primary === 3 && year < 1990) year = rng.int(1992, 2024);
    return { ...m, primary, year };
  });
  // make sure the extremes of the range are present
  raw.sort((a, b) => a.year - b.year);
  if (raw[0].primary !== 3) raw[0].year = 1975;
  else raw[1].year = 1975;
  raw[raw.length - 1].year = 2024;
  raw.sort((a, b) => a.year - b.year || (a.title < b.title ? -1 : 1));
  const nullBoth = new Set(rng.sample([...Array(110).keys()], 17));
  const nullIdx = [...nullBoth];
  const bothNull = new Set(nullIdx.slice(0, 9));
  const budgetNull = new Set(nullIdx.slice(9, 13));
  const boxNull = new Set(nullIdx.slice(13, 17));
  const movies = raw.map((m, i) => {
    const id = i + 1;
    const lang = MOVIE_LANG[m.title] || 'English';
    const [dlo, dhi] = DUR[m.primary];
    const rating = rng.weighted(['G', 'PG', 'PG-13', 'R'], RATING_W[m.primary]);
    let budget = BASE_BUDGET[m.primary] * rng.logNormal(0, 0.55) * (1 + (m.year - 1975) / 60);
    if (lang !== 'English') budget *= 0.5;
    budget = clamp(r1(budget), 0.5, 350);
    const mult = rng.logNormal(Math.log(m.primary === 9 ? 3.4 : 2.3), 0.7);
    const box = clamp(r1(budget * mult), 0.2, 1500);
    return {
      id,
      title: m.title,
      genres: m.genres,
      primary: m.primary,
      year: m.year,
      duration: rng.int(dlo, dhi),
      rating,
      lang,
      budget: bothNull.has(i) || budgetNull.has(i) ? null : budget,
      box: bothNull.has(i) || boxNull.has(i) ? null : box,
    };
  });
  const movieRows = movies.map((m) => [m.id, m.title, m.year, m.duration, m.rating, m.lang, m.budget, m.box]);
  const genreRows = MOVIE_GENRE_NAMES.map((n, i) => [i + 1, n]);
  const mgRows = [];
  for (const m of movies) for (const g of m.genres) mgRows.push([m.id, g]);

  // ---- people ---------------------------------------------------------------------------
  const NP = 90;
  const pn = makeNames(rng, NP);
  const DIRECTORS = [...Array(28).keys()]; // person index 0..27
  const DUAL = [26, 27]; // directors who also act
  const ACTORS = [...Array(54).keys()].map((i) => 28 + i).concat(DUAL); // 56 acting people
  const WRITER_ONLY = [...Array(8).keys()].map((i) => 82 + i);
  const WRITER_DIRECTORS = [0, 1, 3, 5, 8, 12];

  // directors: quotas and career windows
  // 20 busy directors share 102 films (a few direct many); the last 8 directed exactly one film
  const quota = allocate(102, [...Array(20).keys()].map((i) => 1 / Math.pow(i + 1, 0.45)), 1).concat(Array(8).fill(1));
  const dWin = DIRECTORS.map((i) => {
    const len = clamp(Math.round(8 + quota[i] * 2.4), 12, 38);
    return { start: rng.int(1975, 2024 - len), len };
  });
  const remaining = quota.slice();
  const directorOf = new Array(110).fill(-1);
  for (const mi of rng.shuffle([...Array(110).keys()])) {
    const y = movies[mi].year;
    let cands = DIRECTORS.filter((d) => remaining[d] > 0 && dWin[d].start <= y && y <= dWin[d].start + dWin[d].len);
    let w = cands.map((d) => remaining[d]);
    if (cands.length === 0) {
      cands = DIRECTORS.filter((d) => remaining[d] > 0);
      w = cands.map((d) => remaining[d] / (1 + Math.min(Math.abs(y - dWin[d].start), Math.abs(y - dWin[d].start - dWin[d].len))));
    }
    const d = rng.weighted(cands, w);
    directorOf[mi] = d;
    remaining[d]--;
  }

  // actors: career windows and popularity
  const aWin = new Map();
  const aPop = new Map();
  ACTORS.forEach((p, k) => {
    const start = clamp(1975 + Math.round((k / (ACTORS.length - 1)) * 36) + rng.int(-3, 3), 1975, 2010);
    const pop = rng.logNormal(0, 0.9) * (k % 7 === 0 ? 2.2 : 1) * (DUAL.includes(p) ? 1.8 : 1);
    aPop.set(p, pop);
    aWin.set(p, { start, end: start + rng.int(14, 32) + (pop > 2 ? 6 : 0) });
  });

  const movieActors = movies.map(() => []);
  movies.forEach((m, mi) => {
    const k = rng.weighted([2, 3, 4, 5, 6], [12, 28, 30, 20, 10]);
    const dir = directorOf[mi];
    for (const slack of [0, 8, 40]) {
      var cands = ACTORS.filter((p) => p !== dir && aWin.get(p).start - slack <= m.year && m.year <= aWin.get(p).end + slack);
      if (cands.length >= k) break;
    }
    const chosen = rng.weightedSample(cands, cands.map((p) => aPop.get(p)), k);
    chosen.sort((a, b) => aPop.get(b) * rng.float(0.6, 1.4) - aPop.get(a) * rng.float(0.6, 1.4));
    movieActors[mi] = chosen;
  });
  // dual people must have a few acting credits; one of them also acts in a film they directed
  for (const p of DUAL) {
    let credits = movieActors.filter((a) => a.includes(p)).length;
    const options = rng.shuffle(movies.map((m, mi) => mi).filter((mi) => directorOf[mi] !== p && !movieActors[mi].includes(p) && aWin.get(p).start - 6 <= movies[mi].year && movies[mi].year <= aWin.get(p).end + 6));
    for (const mi of options) {
      if (credits >= 3) break;
      if (movieActors[mi].length < 6) movieActors[mi].push(p);
      else movieActors[mi][movieActors[mi].length - 1] = p;
      credits++;
    }
  }
  // every acting person needs at least one credit
  for (const p of ACTORS) {
    if (movieActors.some((a) => a.includes(p))) continue;
    const options = rng.shuffle(movies.map((m, mi) => mi).filter((mi) => directorOf[mi] !== p && Math.abs(movies[mi].year - (aWin.get(p).start + aWin.get(p).end) / 2) <= 12));
    const mi = options[0];
    if (movieActors[mi].length < 6) movieActors[mi].push(p);
    else movieActors[mi][movieActors[mi].length - 1] = p;
  }
  {
    const p = DUAL[0];
    const own = movies.map((m, mi) => mi).filter((mi) => directorOf[mi] === p && movieActors[mi].length < 6);
    if (own.length) movieActors[own[0]].splice(rng.int(1, 2), 0, p);
  }

  const charNames = (mi) => {
    const seen = new Set();
    return (n) => {
      for (let t = 0; t < 50; t++) {
        const g = rng.pick(NAME_GROUPS);
        const first = rng.pick(g.first);
        const last = rng.pick(g.last);
        const r = rng.next();
        const nm = r < 0.2 ? `${rng.pick(CHAR_TITLES)} ${last}` : r < 0.35 ? first : `${first} ${last}`;
        if (!seen.has(nm)) {
          seen.add(nm);
          return nm;
        }
      }
      return `Character ${n}`;
    };
  };
  const castRows = [];
  const writerPool = WRITER_ONLY.concat(WRITER_DIRECTORS);
  const writerPop = new Map(writerPool.map((p) => [p, rng.logNormal(0, 0.7)]));
  movies.forEach((m, mi) => {
    const dir = directorOf[mi];
    castRows.push({ mi, p: dir, role: 'director', ch: null, bill: null });
    const nameFn = charNames(mi);
    movieActors[mi].forEach((p, idx) => {
      castRows.push({ mi, p, role: 'actor', ch: nameFn(idx), bill: idx + 1 });
    });
    const nw = rng.weighted([0, 1, 2], [9, 77, 14]);
    const ws = [];
    if (nw >= 1 && WRITER_DIRECTORS.includes(dir) && rng.chance(0.55)) ws.push(dir);
    while (ws.length < nw) {
      const pool = writerPool.filter((p) => !ws.includes(p));
      ws.push(rng.weighted(pool, pool.map((p) => writerPop.get(p))));
    }
    for (const p of ws) {
      castRows.push({ mi, p, role: 'writer', ch: null, bill: null });
    }
  });
  // every writer-only person needs at least one credit
  for (const p of WRITER_ONLY) {
    if (castRows.some((c) => c.p === p)) continue;
    const slots = castRows.filter((c) => c.role === 'writer' && !castRows.some((o) => o.mi === c.mi && o.p === p && o.role === 'writer'));
    rng.pick(slots).p = p;
  }
  const credits = new Map(); // person index -> [years]
  for (const c of castRows) {
    if (!credits.has(c.p)) credits.set(c.p, []);
    credits.get(c.p).push(movies[c.mi].year);
  }

  // birth years from the earliest credit, a few unknown
  const unknownBirth = new Set(rng.sample([...Array(NP).keys()], 6));
  const permId = rng.shuffle([...Array(NP).keys()]); // person index -> id-1
  const people = pn.map((n, idx) => {
    const ys = credits.get(idx) || [];
    const minY = Math.min(...ys);
    let age;
    if (DUAL.includes(idx)) age = rng.int(20, 32);
    else if (DIRECTORS.includes(idx)) age = rng.int(27, 42);
    else if (WRITER_ONLY.includes(idx)) age = rng.int(24, 40);
    else age = rng.int(19, 36);
    const maxY = Math.max(...ys);
    let birthYear = Math.max(minY - age, maxY - 78); // nobody is older than 78 in a credit
    if (birthYear > minY - 18) birthYear = minY - 18; // nobody is younger than 18
    return {
      idx,
      id: permId[idx] + 1,
      name: `${n.first} ${n.last}`,
      birth: unknownBirth.has(idx) ? null : birthYear,
      country: rng.pick(COUNTRY_BY_GROUP[n.g]),
    };
  });
  people.sort((a, b) => a.id - b.id);
  const pid = (idx) => permId[idx] + 1;
  const peopleRows = people.map((p) => [p.id, p.name, p.birth, p.country]);
  const roleOrder = { director: 0, actor: 1, writer: 2 };
  castRows.sort((a, b) => a.mi - b.mi || roleOrder[a.role] - roleOrder[b.role] || (a.bill || 0) - (b.bill || 0) || pid(a.p) - pid(b.p));
  const castOut = castRows.map((c) => [movies[c.mi].id, pid(c.p), c.role, c.ch, c.bill]);

  // ---- users -----------------------------------------------------------------------------------------
  const ADJ = 'cosmic sleepy neon quiet happy brave lucky mellow golden rapid fuzzy silver retro sunny witty wild cozy pixel velvet electric lunar arctic amber crimson dusty gentle jolly nimble proud zesty'.split(' ');
  const NOUN = 'otter falcon panda comet maple tiger pixel ranger lotus badger heron koala nomad pilot sparrow wizard yeti zebra ember harbor jaguar lynx orbit quokka raven sloth turtle viper whale fox'.split(' ');
  const taken = new Set();
  const NU = 220;
  const signDays = Array.from({ length: NU }, () => dnum('2022-01-01') + Math.floor(Math.pow(rng.next(), 0.75) * (dnum('2024-06-30') - dnum('2022-01-01') + 1))).sort((a, b) => a - b);
  const UC = ['United States', 'United Kingdom', 'India', 'Brazil', 'Canada', 'Germany', 'France', 'Australia', 'Japan', 'Mexico', 'Spain', 'South Korea', 'Nigeria', 'Italy'];
  const UCW = [35, 8, 10, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2];
  const users = signDays.map((d, i) => {
    let uname;
    do uname = `${rng.pick(ADJ)}_${rng.pick(NOUN)}${rng.int(1, 99)}`;
    while (taken.has(uname));
    taken.add(uname);
    return {
      id: i + 1,
      username: uname,
      country: rng.weighted(UC, UCW),
      signup: dstr(d),
      plan: rng.weighted(['free', 'basic', 'premium'], [48, 30, 22]),
      act: rng.logNormal(0, 0.9),
      device: rng.weighted(['tv', 'mobile', 'web', 'tablet'], [38, 28, 24, 10]),
    };
  });
  const userRows = users.map((u) => [u.id, u.username, u.country, u.signup, u.plan]);

  // ---- ratings ------------------------------------------------------------------------------------------------
  const noRatings = new Set(rng.sample([...Array(110).keys()], 6));
  const mPop = movies.map((m, i) => (noRatings.has(i) ? 0 : rng.logNormal(0, 1.1) * (m.year >= 2015 ? 1.3 : 1)));
  const mQual = movies.map(() => rng.normal(0, 0.6));
  const uBias = users.map(() => rng.normal(0, 0.35));
  const uSampler = makeSampler(users.map((u) => u.act));
  const mSampler = makeSampler(mPop);
  const hourW = [2, 1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 6, 8, 10, 12, 12, 8, 4];
  const seen = new Set();
  const ratings = [];
  for (let attempts = 0; ratings.length < 1800 && attempts < 400000; attempts++) {
    const ui = uSampler.draw(rng);
    const mi = mSampler.draw(rng);
    const key = ui * 1000 + mi;
    if (seen.has(key)) continue;
    seen.add(key);
    const u = users[ui];
    const lo = Math.max(dnum(u.signup), dnum(`${movies[mi].year}-01-01`));
    const hi = dnum('2024-12-31');
    const day = lo + Math.floor(Math.pow(rng.next(), 1.25) * (hi - lo + 1));
    const t = day * DAY + rng.weightedIndex(hourW) * 3600 + rng.int(0, 3599);
    const stars = clamp(Math.round((3.7 + mQual[mi] + uBias[ui] + rng.normal(0, 0.75)) * 2) / 2, 0.5, 5);
    ratings.push({ u: u.id, m: movies[mi].id, stars, t });
  }
  ratings.sort((a, b) => a.u - b.u || a.m - b.m);
  const ratingRows = ratings.map((r) => [r.u, r.m, r.stars, tstr(r.t)]);

  // ---- watch_history --------------------------------------------------------------------------------------------
  const inactive = new Set(rng.sample(users.map((u) => u.id), 12));
  const watchPop = movies.map((m, i) => (mPop[i] > 0 ? mPop[i] : 0.15) ** 0.85 * rng.float(0.7, 1.3));
  const wSampler = makeSampler(watchPop);
  const nSessions = allocate(2050, users.map((u) => (inactive.has(u.id) ? 0 : u.act)));
  const WDAY = [1, 0.6, 0.55, 0.6, 0.7, 0.95, 1];
  const wHourW = [3, 2, 1, 1, 1, 1, 2, 3, 4, 4, 4, 5, 5, 5, 5, 5, 6, 7, 9, 11, 13, 13, 9, 5];
  const watches = [];
  const H1_END = tsec('2024-06-30', 23, 59, 59);
  users.forEach((u, ui) => {
    const lo = Math.max(dnum(u.signup), dnum('2024-01-01'));
    const hi = dnum('2024-06-30');
    const starts = [];
    for (let k = 0; k < nSessions[ui]; k++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const day = lo + rng.int(0, hi - lo);
        if (!rng.chance(WDAY[dow(dstr(day))])) continue;
        const t = day * DAY + rng.weightedIndex(wHourW) * 3600 + rng.int(0, 3599);
        if (t > H1_END) continue;
        if (starts.some((s) => Math.abs(s - t) < 6 * 3600)) continue;
        starts.push(t);
        break;
      }
    }
    starts.sort((a, b) => a - b);
    for (const t0 of starts) {
      const binge = rng.chance(0.22) && t0 < H1_END - 3 * 3600;
      const n = binge ? rng.int(3, 6) : 1;
      let t = t0;
      const picked = new Set();
      for (let j = 0; j < n; j++) {
        let mi;
        do mi = wSampler.draw(rng);
        while (picked.has(mi));
        picked.add(mi);
        const dur = movies[mi].duration;
        let minutes;
        if (binge && j < n - 1) minutes = rng.int(1, 25);
        else {
          const r = rng.next();
          if (r < 0.55) minutes = dur;
          else if (r < 0.75) minutes = dur - rng.int(1, 8);
          else minutes = rng.int(3, dur - 10);
        }
        watches.push({
          u: u.id,
          m: movies[mi].id,
          t,
          minutes: clamp(minutes, 1, dur),
          device: rng.chance(0.75) ? u.device : rng.weighted(['tv', 'mobile', 'web', 'tablet'], [30, 30, 28, 12]),
        });
        t += rng.int(3, 28) * 60 + rng.int(0, 59);
      }
    }
  });
  watches.sort((a, b) => a.t - b.t || a.u - b.u);
  const watchRows = watches.map((w, i) => [i + 1, w.u, w.m, tstr(w.t), w.minutes, w.device]);

  const tables = [
    T('movies', 'The FlickNest film catalog.', [
      ['movie_id', 'integer', 'PRIMARY KEY', 'Unique id of the movie (ids are in release-year order)'],
      ['title', 'text', 'NOT NULL', 'Movie title'],
      ['release_year', 'integer', 'NOT NULL', 'Year the movie was released'],
      ['duration_min', 'integer', 'NOT NULL', 'Running time in minutes'],
      ['age_rating', 'text', 'NOT NULL', 'Age rating: G, PG, PG-13 or R'],
      ['language', 'text', 'NOT NULL', 'Original language of the movie'],
      ['budget_musd', 'numeric(6,1)', '', 'Production budget in millions of US dollars (empty when unknown)'],
      ['box_office_musd', 'numeric(7,1)', '', 'Worldwide box office in millions of US dollars (empty when unknown)'],
    ], movieRows),
    T('genres', 'The twelve genres a movie can belong to.', [
      ['genre_id', 'integer', 'PRIMARY KEY', 'Unique id of the genre'],
      ['name', 'text', 'NOT NULL UNIQUE', 'Genre name'],
    ], genreRows),
    T('movie_genres', 'Links movies to their genres (a movie can have one to three genres).', [
      ['movie_id', 'integer', 'NOT NULL REFERENCES movies (movie_id)', 'The movie'],
      ['genre_id', 'integer', 'NOT NULL REFERENCES genres (genre_id)', 'One of the movie\'s genres'],
    ], mgRows, { constraints: ['PRIMARY KEY (movie_id, genre_id)'] }),
    T('people', 'Actors, directors and writers who worked on the movies.', [
      ['person_id', 'integer', 'PRIMARY KEY', 'Unique id of the person'],
      ['full_name', 'text', 'NOT NULL', 'Full name'],
      ['birth_year', 'integer', '', 'Year of birth (empty when unknown)'],
      ['country', 'text', 'NOT NULL', 'Country the person is from'],
    ], peopleRows),
    T('movie_cast', 'Who worked on each movie and in which role (actor, director or writer).', [
      ['movie_id', 'integer', 'NOT NULL REFERENCES movies (movie_id)', 'The movie'],
      ['person_id', 'integer', 'NOT NULL REFERENCES people (person_id)', 'The person'],
      ['role', 'text', 'NOT NULL', 'What the person did on the movie: actor, director or writer'],
      ['character_name', 'text', '', 'Character played (only for actors)'],
      ['billing_order', 'integer', '', 'Position in the credits, 1 = top billed (only for actors)'],
    ], castOut, { constraints: ['PRIMARY KEY (movie_id, person_id, role)'] }),
    T('users', 'FlickNest subscribers.', [
      ['user_id', 'integer', 'PRIMARY KEY', 'Unique id of the user'],
      ['username', 'text', 'NOT NULL UNIQUE', 'Public username'],
      ['country', 'text', 'NOT NULL', 'Country of the user'],
      ['signup_date', 'date', 'NOT NULL', 'Day the user signed up'],
      ['plan', 'text', 'NOT NULL', 'Subscription plan: free, basic or premium'],
    ], userRows),
    T('ratings', 'Star ratings users gave to movies (at most one rating per user per movie).', [
      ['user_id', 'integer', 'NOT NULL REFERENCES users (user_id)', 'User who rated'],
      ['movie_id', 'integer', 'NOT NULL REFERENCES movies (movie_id)', 'Movie that was rated'],
      ['stars', 'numeric(2,1)', 'NOT NULL CHECK (stars BETWEEN 0.5 AND 5.0)', 'Rating from 0.5 to 5.0 in steps of 0.5'],
      ['rated_at', 'timestamp', 'NOT NULL', 'Date and time of the rating'],
    ], ratingRows, { constraints: ['PRIMARY KEY (user_id, movie_id)'] }),
    T('watch_history', 'Every time a user pressed play (January to June 2024).', [
      ['watch_id', 'integer', 'PRIMARY KEY', 'Unique id of the viewing'],
      ['user_id', 'integer', 'NOT NULL REFERENCES users (user_id)', 'User who watched'],
      ['movie_id', 'integer', 'NOT NULL REFERENCES movies (movie_id)', 'Movie that was watched'],
      ['started_at', 'timestamp', 'NOT NULL', 'Date and time playback started'],
      ['minutes_watched', 'integer', 'NOT NULL', 'Minutes actually watched (never more than the movie length)'],
      ['device', 'text', 'NOT NULL', 'Device used: tv, mobile, web or tablet'],
    ], watchRows),
  ];

  return {
    id: 'movies',
    name: 'FlickNest',
    icon: '🎬',
    tagline: 'A streaming service with movies, cast, ratings and viewing history.',
    description:
      'FlickNest is a movie streaming service with 110 invented films, their genres, directors and casts, 220 subscribers, ratings and half a year of viewing history. ' +
      'It is made for many-to-many relationships, window functions, ranking and aggregation, and the watch history even contains binge sessions for you to untangle. ' +
      'All titles and people are fictional.',
    tables,
    extra: { DUAL: DUAL.map(pid), noRatings: [...noRatings].map((i) => movies[i].id), inactive: [...inactive] },
  };
}

// ---- documentation: movies --------------------------------------------------------------------
async function docMovies(q, ds) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const one = async (sql) => (await q.rows(sql))[0];

  const m = await one('SELECT count(*) AS n, min(release_year) AS y1, max(release_year) AS y2, min(duration_min) AS d1, max(duration_min) AS d2, round(avg(duration_min), 1)::text AS dav FROM movies');
  const decades = await list('SELECT (release_year / 10 * 10) || \'s: \' || count(*) AS v FROM movies GROUP BY release_year / 10 * 10 ORDER BY release_year / 10 * 10');
  const langs = await list('SELECT language || \' \' || count(*) AS v FROM movies GROUP BY language ORDER BY count(*) DESC, language');
  const rated = await list('SELECT age_rating || \' \' || count(*) AS v FROM movies GROUP BY age_rating ORDER BY age_rating');
  const nulls = await one('SELECT count(*) FILTER (WHERE budget_musd IS NULL AND box_office_musd IS NULL) AS both, count(*) FILTER (WHERE budget_musd IS NULL AND box_office_musd IS NOT NULL) AS only_budget, count(*) FILTER (WHERE budget_musd IS NOT NULL AND box_office_musd IS NULL) AS only_box, count(*) FILTER (WHERE budget_musd IS NULL OR box_office_musd IS NULL) AS any FROM movies');
  const flops = await q.val('SELECT count(*) FROM movies WHERE box_office_musd < budget_musd');
  const gPer = await list('SELECT n || \' genre\' || (CASE WHEN n > 1 THEN \'s\' ELSE \'\' END) || \': \' || count(*) AS v FROM (SELECT movie_id, count(*) AS n FROM movie_genres GROUP BY movie_id) t GROUP BY n ORDER BY n');
  const genreCounts = await list('SELECT g.name || \' \' || count(*) AS v FROM movie_genres mg JOIN genres g USING (genre_id) GROUP BY g.genre_id, g.name ORDER BY count(*) DESC, g.name');
  const roles = await list('SELECT role || \' \' || count(*) || \' credits by \' || count(DISTINCT person_id) || \' people\' AS v FROM movie_cast GROUP BY role ORDER BY role');
  must((await q.val("SELECT count(*) FROM (SELECT movie_id FROM movie_cast GROUP BY movie_id HAVING count(*) FILTER (WHERE role = 'director') <> 1 OR count(*) FILTER (WHERE role = 'actor') NOT BETWEEN 2 AND 6) t")) === 0, 'each movie has exactly 1 director and 2-6 actors');
  must((await q.val('SELECT count(*) FROM movies a JOIN movies b ON b.movie_id = a.movie_id + 1 WHERE b.release_year < a.release_year')) === 0, 'movie ids are in release-year order');
  must((await q.val("SELECT count(*) FROM movie_cast WHERE (role = 'actor') <> (character_name IS NOT NULL) OR (role = 'actor') <> (billing_order IS NOT NULL)")) === 0, 'character_name and billing_order only for actors');
  const writers = await one("SELECT count(DISTINCT movie_id) AS withw FROM movie_cast WHERE role = 'writer'");
  const dual = await list("SELECT p.person_id || ' ' || p.full_name || ' (' || count(*) FILTER (WHERE c.role = 'director') || ' directed, ' || count(*) FILTER (WHERE c.role = 'actor') || ' acted)' AS v FROM people p JOIN movie_cast c USING (person_id) GROUP BY p.person_id, p.full_name HAVING count(*) FILTER (WHERE c.role = 'director') > 0 AND count(*) FILTER (WHERE c.role = 'actor') > 0 ORDER BY p.person_id");
  const topDir = await list("SELECT p.full_name || ' (person ' || p.person_id || ', ' || count(*) || ' films)' AS v FROM movie_cast c JOIN people p USING (person_id) WHERE c.role = 'director' GROUP BY p.person_id, p.full_name ORDER BY count(*) DESC, p.person_id LIMIT 3");
  const dirDist = await one("SELECT count(*) AS dirs, count(*) FILTER (WHERE n = 1) AS once, max(n) AS mx FROM (SELECT person_id, count(*) AS n FROM movie_cast WHERE role = 'director' GROUP BY person_id) t");
  const ageRange = await one('SELECT min(m.release_year - p.birth_year) AS lo, max(m.release_year - p.birth_year) AS hi FROM movie_cast c JOIN movies m USING (movie_id) JOIN people p USING (person_id) WHERE p.birth_year IS NOT NULL');
  const dirWrit = await q.val("SELECT count(*) FROM movie_cast d JOIN movie_cast w ON w.movie_id = d.movie_id AND w.person_id = d.person_id AND w.role = 'writer' WHERE d.role = 'director'");
  const unk = await q.val('SELECT count(*) FROM people WHERE birth_year IS NULL');
  const peopleCountries = await one('SELECT count(DISTINCT country) AS n FROM people');
  const usr = await one('SELECT count(*) AS n, min(signup_date)::text AS lo, max(signup_date)::text AS hi FROM users');
  const plans = await list('SELECT plan || \' \' || count(*) AS v FROM users GROUP BY plan ORDER BY count(*) DESC');
  const rt = await one('SELECT count(*) AS n, round(avg(stars), 2)::text AS av, min(rated_at)::text AS lo, max(rated_at)::text AS hi, count(DISTINCT user_id) AS users, count(DISTINCT movie_id) AS movies FROM ratings');
  must((await q.val('SELECT count(*) FROM ratings r JOIN users u USING (user_id) JOIN movies m USING (movie_id) WHERE r.rated_at::date < u.signup_date OR extract(year FROM r.rated_at) < m.release_year')) === 0, 'ratings come after signup and release year');
  const noRated = await list('SELECT m.movie_id || \' \' || m.title AS v FROM movies m WHERE NOT EXISTS (SELECT 1 FROM ratings r WHERE r.movie_id = m.movie_id) ORDER BY m.movie_id');
  const noRatedN = await q.val('SELECT count(*) FROM movies m WHERE NOT EXISTS (SELECT 1 FROM ratings r WHERE r.movie_id = m.movie_id)');
  const noRatingUsers = await list('SELECT user_id::text AS v FROM users u WHERE NOT EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = u.user_id) ORDER BY user_id');
  const rSkew = await one('WITH c AS (SELECT movie_id, count(*) AS n FROM ratings GROUP BY movie_id) SELECT max(n) AS mx, percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::text AS med, count(*) FILTER (WHERE n <= 3) AS tiny FROM c');
  const stars = await list('SELECT stars || \': \' || count(*) AS v FROM ratings GROUP BY stars ORDER BY stars');
  const wh = await one('SELECT count(*) AS n, min(started_at)::text AS lo, max(started_at)::text AS hi, count(DISTINCT user_id) AS users, count(DISTINCT movie_id) AS movies FROM watch_history');
  must((await q.val('SELECT count(*) FROM watch_history w JOIN movies m USING (movie_id) JOIN users u USING (user_id) WHERE w.minutes_watched > m.duration_min OR w.started_at::date < u.signup_date')) === 0, 'watch minutes <= duration and after signup');
  const noWatch = await q.val('SELECT count(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM watch_history w WHERE w.user_id = u.user_id)');
  const devices = await list('SELECT device || \' \' || count(*) AS v FROM watch_history GROUP BY device ORDER BY count(*) DESC');
  const gaps = await one("WITH g AS (SELECT started_at - lag(started_at) OVER (PARTITION BY user_id ORDER BY started_at) AS gap FROM watch_history) SELECT to_char(max(gap) FILTER (WHERE gap <= interval '30 minutes'), 'HH24:MI:SS') AS within, to_char(min(gap) FILTER (WHERE gap > interval '30 minutes'), 'HH24:MI:SS') AS between FROM g");
  const sess = await one("WITH g AS (SELECT user_id, started_at, started_at - lag(started_at) OVER (PARTITION BY user_id ORDER BY started_at) AS gap FROM watch_history), s AS (SELECT user_id, sum(CASE WHEN gap IS NULL OR gap > interval '30 minutes' THEN 1 ELSE 0 END) AS n, count(*) AS plays FROM g GROUP BY user_id) SELECT sum(n)::int AS sessions, sum(plays)::int AS plays FROM s");
  const bingeSessions = await q.val("WITH g AS (SELECT user_id, started_at, CASE WHEN started_at - lag(started_at) OVER (PARTITION BY user_id ORDER BY started_at) > interval '30 minutes' OR lag(started_at) OVER (PARTITION BY user_id ORDER BY started_at) IS NULL THEN 1 ELSE 0 END AS new_s FROM watch_history), s AS (SELECT user_id, started_at, sum(new_s) OVER (PARTITION BY user_id ORDER BY started_at) AS sid FROM g) SELECT count(*) FROM (SELECT user_id, sid FROM s GROUP BY user_id, sid HAVING count(*) >= 3) t");
  const completion = await one('SELECT count(*) FILTER (WHERE w.minutes_watched = m.duration_min) AS full, count(*) FILTER (WHERE w.minutes_watched < 0.5 * m.duration_min) AS under_half FROM watch_history w JOIN movies m USING (movie_id)');

  must(dual.split('), ').length === 2, 'exactly two people both act and direct');
  return {
    about:
      'FlickNest is built around **many-to-many** relationships (movies and genres, movies and people, users and movies) and around **time**: a rating history that spans three years and a half-year of viewing logs with realistic binge sessions. ' +
      'All 110 titles and 90 people are invented. "As of" date: **2024-12-31** for ratings, **2024-06-30** for the end of the watch history.',
    conventions: [
      `**Movies:** ${m.n} films released ${m.y1} to ${m.y2} (by decade: ${decades}); running time ${m.d1} to ${m.d2} minutes (average ${m.dav}). Movie ids are assigned in release-year order. Languages: ${langs}. Age ratings: ${rated} (animation and family films are G/PG, horror is mostly R).`,
      `**Money columns** are in *millions* of US dollars (\`budget_musd\`, \`box_office_musd\`). ${nulls.any} films (${((nulls.any / m.n) * 100).toFixed(0)}%) have a NULL budget and/or box office: ${nulls.both} have both NULL, ${nulls.only_budget} only the budget, ${nulls.only_box} only the box office. ${flops} films earned less than they cost.`,
      `**Genres:** 12 genres; a film has ${gPer}. Films per genre (counting multi-genre films once per genre): ${genreCounts}.`,
      `**Cast and crew** (\`movie_cast\`): ${roles}. Every film has **exactly one director** and **2 to 6 actors** (\`billing_order\` 1 = top billed, \`character_name\` only for actors) and ${writers.withw} films have one or two credited writers. The primary key is (movie_id, person_id, role), so one person may hold several roles on a film: ${dirWrit} films were written by their own director. A few directors direct many films: ${topDir}; ${dirDist.dirs} directors in total, ${dirDist.once} of them directed just one film.`,
      `**People:** 90 people from ${peopleCountries.n} countries; the age at release (\`release_year - birth_year\`) for every credit is between ${ageRange.lo} and ${ageRange.hi}. ${unk} people have an unknown \`birth_year\`.`,
      `**Users:** ${usr.n} subscribers who signed up ${usr.lo} to ${usr.hi}; plans: ${plans}.`,
      `**Ratings:** ${commas(rt.n)} ratings by ${rt.users} users on ${rt.movies} films, from ${rt.lo.slice(0, 10)} to ${rt.hi.slice(0, 10)}; \`stars\` is a multiple of 0.5 between 0.5 and 5.0 (distribution - ${stars}; average ${rt.av}). A rating is never earlier than the user's signup date or the film's release year. Popularity is very uneven: the most-rated film has ${rSkew.mx} ratings, the median film ${rSkew.med}, and ${rSkew.tiny} films have 3 or fewer.`,
      `**Watch history:** ${commas(wh.n)} plays by ${wh.users} users on ${wh.movies} films between ${wh.lo} and ${wh.hi}. Devices: ${devices}. \`minutes_watched\` never exceeds the film's \`duration_min\` (${commas(completion.full)} plays were watched to the very end, ${commas(completion.under_half)} stopped before the halfway point).`,
      `**Binge sessions (sessionization).** Plays of one user come in clusters: inside a cluster consecutive plays start at most **${gaps.within}** apart (hh:mm:ss), while the next cluster of the same user starts at least **${gaps.between}** after the previous play. So a 30-minute inactivity rule gives exactly ${commas(sess.sessions)} sessions for the ${commas(sess.plays)} plays, and ${commas(bingeSessions)} of those sessions contain 3 or more plays. In a binge the first plays are short samples (a few minutes) and only the last one is watched properly.`,
    ],
    quirks: [
      `**${noRatedN} films have no ratings at all:** ${noRated}.`,
      `**${noRatingUsers.split(',').filter(Boolean).length} users never rated a film** (user_id ${noRatingUsers}); **${noWatch} users have no plays** in the watch history (they signed up but were inactive in January-June 2024).`,
      `**Two people both act and direct:** ${dual}. (Other directors may also be credited as writers, but only these two appear as actors.)`,
      `**${unk} people have a NULL birth_year.**`,
      'The same person can appear several times for one film with different roles (director + writer), so always include `role` when counting or joining `movie_cast`.',
      'A user may watch the same film more than once (replays), but rates it at most once (primary key on `ratings`).',
      'Ratings and plays are generated independently: a user can rate a film that never appears in their watch history, and vice versa.',
    ],
    facts: [
      await f('Number of films / people / users', "SELECT (SELECT count(*) FROM movies) || ' / ' || (SELECT count(*) FROM people) || ' / ' || (SELECT count(*) FROM users)"),
      await f('Average rating of all ratings', 'SELECT round(avg(stars), 2) FROM ratings'),
      await f('Most-rated film', 'SELECT m.title || \' (\' || count(*) || \' ratings, average \' || round(avg(r.stars), 2) || \')\' FROM ratings r JOIN movies m ON m.movie_id = r.movie_id GROUP BY m.movie_id, m.title ORDER BY count(*) DESC, m.title LIMIT 1'),
      await f('Highest average rating among films with at least 25 ratings', 'SELECT m.title || \' (\' || round(avg(r.stars), 2) || \' from \' || count(*) || \' ratings)\' FROM ratings r JOIN movies m ON m.movie_id = r.movie_id GROUP BY m.movie_id, m.title HAVING count(*) >= 25 ORDER BY avg(r.stars) DESC, m.title LIMIT 1'),
      await f('Director with the most films', "SELECT p.full_name || ' (' || count(*) || ' films)' FROM movie_cast c JOIN people p ON p.person_id = c.person_id WHERE c.role = 'director' GROUP BY p.person_id, p.full_name ORDER BY count(*) DESC, p.person_id LIMIT 1"),
      await f('Actor with the most credits', "SELECT p.full_name || ' (' || count(*) || ' films)' FROM movie_cast c JOIN people p ON p.person_id = c.person_id WHERE c.role = 'actor' GROUP BY p.person_id, p.full_name ORDER BY count(*) DESC, p.person_id LIMIT 1"),
      await f('Highest-grossing film (box_office_musd)', 'SELECT title || \' (\' || box_office_musd || \' million)\' FROM movies WHERE box_office_musd IS NOT NULL ORDER BY box_office_musd DESC LIMIT 1'),
      await f('Films per age rating', 'SELECT age_rating, count(*) FROM movies GROUP BY 1 ORDER BY 1', 'pairs'),
      await f('Users per plan', 'SELECT plan, count(*) FROM users GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Total minutes watched in the watch history', 'SELECT sum(minutes_watched) FROM watch_history', 'int'),
      await f('Plays per month (2024)', "SELECT to_char(started_at, 'YYYY-MM') AS month, count(*) FROM watch_history GROUP BY to_char(started_at, 'YYYY-MM') ORDER BY 1", 'pairs'),
      await f('Most-watched film (plays)', 'SELECT m.title || \' (\' || count(*) || \' plays)\' FROM watch_history w JOIN movies m ON m.movie_id = w.movie_id GROUP BY m.movie_id, m.title ORDER BY count(*) DESC, m.title LIMIT 1'),
    ],
    topics: [
      'Many-to-many joins: films by genre, films by actor, actors who worked with a given director (`movie_cast` self join).',
      'Aggregation and HAVING: average rating per film with a minimum number of ratings; films without ratings (LEFT JOIN / NOT EXISTS).',
      'Window functions: rank films by rating within each genre or decade, running totals of plays, `LAG` between a user\'s consecutive plays.',
      'Sessionization: group plays into sessions with a 30-minute gap rule (`LAG` + running `SUM` of a "new session" flag).',
      'Conditional aggregation and `FILTER` for devices or plans; date truncation by week or month.',
      'NULL-handling in `budget_musd` / `box_office_musd` (profit, ROI, `COALESCE`, `NULLIF`).',
    ],
  };
}

// =============================================================================
// 5. bank - Harbor Bank
// =============================================================================

const MERCHANTS = {
  groceries: ['Fresh Basket Market', 'Corner Grocer', 'GreenLeaf Foods', 'Harvest Moon Co-op', 'Daily Bread Mart'],
  dining: ['Luna Noodle House', 'Copper Kettle Diner', 'Brick Oven Pizzeria', 'Sunrise Bagels', 'Taco Alley', 'Saffron Kitchen', 'Bean There Coffee'],
  travel: ['SkyHop Airlines', 'Metro Rail Pass', 'RoadRunner Car Rental', 'Cozy Nights Inn', 'CityRide Taxi', 'Wanderly Tours'],
  utilities: ['Bright Power & Light', 'ClearWater Utility', 'FiberNet Broadband', 'Pocket Mobile', 'CityGas Services'],
  shopping: ['Orion Electronics', 'Threadbare Clothing', 'HomeNest Furnishings', 'BookBarn', 'Gadget Galaxy Online', 'Paper & Pine Stationery'],
  entertainment: ['StarLite Cinemas', 'Playground Arcade', 'StreamBox Subscription', 'Concert Hall Tickets', 'Pixel Games Store'],
  health: ['CareFirst Pharmacy', 'Vitality Gym', 'Smile Dental', 'WellSpring Clinic'],
};
const EMPLOYERS = ['Brightwater Logistics', 'Northgate Health', 'Pinecrest Software', 'Summit Schools District', 'Copperline Construction', 'Lakeview Hospital', 'Harborline Shipping', 'Greenfield Foods', 'Atlas Staffing', 'City of Eastbrook', 'Bluebird Bakery Group', 'Evergreen Insurance'];
const LANDLORDS = ['Oakwood Properties', 'Maple Court Apartments', 'Riverstone Rentals', 'Sunnyside Housing', 'Lighthouse Lofts'];
const ATM_PLACES = ['Main Street', 'Central Station', 'Westfield Plaza', 'Harbor Pier', 'University Ave', 'Airport Terminal 2', 'Market Square'];

const CARD_CATEGORY_W = { groceries: 28, dining: 26, shopping: 18, entertainment: 10, health: 8, travel: 6 };
const CARD_HOURS = { groceries: [9, 20], dining: [11, 22], shopping: [10, 21], entertainment: [17, 23], health: [8, 17], travel: [5, 23], utilities: [6, 10] };
const MONTH_SPEND = [1, 0.95, 1, 1, 1, 1, 1.05, 1, 1, 1.05, 1.2, 1.4];

function cardAmount(rng, cat) {
  switch (cat) {
    case 'groceries':
      return clamp(r2(rng.logNormal(Math.log(52), 0.55)), 6, 220);
    case 'dining':
      return clamp(r2(rng.logNormal(Math.log(27), 0.5)), 5, 140);
    case 'travel':
      return clamp(r2(rng.logNormal(Math.log(95), 0.9)), 12, 1100);
    case 'utilities':
      return clamp(r2(rng.float(38, 225)), 25, 260);
    case 'shopping':
      return clamp(r2(rng.logNormal(Math.log(62), 0.8)), 8, 520);
    case 'entertainment':
      return clamp(r2(rng.logNormal(Math.log(24), 0.6)), 5, 160);
    default:
      return clamp(r2(rng.logNormal(Math.log(48), 0.7)), 8, 380);
  }
}

function buildBank() {
  const rng = new Rng(5005);
  const YEAR_START = '2024-01-01';
  const YEAR_END = '2024-12-31';

  // ---- branches (5) ----------------------------------------------------------------------
  const branchRows = [
    [1, 'Harbor Bank Downtown', 'Seattle', '1998-04-06'],
    [2, 'Harbor Bank Lakeside', 'Chicago', '2003-09-15'],
    [3, 'Harbor Bank Riverside', 'Austin', '2009-02-23'],
    [4, 'Harbor Bank Midtown', 'New York', '2014-06-30'],
    [5, 'Harbor Bank Bayfront', 'San Francisco', '2019-10-14'],
  ];
  const BRANCH_OF_CITY = { Seattle: 1, Tacoma: 1, Chicago: 2, Austin: 3, 'New York': 4, 'San Francisco': 5, Oakland: 5 };

  // ---- customers (80) -----------------------------------------------------------------------
  const NC = 80;
  const cNames = makeNames(rng, NC);
  const createdDays = Array.from({ length: NC }, () => rng.int(dnum('2010-01-01'), dnum('2024-10-31'))).sort((a, b) => a - b);
  const CITY_LIST = ['Seattle', 'Chicago', 'Austin', 'New York', 'San Francisco', 'Tacoma', 'Oakland'];
  const CITY_W = [20, 18, 14, 18, 14, 3, 3];
  // kyc: 9 pending (mostly recent), 6 rejected
  const recent = [...Array(NC).keys()].slice(-16);
  const pendingIdx = new Set(rng.sample(recent, 9));
  const rejectedIdx = new Set(rng.sample([...Array(NC - 16).keys()], 6));
  const noAccount = new Set([...rng.sample([...pendingIdx], 2), ...rng.sample([...rejectedIdx], 3)]);
  const customers = cNames.map((n, i) => {
    const created = dstr(createdDays[i]);
    const age = rng.int(18, 78);
    const dob = dstr(dnum(created) - age * 365 - rng.int(0, 364));
    return {
      id: i + 1,
      name: `${n.first} ${n.last}`,
      first: n.first,
      city: rng.weighted(CITY_LIST, CITY_W),
      dob,
      kyc: pendingIdx.has(i) ? 'pending' : rejectedIdx.has(i) ? 'rejected' : 'verified',
      created,
      noAccount: noAccount.has(i),
    };
  });
  const customerRows = customers.map((c) => [c.id, c.name, c.city, c.dob, c.kyc, c.created]);

  // ---- accounts (~125) -------------------------------------------------------------------------
  const accs = [];
  for (const c of customers) {
    if (c.noAccount) continue;
    const n = rng.weighted([1, 2, 3], [53, 35, 12]);
    let types;
    if (n === 1) types = [rng.weighted(['checking', 'savings', 'credit'], [86, 9, 5])];
    else if (n === 2) types = rng.weighted([['checking', 'savings'], ['checking', 'credit'], ['checking', 'checking']], [70, 25, 5]);
    else types = ['checking', 'savings', 'credit'];
    let opened = addDays(c.created, rng.int(0, 30));
    types.forEach((type, k) => {
      if (k > 0) opened = addDays(opened, rng.int(30, 900));
      const homeBranch = BRANCH_OF_CITY[c.city];
      const branch = rng.chance(0.8) ? homeBranch : rng.int(1, 5);
      const bOpened = branchRows[branch - 1][3];
      let od = opened > bOpened ? opened : addDays(bOpened, rng.int(1, 60));
      if (od > '2024-12-10') od = '2024-12-10';
      accs.push({ cust: c, type, opened: od < c.created ? c.created : od, branch });
    });
  }
  accs.sort((a, b) => (a.opened < b.opened ? -1 : a.opened > b.opened ? 1 : a.cust.id - b.cust.id));
  accs.forEach((a, i) => (a.id = i + 1));
  // statuses
  const closedPick = new Set(rng.sample(accs.filter((a) => a.cust.kyc !== 'rejected' && a.opened < '2024-02-01').map((a) => a.id), 8));
  const frozenPick = new Set(rng.sample(accs.filter((a) => a.cust.kyc !== 'rejected' && !closedPick.has(a.id) && a.opened < '2024-02-01').map((a) => a.id), 4));
  for (const a of accs) {
    if (a.cust.kyc === 'rejected') a.status = 'frozen';
    else if (closedPick.has(a.id)) a.status = 'closed';
    else if (frozenPick.has(a.id)) a.status = 'frozen';
    else a.status = 'active';
    a.limit = a.type === 'savings' ? 0 : a.type === 'credit' ? rng.pick([1000, 2500, 5000, 7500, 10000]) : rng.weighted([0, 250, 500, 1000], [55, 15, 20, 10]);
    a.until =
      a.status === 'closed' ? dstr(rng.int(dnum('2024-03-01'), dnum('2024-10-31'))) :
      a.status === 'frozen' ? dstr(rng.int(dnum('2024-05-01'), dnum('2024-11-15'))) : YEAR_END;
    if (a.until <= a.opened) a.until = addDays(a.opened, 20);
  }
  const accountRows = accs.map((a) => [a.id, a.cust.id, a.branch, a.type, a.opened, a.status, a.limit]);
  const accById = new Map(accs.map((a) => [a.id, a]));

  // ---- transaction simulation ---------------------------------------------------------------------
  const ev = new Map(accs.map((a) => [a.id, []])); // pending events per account
  const push = (a, e) => ev.get(a.id).push(e);
  const out = new Map(accs.map((a) => [a.id, []])); // final transactions per account
  const monthDays = (m) => lastDayOfMonth(2024, m);
  const mm = (m) => String(m).padStart(2, '0');

  function monthWindow(a, m) {
    const first = `2024-${mm(m)}-01`;
    const last = monthDays(m);
    const lo = a.opened > first ? a.opened : first;
    const hi = a.until < last ? a.until : last;
    if (lo > hi) return null;
    return { lo, hi, frac: (daysBetween(lo, hi) + 1) / (daysBetween(first, last) + 1) };
  }
  const randDay = (w) => addDays(w.lo, rng.int(0, daysBetween(w.lo, w.hi)));
  const inWin = (a, d) => d >= a.opened && d <= a.until && d >= YEAR_START && d <= YEAR_END;

  const personas = new Map();
  for (const a of accs) {
    const persona = rng.weighted([0.3, 0.9, 2.4], [45, 38, 17]);
    const hasSalary = a.type === 'checking' && rng.chance(0.58);
    personas.set(a.id, {
      rate: a.type === 'credit' ? persona * 1.6 + 0.4 : persona,
      hasSalary,
      salary: hasSalary ? Math.round(rng.logNormal(Math.log(3300), 0.38) / 5) * 5 : 0,
      employer: rng.pick(EMPLOYERS),
      payday: rng.pick([1, 15, 'last', 25, 28, 5, 15]),
      rent: a.type === 'checking' && rng.chance(0.42) ? Math.round(rng.float(700, 2400) / 5) * 5 : 0,
      landlord: rng.pick(LANDLORDS),
      rentDay: rng.int(1, 5),
      utilities: a.type === 'checking' && rng.chance(0.35),
      utilMerchants: rng.sample(MERCHANTS.utilities, rng.chance(0.3) ? 2 : 1),
      atm: a.type === 'checking' ? rng.float(0.1, 0.7) : 0,
      maint: a.type === 'checking' && rng.chance(0.12),
      saveAmt: Math.round(rng.float(100, 800) / 25) * 25,
      doesSave: rng.chance(0.55),
      wealthy: a.type === 'checking' && a.opened < YEAR_START && rng.chance(0.12),
      rateApy: rng.pick([0.45, 1.5, 2.5, 3.5, 4.1]),
      payStyle: rng.weighted(['full', 'partial', 'min'], [62, 28, 10]),
    });
  }

  // helper to schedule one card payment
  function cardEvent(a, date, cat, amount) {
    const merchant = rng.pick(MERCHANTS[cat]);
    const [h0, h1] = CARD_HOURS[cat];
    return {
      t: tsec(date, rng.int(h0, h1), rng.int(0, 59), rng.int(0, 59)),
      amount: -(amount === undefined ? cardAmount(rng, cat) : amount),
      type: 'card_payment',
      merchant,
      category: cat,
      desc: `Card purchase - ${merchant}`,
    };
  }

  for (const a of accs) {
    const p = personas.get(a.id);
    const preYear = a.opened < YEAR_START;
    const start = preYear ? YEAR_START : a.opened;

    // opening balance
    if (a.type !== 'credit') {
      let amt;
      if (a.type === 'savings') amt = preYear ? Math.round(rng.logNormal(Math.log(7000), 0.9) / 50) * 50 : Math.round(rng.float(500, 8000) / 50) * 50;
      else if (p.wealthy) amt = Math.round(rng.float(10000, 30000) / 50) * 50;
      else if (p.hasSalary) amt = Math.round(rng.float(300, 4000) / 25) * 25;
      else amt = Math.round(rng.float(1500, 14000) / 25) * 25;
      amt = clamp(amt, 250, 60000);
      push(a, {
        t: preYear ? tsec(YEAR_START, 0, 0, 0) : tsec(start, rng.int(9, 16), rng.int(0, 59), rng.int(0, 59)),
        amount: amt,
        type: 'deposit',
        desc: preYear ? 'Balance brought forward' : 'Opening deposit',
        order: -1,
      });
    }

    for (let m = 1; m <= 12; m++) {
      const w = monthWindow(a, m);
      if (!w) continue;
      const dayOf = (d) => (d === 'last' ? monthDays(m) : `2024-${mm(m)}-${mm(Math.min(d, +monthDays(m).slice(8)))}`);

      if (a.type === 'checking') {
        // salary
        if (p.hasSalary) {
          const d = dayOf(p.payday);
          if (inWin(a, d) && d > a.opened) {
            push(a, { t: tsec(d, rng.int(5, 9), rng.int(0, 59), rng.int(0, 59)), amount: p.salary, type: 'deposit', desc: `Salary - ${p.employer}` });
          }
          if (m === 12 && rng.chance(0.15)) {
            const d2 = '2024-12-20';
            if (inWin(a, d2)) push(a, { t: tsec(d2, 9, rng.int(0, 59), 0), amount: Math.round((p.salary * rng.float(0.4, 1)) / 5) * 5, type: 'deposit', desc: `Year-end bonus - ${p.employer}` });
          }
        }
        if (m === 3 && rng.chance(0.1)) {
          const d = randDay(w);
          push(a, { t: tsec(d, rng.int(8, 17), rng.int(0, 59), 0), amount: Math.round(rng.float(400, 2400)), type: 'deposit', desc: 'Tax refund' });
        }
        // rent
        if (p.rent) {
          const d = dayOf(p.rentDay);
          if (inWin(a, d) && d > a.opened) push(a, { t: tsec(d, rng.int(8, 10), rng.int(0, 59), 0), amount: -p.rent, type: 'transfer_out', desc: `Rent payment - ${p.landlord}` });
        }
        // utilities (card)
        if (p.utilities) {
          p.utilMerchants.forEach((mer, k) => {
            const d = dayOf(8 + k * 9);
            if (inWin(a, d) && d > a.opened) {
              push(a, { t: tsec(d, rng.int(6, 10), rng.int(0, 59), rng.int(0, 59)), amount: -cardAmount(rng, 'utilities'), type: 'card_payment', merchant: mer, category: 'utilities', desc: `Card purchase - ${mer}` });
            }
          });
        }
        // ATM
        for (let k = rng.poisson(p.atm * w.frac); k > 0; k--) {
          const d = randDay(w);
          const t = tsec(d, rng.int(9, 20), rng.int(0, 59), rng.int(0, 59));
          const place = rng.pick(ATM_PLACES);
          push(a, { t, amount: -rng.pick([20, 40, 60, 80, 100, 100, 200]), type: 'withdrawal', desc: `ATM withdrawal - ${place}` });
          if (rng.chance(0.06)) push(a, { t: t + 5, amount: -2.5, type: 'fee', desc: 'ATM fee (out-of-network)' });
        }
        // maintenance fee
        if (p.maint && inWin(a, `2024-${mm(m)}-01`)) push(a, { t: tsec(`2024-${mm(m)}-01`, 0, 15, 0), amount: -5, type: 'fee', desc: 'Monthly maintenance fee' });
        // occasional deposits / person-to-person
        for (let k = rng.poisson(0.15 * w.frac); k > 0; k--) {
          const d = randDay(w);
          const check = rng.chance(0.4);
          push(a, { t: tsec(d, rng.int(9, 17), rng.int(0, 59), 0), amount: Math.round(rng.float(100, 1500) / 5) * 5, type: 'deposit', desc: check ? 'Check deposit' : 'Cash deposit at branch' });
        }
        for (let k = rng.poisson(0.12 * w.frac); k > 0; k--) {
          const d = randDay(w);
          const nm = rng.pick(cNames).first;
          push(a, { t: tsec(d, rng.int(8, 22), rng.int(0, 59), rng.int(0, 59)), amount: -Math.round(rng.float(10, 150)), type: 'transfer_out', desc: `Transfer to ${nm}` });
        }
        for (let k = rng.poisson(0.08 * w.frac); k > 0; k--) {
          const d = randDay(w);
          const nm = rng.pick(cNames).first;
          push(a, { t: tsec(d, rng.int(8, 22), rng.int(0, 59), rng.int(0, 59)), amount: Math.round(rng.float(10, 200)), type: 'transfer_in', desc: `Transfer from ${nm}` });
        }
        // transfers to the customer's savings account (paired)
        const sav = accs.find((x) => x.cust.id === a.cust.id && x.type === 'savings');
        if (sav && p.doesSave) {
          const d = `2024-${mm(m)}-${mm(rng.int(3, 27))}`;
          if (inWin(a, d) && inWin(sav, d) && d > a.opened && d > sav.opened) {
            push(a, { t: tsec(d, rng.int(7, 21), rng.int(0, 59), rng.int(0, 59)), amount: -p.saveAmt, type: 'transfer_out', desc: 'Transfer to savings', pairTo: sav });
          }
        }
      }

      if (a.type === 'checking' || a.type === 'credit') {
        const mult = MONTH_SPEND[m - 1];
        for (let k = rng.poisson(p.rate * mult * w.frac); k > 0; k--) {
          const cat = rng.weighted(Object.keys(CARD_CATEGORY_W), Object.values(CARD_CATEGORY_W));
          push(a, cardEvent(a, randDay(w), cat));
        }
      }

      if (a.type === 'savings') {
        for (let k = rng.poisson(0.35 * w.frac); k > 0; k--) {
          const d = randDay(w);
          const kind = rng.weighted(['Cash deposit at branch', 'Check deposit', 'Transfer from another bank'], [4, 3, 3]);
          push(a, { t: tsec(d, rng.int(9, 17), rng.int(0, 59), 0), amount: Math.round(rng.float(100, 3000) / 10) * 10, type: kind.startsWith('Transfer') ? 'transfer_in' : 'deposit', desc: kind });
        }
        for (let k = rng.poisson(0.1 * w.frac); k > 0; k--) {
          const d = randDay(w);
          push(a, { t: tsec(d, rng.int(9, 17), rng.int(0, 59), 0), amount: -Math.round(rng.float(200, 2500) / 10) * 10, type: 'withdrawal', desc: 'Withdrawal at branch' });
        }
        const last = monthDays(m);
        if (inWin(a, last) && last > a.opened) {
          push(a, { t: tsec(last, 23, 50, 0), type: 'interest', desc: 'Interest credited', order: 5, compute: (bal) => (bal > 0 ? r2((bal * p.rateApy) / 100 / 12) : null) });
        }
      }

      if (a.type === 'credit') {
        const state = { paid: false };
        const payDay = `2024-${mm(m)}-20`;
        if (inWin(a, payDay) && payDay > a.opened) {
          push(a, {
            t: tsec(payDay, 10, rng.int(0, 59), 0), type: 'transfer_in', desc: 'Payment received - thank you', order: 3,
            compute: (bal) => {
              if (bal >= -1) return null;
              const owed = -bal;
              let pay;
              if (p.payStyle === 'full') pay = owed;
              else if (p.payStyle === 'partial') pay = Math.max(25, r2(owed * 0.3));
              else pay = rng.chance(0.4) ? 25 : null;
              if (pay === null) return null;
              state.paid = true;
              return r2(Math.min(pay, owed));
            },
          });
          push(a, { t: tsec(`2024-${mm(m)}-21`, 0, 5, 0), type: 'fee', desc: 'Late payment fee', order: 4, compute: (bal) => (!state.paid && bal < -60 ? -25 : null) });
          push(a, { t: tsec(`2024-${mm(m)}-25`, 1, 0, 0), type: 'interest', desc: 'Interest charged', order: 6, compute: (bal) => (bal < -1 ? -r2((-bal * 0.1999) / 12) : null) });
        }
      }
    }

  }

  // run the simulation: checking first (it feeds savings via paired transfers), then the rest
  function simulate(a) {
    const events = ev.get(a.id);
    events.sort((x, y) => x.t - y.t || (x.order || 0) - (y.order || 0));
    let bal = 0;
    let lastFeeMonth = -1;
    const rows = out.get(a.id);
    for (const e of events) {
      let amt = e.compute ? e.compute(bal) : e.amount;
      if (amt === null || amt === undefined || amt === 0) continue;
      amt = r2(amt);
      if (amt < 0 && !e.force && !e.compute && bal + amt < -a.limit) continue; // declined: not enough funds
      bal = r2(bal + amt);
      rows.push({ t: e.t, amount: amt, type: e.type, merchant: e.merchant || null, category: e.category || null, desc: e.desc, acc: a.id });
      if (e.pairTo) push(e.pairTo, { t: e.t, amount: -amt, type: 'transfer_in', desc: 'Transfer from checking' });
      if (a.type === 'checking' && bal < 0) {
        const mk = +tdate(e.t).slice(5, 7);
        if (mk !== lastFeeMonth) {
          lastFeeMonth = mk;
          bal = r2(bal - 35);
          rows.push({ t: e.t + 120, amount: -35, type: 'fee', merchant: null, category: null, desc: 'Overdraft fee', acc: a.id });
        }
      }
    }
  }
  for (const a of accs.filter((x) => x.type === 'checking')) simulate(a);
  for (const a of accs.filter((x) => x.type !== 'checking')) simulate(a);

  // ---- planted suspicious patterns ---------------------------------------------------------------------
  const balanceSeries = (a) => {
    let b = 0;
    return out.get(a.id).map((r) => (b = r2(b + r.amount)));
  };
  const planted = { bursts: [], large: [] };
  // (1) bursts: 4-6 large debits within 10 minutes on three checking accounts
  const burstPlans = [
    { when: '2024-03-14', h: 2, kind: 'card', n: 5, cats: ['shopping'], merchants: ['Gadget Galaxy Online', 'Orion Electronics'], lo: 780, hi: 1650 },
    { when: '2024-07-27', h: 23, kind: 'atm', n: 4, lo: 900, hi: 1000 },
    { when: '2024-10-05', h: 3, kind: 'card', n: 6, cats: ['travel', 'entertainment'], merchants: ['SkyHop Airlines', 'Pixel Games Store', 'Concert Hall Tickets'], lo: 700, hi: 2300 },
  ];
  const burstUsed = new Set();
  for (const plan of burstPlans) {
    const total = (plan.lo + plan.hi) / 2 * plan.n;
    const t0 = tsec(plan.when, plan.h, rng.int(2, 40), rng.int(0, 59));
    const cands = accs.filter((a) => a.type === 'checking' && a.status === 'active' && a.opened < plan.when && !burstUsed.has(a.id) && a.cust.kyc !== 'pending');
    let best = null;
    for (const a of cands) {
      const rows = out.get(a.id);
      const series = balanceSeries(a);
      let before = 0;
      let minAfter = Infinity;
      rows.forEach((r, i) => {
        if (r.t <= t0) before = series[i];
        else minAfter = Math.min(minAfter, series[i]);
      });
      const head = Math.min(before, minAfter === Infinity ? before : minAfter) + a.limit;
      if (!best || head > best.head) best = { a, head };
    }
    if (!best || best.head < total * 1.2) throw new Error(`bank: no account can fund burst (best ${best && best.head}, need ${total})`);
    const a = best.a;
    burstUsed.add(a.id);
    let t = t0;
    let sumDebits = 0;
    const times = [];
    for (let i = 0; i < plan.n; i++) {
      const amount = Math.round(rng.float(plan.lo, plan.hi)) - 0.01 * rng.int(0, 1);
      let row;
      if (plan.kind === 'atm') {
        const atmAmount = Math.round(rng.float(plan.lo, plan.hi) / 20) * 20;
        row = { t, amount: -atmAmount, type: 'withdrawal', merchant: null, category: null, desc: `ATM withdrawal - ${ATM_PLACES[(i + 2) % ATM_PLACES.length]}`, acc: a.id, planted: true };
      } else {
        const cat = plan.cats[i % plan.cats.length];
        const mer = plan.merchants[i % plan.merchants.length];
        row = { t, amount: -amount, type: 'card_payment', merchant: mer, category: cat, desc: `Card purchase - ${mer}`, acc: a.id, planted: true };
      }
      sumDebits += -row.amount;
      out.get(a.id).push(row);
      times.push(tstr(t));
      t += rng.int(40, 130);
    }
    out.get(a.id).sort((x, y) => x.t - y.t);
    planted.bursts.push({ account: a.id, start: tstr(t0), n: plan.n, total: r2(sumDebits) });
  }

  // (2) unusually large single debits: more than 10x the account's average debit
  const largePlans = [
    { txn: 'card_payment', merchant: 'Meridian Fine Jewelers', category: 'shopping', after: '2024-10-21', before: '2024-12-15' },
    { txn: 'withdrawal', desc: 'Large cash withdrawal at branch', after: '2024-09-16', before: '2024-11-20' },
  ];
  for (const plan of largePlans) {
    let best = null;
    for (const a of accs.filter((x) => x.type === 'checking' && x.status === 'active' && x.opened < '2024-01-02' && !burstUsed.has(x.id))) {
      const rows = out.get(a.id);
      const debits = rows.filter((r) => r.amount < 0);
      if (debits.length < 14) continue;
      const D = sum(debits.map((r) => -r.amount));
      const nd = debits.length;
      const series = balanceSeries(a);
      const need = Math.max(1500, Math.ceil((11 * D) / (nd - 10) / 50) * 50);
      for (let k = 0; k < 6; k++) {
        const d = addDays(plan.after, rng.int(0, daysBetween(plan.after, plan.before)));
        const t = tsec(d, rng.int(10, 16), rng.int(0, 59), rng.int(0, 59));
        let minAfter = Infinity;
        let before = 0;
        rows.forEach((r, i) => {
          if (r.t <= t) before = series[i];
          else minAfter = Math.min(minAfter, series[i]);
        });
        const room = Math.min(before, minAfter) + a.limit - 25;
        if (room < need) continue;
        // prefer the account where the planted amount is the biggest multiple of its normal debit
        const score = need / (D / nd);
        if (!best || score > best.score) best = { a, t, amount: need + 50 * rng.int(0, 6), score, room };
      }
    }
    if (!best) throw new Error('bank: no account suitable for a large amount');
    const a = best.a;
    const amount = Math.min(best.amount, Math.floor(best.room / 50) * 50);
    out.get(a.id).push({
      t: best.t, amount: -amount, type: plan.txn, merchant: plan.merchant || null, category: plan.category || null,
      desc: plan.merchant ? `Card purchase - ${plan.merchant}` : plan.desc, acc: a.id, planted: true,
    });
    out.get(a.id).sort((x, y) => x.t - y.t);
    burstUsed.add(a.id);
    planted.large.push({ account: a.id, time: tstr(best.t), amount });
  }

  // keep ordinary spending ordinary: no unplanted card payment / ATM withdrawal may be more than
  // 7x the account's average debit, so the planted anomalies are the only outliers
  for (const a of accs) {
    const rows = out.get(a.id);
    const base = rows.filter((r) => r.amount < 0 && !r.planted);
    if (base.length < 3) continue;
    const avg = sum(base.map((r) => -r.amount)) / base.length;
    for (const r of base) {
      if ((r.type === 'card_payment' || r.type === 'withdrawal') && -r.amount > 7 * avg) {
        r.amount = -r2(avg * rng.float(2.5, 4.5));
      }
    }
  }

  // ---- final transaction table ------------------------------------------------------------------------------------
  const allTx = [];
  for (const a of accs) for (const r of out.get(a.id)) allTx.push(r);
  allTx.sort((x, y) => x.t - y.t || x.acc - y.acc);
  const txnRows = allTx.map((r, i) => [i + 1, r.acc, tstr(r.t), r.amount, r.type, r.merchant, r.category, r.desc]);

  // ---- loans (40) ------------------------------------------------------------------------------------------------------
  const LOAN_KINDS = [
    { w: 8, p: [150000, 480000], terms: [240, 300, 360], rate: [3.0, 6.9] },
    { w: 10, p: [8000, 42000], terms: [36, 48, 60, 72], rate: [4.5, 9.5] },
    { w: 14, p: [1500, 30000], terms: [12, 24, 36, 48, 60], rate: [7.0, 19.99] },
    { w: 4, p: [8000, 60000], terms: [120, 180], rate: [3.5, 7.5] },
    { w: 4, p: [25000, 250000], terms: [60, 84, 120], rate: [5.0, 11.0] },
  ];
  const verified = customers.filter((c) => c.kyc === 'verified' && !c.noAccount);
  const cw = verified.map(() => rng.logNormal(0, 0.7));
  const loanDraft = [];
  for (let i = 0; i < 40; i++) {
    const kind = rng.weighted(LOAN_KINDS, LOAN_KINDS.map((k) => k.w));
    const cust = rng.weighted(verified, cw);
    const startMax = dnum('2024-11-15');
    const startMin = Math.max(dnum('2015-01-01'), dnum(cust.created));
    const start = dstr(rng.int(startMin, startMax));
    const principal = Math.round(rng.logNormal(Math.log(Math.sqrt(kind.p[0] * kind.p[1])), 0.35) / 50) * 50;
    loanDraft.push({
      cust,
      principal: clamp(principal, kind.p[0], kind.p[1]),
      rate: r2(rng.float(kind.rate[0], kind.rate[1])),
      start,
      term: rng.pick(kind.terms),
      kindW: kind.w,
    });
  }
  loanDraft.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.cust.id - y.cust.id));
  // statuses: 5 defaulted (risky ones), paid_off where the term has ended, rest active
  const endOf = (l) => {
    const d = new Date(dnum(l.start) * 86400000);
    d.setUTCMonth(d.getUTCMonth() + l.term);
    return d.toISOString().slice(0, 10);
  };
  const defaultCands = loanDraft.filter((l) => l.rate > 9 && daysBetween(l.start, YEAR_END) > 400);
  const defaulted = new Set(rng.sample(defaultCands, Math.min(5, defaultCands.length)));
  const loanRows = loanDraft.map((l, i) => {
    let status;
    if (defaulted.has(l)) status = 'defaulted';
    else if (endOf(l) <= YEAR_END) status = 'paid_off';
    else status = rng.chance(0.12) && daysBetween(l.start, YEAR_END) > 700 ? 'paid_off' : 'active';
    return [i + 1, l.cust.id, l.principal, l.rate, l.start, l.term, status];
  });

  const tables = [
    T('branches', 'Harbor Bank branch offices.', [
      ['branch_id', 'integer', 'PRIMARY KEY', 'Unique id of the branch'],
      ['name', 'text', 'NOT NULL', 'Branch name'],
      ['city', 'text', 'NOT NULL', 'City where the branch is located'],
      ['opened_on', 'date', 'NOT NULL', 'Day the branch opened'],
    ], branchRows),
    T('customers', 'People and households who bank with Harbor Bank.', [
      ['customer_id', 'integer', 'PRIMARY KEY', 'Unique id of the customer'],
      ['full_name', 'text', 'NOT NULL', 'Full name'],
      ['city', 'text', 'NOT NULL', 'City where the customer lives'],
      ['date_of_birth', 'date', 'NOT NULL', 'Date of birth'],
      ['kyc_status', 'text', 'NOT NULL', 'Identity check status: verified, pending or rejected'],
      ['created_at', 'date', 'NOT NULL', 'Day the customer record was created'],
    ], customerRows),
    T('accounts', 'Bank accounts (checking, savings and credit card accounts). One customer can have several.', [
      ['account_id', 'integer', 'PRIMARY KEY', 'Unique id of the account'],
      ['customer_id', 'integer', 'NOT NULL REFERENCES customers (customer_id)', 'Customer who owns the account'],
      ['branch_id', 'integer', 'NOT NULL REFERENCES branches (branch_id)', 'Branch that manages the account'],
      ['account_type', 'text', 'NOT NULL', 'checking, savings or credit'],
      ['opened_on', 'date', 'NOT NULL', 'Day the account was opened'],
      ['status', 'text', 'NOT NULL', 'active, frozen or closed'],
      ['overdraft_limit', 'numeric(10,2)', 'NOT NULL DEFAULT 0', 'How far below zero the balance may go (the credit limit for credit accounts)'],
    ], accountRows),
    T('transactions', 'Every movement of money in 2024: positive amounts are money in, negative amounts are money out.', [
      ['txn_id', 'integer', 'PRIMARY KEY', 'Unique id of the transaction (ids are in time order)'],
      ['account_id', 'integer', 'NOT NULL REFERENCES accounts (account_id)', 'Account the transaction belongs to'],
      ['txn_time', 'timestamp', 'NOT NULL', 'Date and time of the transaction'],
      ['amount', 'numeric(12,2)', 'NOT NULL', 'Amount in dollars: positive = money in, negative = money out'],
      ['txn_type', 'text', 'NOT NULL', 'deposit, withdrawal, transfer_in, transfer_out, card_payment, fee or interest'],
      ['merchant', 'text', '', 'Shop or company paid (only for card payments)'],
      ['category', 'text', '', 'Spending category (only for card payments)'],
      ['description', 'text', 'NOT NULL', 'Short text shown on the statement'],
    ], txnRows),
    T('loans', 'Loans granted to customers.', [
      ['loan_id', 'integer', 'PRIMARY KEY', 'Unique id of the loan'],
      ['customer_id', 'integer', 'NOT NULL REFERENCES customers (customer_id)', 'Customer who borrowed the money'],
      ['principal', 'numeric(12,2)', 'NOT NULL', 'Amount borrowed in dollars'],
      ['annual_rate', 'numeric(5,2)', 'NOT NULL', 'Yearly interest rate in percent (5.25 means 5.25%)'],
      ['start_date', 'date', 'NOT NULL', 'Day the loan was paid out'],
      ['term_months', 'integer', 'NOT NULL', 'Length of the loan in months'],
      ['status', 'text', 'NOT NULL', 'active, paid_off or defaulted'],
    ], loanRows),
  ];

  return {
    id: 'bank',
    name: 'Harbor Bank',
    icon: '🏦',
    tagline: 'Accounts, a year of transactions, loans and a few suspicious patterns.',
    description:
      'Harbor Bank has five branches, 80 customers, about 125 accounts and a full year of transactions: salaries, rent, card payments, fees and interest. ' +
      'Practice running balances, monthly summaries, GROUP BY with dates and window functions, then play detective: a few accounts show suspicious bursts of activity. ' +
      'Every amount is in US dollars and the data covers calendar year 2024.',
    tables,
    extra: { planted, accounts: accs.length },
  };
}

// ---- documentation: bank ----------------------------------------------------------------------
async function docBank(q, ds) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const one = async (sql) => (await q.rows(sql))[0];

  const kyc = await list('SELECT kyc_status || \' \' || count(*) AS v FROM customers GROUP BY kyc_status ORDER BY count(*) DESC');
  const noAcc = await list("SELECT c.customer_id || ' (' || c.kyc_status || ')' AS v FROM customers c WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.customer_id = c.customer_id) ORDER BY c.customer_id");
  const noAccN = await q.val('SELECT count(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.customer_id = c.customer_id)');
  const accPer = await list('SELECT n || \' account\' || (CASE WHEN n > 1 THEN \'s\' ELSE \'\' END) || \': \' || count(*) AS v FROM (SELECT customer_id, count(*) AS n FROM accounts GROUP BY customer_id) t GROUP BY n ORDER BY n');
  const accTypes = await list('SELECT account_type || \' \' || count(*) AS v FROM accounts GROUP BY account_type ORDER BY count(*) DESC');
  const accStatus = await list('SELECT status || \' \' || count(*) AS v FROM accounts GROUP BY status ORDER BY count(*) DESC');
  const odl = await list('SELECT account_type || \' \' || min(overdraft_limit) || \'-\' || max(overdraft_limit) AS v FROM accounts GROUP BY account_type ORDER BY account_type');
  const tx = await one('SELECT count(*) AS n, min(txn_time)::text AS lo, max(txn_time)::text AS hi, count(DISTINCT account_id) AS accts FROM transactions');
  const types = await list('SELECT txn_type || \' \' || count(*) AS v FROM transactions GROUP BY txn_type ORDER BY count(*) DESC, txn_type');
  const openers = await one("SELECT count(*) FILTER (WHERE description = 'Balance brought forward') AS bf, count(*) FILTER (WHERE description = 'Opening deposit') AS od FROM transactions");
  const salary = await one("SELECT count(*) AS n, count(DISTINCT account_id) AS accts FROM transactions WHERE description LIKE 'Salary - %'");
  const interest = await one("SELECT count(*) FILTER (WHERE amount > 0) AS pos, count(*) FILTER (WHERE amount < 0) AS neg FROM transactions WHERE txn_type = 'interest'");
  const interestCheck = await one("SELECT count(*) FILTER (WHERE a.account_type = 'savings' AND t.amount > 0) AS sav_pos, count(*) FILTER (WHERE a.account_type = 'credit' AND t.amount < 0) AS cred_neg, count(*) AS total FROM transactions t JOIN accounts a USING (account_id) WHERE t.txn_type = 'interest'");
  must(interestCheck.sav_pos + interestCheck.cred_neg === interestCheck.total, 'interest is positive on savings and negative on credit accounts');
  const fees = await list("SELECT description || ' ' || count(*) AS v FROM transactions WHERE txn_type = 'fee' GROUP BY description ORDER BY count(*) DESC, description");
  const cats = await list("SELECT category || ' ' || count(*) AS v FROM transactions WHERE txn_type = 'card_payment' GROUP BY category ORDER BY count(*) DESC");
  must((await q.val("SELECT count(*) FROM transactions WHERE (txn_type = 'card_payment') <> (merchant IS NOT NULL) OR (merchant IS NULL) <> (category IS NULL)")) === 0, 'merchant and category only on card payments');
  const pair = await one("SELECT (SELECT count(*) FROM transactions WHERE description = 'Transfer to savings') AS outs, (SELECT count(*) FROM transactions WHERE description = 'Transfer from checking') AS ins, (SELECT count(*) FROM transactions o JOIN transactions i ON i.txn_time = o.txn_time AND i.amount = -o.amount AND i.description = 'Transfer from checking' WHERE o.description = 'Transfer to savings') AS matched");
  must(pair.outs === pair.ins && pair.ins === pair.matched, 'savings transfers come in matching pairs');
  const payCredit = await one("SELECT count(*) AS n FROM transactions WHERE description = 'Payment received - thank you'");
  const lastTx = await list("SELECT a.status || ' accounts: last activity between ' || min(l)::date || ' and ' || max(l)::date AS v FROM (SELECT account_id, max(txn_time) AS l FROM transactions GROUP BY account_id) t JOIN accounts a USING (account_id) WHERE a.status <> 'active' GROUP BY a.status ORDER BY a.status");
  const endBal = await list("SELECT a.account_type || ' ' || count(*) FILTER (WHERE b < 0) || ' of ' || count(*) AS v FROM (SELECT account_id, sum(amount) AS b FROM transactions GROUP BY account_id) t JOIN accounts a USING (account_id) GROUP BY a.account_type ORDER BY a.account_type");
  const goesNeg = await one("WITH r AS (SELECT t.account_id, a.account_type, sum(t.amount) OVER (PARTITION BY t.account_id ORDER BY t.txn_time, t.txn_id) AS bal FROM transactions t JOIN accounts a USING (account_id)) SELECT count(DISTINCT account_id) FILTER (WHERE account_type = 'checking' AND bal < 0) AS checking FROM r");
  must((await q.val("SELECT count(*) FROM accounts a JOIN customers c USING (customer_id) WHERE c.kyc_status = 'rejected' AND a.status <> 'frozen'")) === 0, 'rejected customers only have frozen accounts');
  must((await q.val('SELECT count(*) FROM loans WHERE term_months >= 240 AND annual_rate > 6.9')) === 0, 'long loans have low rates');
  const terms = await one('SELECT min(term_months) AS lo, max(term_months) AS hi FROM loans');
  must((await q.val("WITH r AS (SELECT t.txn_type, t.amount, a.overdraft_limit, sum(t.amount) OVER (PARTITION BY t.account_id ORDER BY t.txn_time, t.txn_id) AS bal FROM transactions t JOIN accounts a USING (account_id)) SELECT count(*) FROM r WHERE bal < -overdraft_limit - 0.001 AND amount < 0 AND txn_type NOT IN ('fee', 'interest')")) === 0, 'only fees and interest can push a balance below the overdraft limit');
  must((await q.val("SELECT count(*) FROM (SELECT account_id, date_trunc('month', txn_time) FROM transactions WHERE description = 'Overdraft fee' GROUP BY 1, 2 HAVING count(*) > 1) t")) === 0, 'at most one overdraft fee per account and month');
  must((await q.val("SELECT count(*) FROM loans WHERE status = 'active' AND start_date + (term_months || ' months')::interval <= DATE '2024-12-31'")) === 0, 'active loans have not reached the end of their term');
  const planted = ds.extra.planted;
  const bursts = await q.rows("SELECT account_id, count(*) AS n, min(txn_time)::text AS first_txn, max(txn_time)::text AS last_txn, sum(-amount) AS total FROM transactions WHERE amount <= -500 AND txn_type IN ('card_payment', 'withdrawal') GROUP BY account_id, date_trunc('hour', txn_time) HAVING count(*) >= 4 ORDER BY account_id");
  must(bursts.length === 3, 'exactly three bursts');
  const burstText = bursts.map((b) => `account ${b.account_id}: ${b.n} debits totalling ${money(b.total)} between ${b.first_txn} and ${b.last_txn}`).join('; ');
  const large = await q.rows("SELECT txn_id, account_id, txn_time::text AS txn_time, amount::text AS amount, description, round(-amount / avg_debit, 1)::text AS times_average FROM (SELECT t.*, avg(-amount) OVER (PARTITION BY account_id) AS avg_debit FROM transactions t WHERE amount < 0) x WHERE -amount > 10 * avg_debit ORDER BY account_id");
  must(large.length === 2, 'exactly two debits above 10x the average debit');
  const largeText = large.map((l) => `txn ${l.txn_id} on account ${l.account_id} (${l.txn_time}): ${money(l.amount)} - ${l.description}, ${l.times_average} times the account's average debit`).join('; ');
  const ln = await one('SELECT count(*) AS n, round(sum(principal), 2)::text AS total, min(principal)::text AS lo, max(principal)::text AS hi, min(annual_rate)::text AS r1, max(annual_rate)::text AS r2, min(start_date)::text AS s1, max(start_date)::text AS s2 FROM loans');
  const loanStatus = await list('SELECT status || \' \' || count(*) AS v FROM loans GROUP BY status ORDER BY count(*) DESC');
  const early = await q.val("SELECT count(*) FROM loans WHERE status = 'paid_off' AND start_date + (term_months || ' months')::interval > DATE '2024-12-31'");
  const multi = await q.val('SELECT count(*) FROM (SELECT customer_id FROM loans GROUP BY customer_id HAVING count(*) > 1) t');
  const badLoan = await q.val("SELECT count(*) FROM loans l JOIN customers c USING (customer_id) WHERE c.kyc_status <> 'verified' OR c.created_at > l.start_date");
  must(badLoan === 0, 'loans only for verified customers who joined before the loan');
  const defaultedRate = await one("SELECT min(annual_rate)::text AS lo FROM loans WHERE status = 'defaulted'");
  const branchAcc = await list('SELECT b.city || \' \' || count(*) AS v FROM accounts a JOIN branches b USING (branch_id) GROUP BY b.branch_id, b.city ORDER BY b.branch_id');

  return {
    about:
      'Harbor Bank is a transaction-heavy dataset: every row of `transactions` is a movement of money in calendar year **2024**, which makes it ideal for running balances, month-by-month reports and spotting unusual behaviour. ' +
      '"As of" date: **2024-12-31 23:59**. Loans are dated back to 2015.',
    conventions: [
      `**Customers:** 80 people; KYC status: ${kyc}. Pending customers are mostly recent sign-ups. ${noAccN} customers have **no account** (customer_id ${noAcc}).`,
      `**Accounts** (${accTypes}; status: ${accStatus}): accounts per customer - ${accPer}. A customer's first account is a checking account in most cases and extra accounts are opened months or years later. Accounts per branch: ${branchAcc}. \`overdraft_limit\` ranges by type: ${odl}; for \`credit\` accounts it is the credit limit.`,
      `**Transactions:** ${commas(tx.n)} rows on ${tx.accts} accounts from ${tx.lo} to ${tx.hi}; types - ${types}. \`amount\` is signed: positive = money in, negative = money out. **Every account starts 2024 at zero**, so \`SUM(amount)\` over an account's rows is its balance at the end of 2024 and a running \`SUM(amount) OVER (PARTITION BY account_id ORDER BY txn_time, txn_id)\` is its balance at any moment.`,
      `**Opening balances.** Instead of a balance column, accounts that existed before 2024 get one row at 2024-01-01 00:00:00 with description \`Balance brought forward\` (${openers.bf} accounts, type \`deposit\`); accounts opened during 2024 get an \`Opening deposit\` (${openers.od} accounts). Credit accounts start at zero without such a row. These rows are legitimate deposits; filter on the description if you want to exclude them from "activity".`,
      `**Typical patterns.** ${salary.n} salary deposits (\`Salary - <employer>\`) on ${salary.accts} checking accounts, one per month on a fixed pay day; rent payments (\`transfer_out\`, \`Rent payment - <landlord>\`); card payments with a merchant and one of the categories ${cats}; ATM withdrawals; monthly interest on savings accounts (positive, on the last day of the month at 23:50) and **negative** interest on credit accounts that carry a balance (\`Interest charged\`, on the 25th); fees: ${fees}.`,
      `**Paired transfers.** ${pair.outs} \`Transfer to savings\` rows on checking accounts each have exactly one matching \`Transfer from checking\` row on the customer's savings account with the same timestamp and opposite amount.`,
      `**Credit accounts** hold card purchases (negative); on the 20th of each month the customer pays all, part or none of the amount owed (\`transfer_in\`, \`Payment received - thank you\`, ${payCredit.n} payments), a late fee is charged on the 21st if nothing was paid, and interest on the 25th. A negative balance on a credit account means money owed.`,
      `**Overdrafts.** Debits are never declined by the generator unless they would push the balance below \`-overdraft_limit\`, so balances never fall below that limit except through fees and credit-card interest (which are always charged). ${goesNeg.checking} checking accounts dip below zero at some point and get an \`Overdraft fee\` of 35.00 (at most once per month).`,
      `**Closed and frozen accounts** simply stop having transactions at some point (${lastTx}); there is no closing date column.`,
      `**Loans:** ${ln.n} loans starting ${ln.s1} to ${ln.s2}; principal ${money(ln.lo)} to ${money(ln.hi)}; \`annual_rate\` ${ln.r1} to ${ln.r2} (percent); terms from ${terms.lo} to ${terms.hi} months; status: ${loanStatus}. Rates follow the kind of loan: long loans (20-30 years, mortgage-sized) have the low rates (at most 6.9%), small personal loans the high ones. Only verified customers have loans, always after they became customers. ${multi} customers have more than one loan. There are no loan-payment rows.`,
    ],
    quirks: [
      `**Customers without accounts:** ${noAcc} - anti-join practice; the rejected ones are what you would expect for failed identity checks. Customers with a rejected KYC status who do have accounts only have \`frozen\` ones.`,
      `**Three suspicious bursts** (at least 4 debits of 500 or more within the same clock hour; each burst fits into about 10 minutes): ${burstText}. They happen at night, on accounts that had enough money to cover them.`,
      `**Two unusually large debits** (more than 10 times the account's average debit): ${largeText}.`,
      `**Loan status consistency:** ${early === 0 ? 'every' : 'most'} \`paid_off\` loan has run its full term by the end of 2024${early === 0 ? '' : ` (${early} were repaid early)`}; no \`active\` loan has reached the end of its term; defaulted loans all have rates of at least ${defaultedRate.lo}%.`,
      `**Year-end balances:** accounts with a negative balance on 2024-12-31 - ${endBal}. Negative checking balances are overdrafts; negative credit balances are debt.`,
      '`merchant` and `category` are NULL for every transaction that is not a `card_payment` (and set for every card payment).',
    ],
    facts: [
      await f('Accounts by type', 'SELECT account_type, count(*) FROM accounts GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Transactions by type (count)', 'SELECT txn_type, count(*) FROM transactions GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Total of all positive amounts / negative amounts', 'SELECT round(sum(amount) FILTER (WHERE amount > 0), 2) || \' / \' || round(sum(amount) FILTER (WHERE amount < 0), 2) FROM transactions'),
      await f('Salary deposits in total', "SELECT sum(amount) FROM transactions WHERE description LIKE 'Salary - %'", 'money'),
      await f('Month with the most transactions', "SELECT to_char(txn_time, 'YYYY-MM') || ' (' || count(*) || ' transactions)' FROM transactions GROUP BY to_char(txn_time, 'YYYY-MM') ORDER BY count(*) DESC LIMIT 1"),
      await f('Largest card payment (including the planted ones)', "SELECT -amount || ' at ' || merchant || ' (account ' || account_id || ')' FROM transactions WHERE txn_type = 'card_payment' ORDER BY amount LIMIT 1"),
      await f('Card spending per category (dollars)', "SELECT category, round(-sum(amount), 2) FROM transactions WHERE txn_type = 'card_payment' GROUP BY 1 ORDER BY 2 DESC", 'pairs'),
      await f('Average year-end balance per account type', 'SELECT a.account_type, round(avg(b), 2) FROM (SELECT account_id, sum(amount) AS b FROM transactions GROUP BY account_id) t JOIN accounts a ON a.account_id = t.account_id GROUP BY 1 ORDER BY 1', 'pairs'),
      await f('Interest credited to savings accounts in 2024', "SELECT sum(t.amount) FROM transactions t JOIN accounts a ON a.account_id = t.account_id WHERE t.txn_type = 'interest' AND a.account_type = 'savings'", 'money'),
      await f('Burst detector: 4 or more debits of 500+ within one clock hour', "SELECT account_id, count(*) AS debits, min(txn_time)::text AS first_txn, sum(-amount) AS total FROM transactions WHERE amount <= -500 AND txn_type IN ('card_payment', 'withdrawal') GROUP BY account_id, date_trunc('hour', txn_time) HAVING count(*) >= 4 ORDER BY account_id", 'table'),
      await f('Debits above 10 times the account\'s average debit', 'SELECT txn_id, account_id, amount, description FROM (SELECT t.*, avg(-amount) OVER (PARTITION BY account_id) AS avg_debit FROM transactions t WHERE amount < 0) x WHERE -amount > 10 * avg_debit ORDER BY account_id', 'table'),
      await f('Loans: count and total principal per status', 'SELECT status, count(*) || \' loans, \' || sum(principal) FROM loans GROUP BY 1 ORDER BY count(*) DESC', 'pairs'),
    ],
    topics: [
      'Running balance per account with a window `SUM`; balance on a given date; month-end balances; the account with the highest balance.',
      'Monthly and weekly summaries (`date_trunc`), credits vs debits with `FILTER`, savings of each customer across all of their accounts.',
      'Joins customers -> accounts -> transactions; customers without accounts or without transactions (LEFT JOIN).',
      'Fraud-style detection: bursts in a short time window (`LAG`, self join on time), outliers vs the account average, merchants and categories never used before.',
      'Loans: monthly payment formula, remaining principal, default analysis by rate, customers with both a loan and an overdraft.',
      'Data-quality reasoning: paired transfers, signed amounts, accounts that stop being active.',
    ],
  };
}

// =============================================================================
// 6. app - FitTrack fitness app analytics
// =============================================================================

function buildApp() {
  const rng = new Rng(6006);
  const SIGNUP_START = '2024-01-01';
  const SIGNUP_END = '2024-06-30';
  const EVENT_END = '2024-07-31';
  const END_TS = tsec(EVENT_END, 23, 59, 59);

  // ---- users (300) ------------------------------------------------------------------------
  const NU = 300;
  const signDays = dateRange(SIGNUP_START, SIGNUP_END);
  const WD_SIGN = [1.0, 1.15, 1.1, 1.0, 1.0, 0.9, 0.85]; // Sun..Sat
  const signW = signDays.map((d, i) => {
    let w = (1 + (0.5 * i) / 181) * WD_SIGN[dow(d)];
    if (d <= '2024-01-15') w *= 1.8; // New Year resolutions
    return w * rng.logNormal(0, 0.3);
  });
  const perDay = allocate(NU, signW);
  const signups = [];
  signDays.forEach((d, i) => {
    for (let k = 0; k < perDay[i]; k++) signups.push(d);
  });
  const COUNTRIES = ['United States', 'United Kingdom', 'India', 'Germany', 'Brazil', 'Canada', 'Australia', 'France', 'Japan', 'Mexico', 'Spain', 'Nigeria'];
  const COUNTRY_W = [34, 10, 10, 8, 8, 6, 5, 5, 4, 4, 3, 3];
  const REF_MOD = { friend: 1.3, organic: 1.0, social: 0.9, ads: 0.75 };
  const PLAT_MOD = { ios: 1.1, android: 1.0, web: 0.85 };
  const users = signups.map((signup, i) => {
    const platform = rng.weighted(['ios', 'android', 'web'], [44, 40, 16]);
    const ref = rng.weighted(['organic', 'ads', 'friend', 'social'], [40, 25, 20, 15]);
    return {
      id: i + 1,
      signup,
      country: rng.weighted(COUNTRIES, COUNTRY_W),
      platform,
      ref,
      birth: rng.chance(0.08) ? null : clamp(Math.round(rng.normal(1990, 9)), 1962, 2006),
      e: Math.min(rng.logNormal(0, 0.45), 3) * REF_MOD[ref] * PLAT_MOD[platform],
      lag: platform === 'web' ? 0 : rng.chance(0.08) ? 150 : rng.int(0, 35),
      types: rng.sample(['run', 'yoga', 'cycling', 'strength', 'swim'], rng.int(1, 2)),
      worker: rng.chance(0.66), // some people only browse and never start a workout
      finisher: rng.chance(0.8),
    };
  });
  const userRows = users.map((u) => [u.id, u.signup, u.country, u.platform, u.ref, u.birth]);
  // users who signed up but never opened the app afterwards (no events at all)
  const silent = new Set(rng.weightedSample(users.map((u) => u.id), users.map((u) => (u.ref === 'ads' ? 2.2 : 1) / (u.e + 0.3)), 20));

  // ---- sessions & events ---------------------------------------------------------------------
  const RELEASES = [['2024-01-01', '2.3.1'], ['2024-03-12', '2.4.0'], ['2024-06-04', '2.5.0']];
  const versionFor = (u, t) => {
    const cut = (() => {
      const d = tdate(t);
      const lagged = addDays(d, -u.lag);
      return lagged > u.signup ? lagged : u.signup;
    })();
    let v = RELEASES[0][1];
    for (const [from, ver] of RELEASES) if (from <= cut) v = ver;
    return v;
  };
  const KCAL = { run: 10.5, yoga: 4, cycling: 8.5, strength: 6, swim: 9 };
  const GOALS = ['lose_weight', 'build_muscle', 'stay_active'];
  const SCREENS = ['home', 'workouts', 'progress', 'profile', 'goals'];
  const SCREEN_W = [62, 14, 12, 5, 7];
  const HOUR_W = [1, 1, 1, 1, 1, 3, 9, 11, 7, 4, 4, 5, 8, 7, 4, 4, 6, 12, 15, 14, 9, 5, 3, 1];
  const SESSION_DOW = [0.9, 1.1, 1.0, 1.0, 1.0, 0.8, 0.7]; // Sun..Sat
  const SETTINGS = [
    ['notifications', ['on', 'off']],
    ['units', ['metric', 'imperial']],
    ['theme', ['dark', 'light']],
    ['privacy', ['public', 'friends', 'private']],
  ];
  const GAP = 3 * 3600 + 300; // minimum gap between sessions of one user
  const sessionsOf = new Map(); // user id -> [{events, t0, end}]

  for (const u of users) {
    if (silent.has(u.id)) continue;
    const starts = [];
    const signupTs = tsec(u.signup);
    for (let k = 0; ; k++) {
      const weekStart = addDays(u.signup, 7 * k);
      if (weekStart > EVENT_END) break;
      const pk = clamp(0.64 * Math.exp(-0.2 * k) * Math.pow(u.e, 0.9), 0, 0.97);
      if (k > 0 && !rng.chance(pk)) continue;
      const nS = k === 0 ? 1 + rng.poisson(1.7 * u.e) : 1 + rng.poisson(2.6 * u.e);
      for (let j = 0; j < nS; j++) {
        let day;
        if (k === 0 && j === 0) day = u.signup;
        else {
          let tries = 0;
          do day = addDays(weekStart, rng.int(0, 6));
          while (!rng.chance(SESSION_DOW[dow(day)]) && ++tries < 6);
        }
        if (day > EVENT_END) continue;
        starts.push(tsec(day, 0, 0, 0) + rng.weightedIndex(HOUR_W) * 3600 + rng.int(0, 3599));
      }
    }
    starts.sort((a, b) => a - b);
    const sessions = [];
    let prevEnd = -Infinity;
    let goalDone = false;
    for (const t0 of starts) {
      if (t0 < prevEnd + GAP || t0 < signupTs || t0 > END_TS) continue;
      const evs = [];
      let t = t0;
      const open = { t, name: 'app_open', props: { screen: rng.weighted(SCREENS, SCREEN_W), app_version: versionFor(u, t) } };
      evs.push(open);
      if (!goalDone && (sessions.length === 0 ? rng.chance(0.32) : rng.chance(0.04))) {
        goalDone = true;
        t += rng.int(40, 240);
        evs.push({ t, name: 'goal_set', props: { goal: rng.pick(GOALS), target_per_week: rng.pick([2, 3, 3, 4, 4, 5, 6]) } });
      } else if (goalDone && rng.chance(0.02)) {
        t += rng.int(40, 240);
        evs.push({ t, name: 'goal_set', props: { goal: rng.pick(GOALS), target_per_week: rng.pick([2, 3, 4, 5]) } });
      }
      if (rng.chance(0.04)) {
        const [setting, vals] = rng.pick(SETTINGS);
        t += rng.int(10, 90);
        evs.push({ t, name: 'settings_changed', props: { setting, value: rng.pick(vals) } });
      }
      const pW = u.worker ? clamp(0.2 + 0.25 * u.e, 0.1, 0.75) : 0.004;
      if (rng.chance(pW)) {
        const nW = rng.chance(0.1) ? 2 : 1;
        for (let w = 0; w < nW; w++) {
          const type = rng.pick(u.types);
          const dur = rng.int(10, 28);
          t += rng.int(30, 300);
          const estKcal = Math.round(dur * KCAL[type]);
          evs.push({ t, name: 'workout_started', props: { workout_type: type, duration_min: dur, calories: estKcal } });
          if (rng.chance(u.finisher ? 0.8 : 0.05)) {
            t += dur * 60 + rng.int(0, 50);
            evs.push({ t, name: 'workout_completed', props: { workout_type: type, duration_min: dur, calories: Math.round(dur * KCAL[type] * rng.float(0.85, 1.15)) } });
            if (rng.chance(0.09)) {
              t += rng.int(20, 90);
              evs.push({ t, name: 'share', props: { channel: rng.weighted(['social', 'message', 'link'], [50, 30, 20]) } });
            }
          }
        }
      }
      if (evs[evs.length - 1].t > END_TS) continue;
      sessions.push({ events: evs, t0, end: evs[evs.length - 1].t });
      prevEnd = sessions[sessions.length - 1].end;
    }
    sessionsOf.set(u.id, sessions);
  }

  // ---- subscriptions (about 35% of users, plus a few re-subscribers) -----------------------------------
  const eligible = users.filter((u) => (sessionsOf.get(u.id) || []).length > 0);
  const subscribers = rng.weightedSample(eligible, eligible.map((u) => (Math.pow(u.e, 1.2) + 0.05) * (u.worker ? 1.5 : 0.7)), 102);
  const subs = [];
  const addSub = (u, sessionIdx, plan) => {
    const sess = sessionsOf.get(u.id)[sessionIdx];
    const t = sess.end + rng.int(30, 240);
    if (t > END_TS) return null;
    const price = plan === 'annual' ? 79.99 : 9.99;
    sess.events.push({ t, name: 'subscription_started', props: { plan, price } });
    sess.end = t;
    const s = { user: u, plan, price, started: tdate(t), cancelled: null, t };
    subs.push(s);
    return s;
  };
  for (const u of subscribers) {
    const n = sessionsOf.get(u.id).length;
    const idx = Math.min(n - 1, rng.weightedIndex([1, 0.4, 0.16, 0.06, 0.03, 0.01, 0.01, 0.01].slice(0, Math.max(n, 1))));
    const plan = rng.chance(0.25) ? 'annual' : 'monthly';
    const s = addSub(u, idx, plan);
    if (!s) continue;
    if (plan === 'monthly' && rng.chance(0.45)) {
      const months = 1 + Math.min(5, Math.floor(-Math.log(1 - rng.next()) / 0.55));
      const c = addDays(s.started, 30 * months + rng.int(0, 6));
      if (c <= EVENT_END) s.cancelled = c;
    } else if (plan === 'annual' && rng.chance(0.08)) {
      const c = addDays(s.started, rng.int(14, 120));
      if (c <= EVENT_END) s.cancelled = c;
    }
  }
  // 3 users cancel and later come back
  const comeback = subs.filter((s) => s.cancelled).filter((s) => sessionsOf.get(s.user.id).some((x) => tdate(x.t0) >= addDays(s.cancelled, 3)));
  for (const s of rng.sample(comeback, Math.min(3, comeback.length))) {
    const sess = sessionsOf.get(s.user.id);
    const idx = sess.findIndex((x) => tdate(x.t0) >= addDays(s.cancelled, 3));
    const s2 = addSub(s.user, idx, rng.chance(0.7) ? 'monthly' : 'annual');
    if (s2 && s2.plan === 'monthly' && rng.chance(0.3)) {
      const c = addDays(s2.started, 30 * rng.int(1, 3) + rng.int(0, 6));
      if (c <= EVENT_END) s2.cancelled = c;
    }
  }
  subs.sort((a, b) => a.t - b.t || a.user.id - b.user.id);
  const subRows = subs.map((s, i) => [i + 1, s.user.id, s.plan, s.price, s.started, s.cancelled]);

  // ---- events table -----------------------------------------------------------------------------------------
  const all = [];
  for (const u of users) for (const sess of sessionsOf.get(u.id) || []) for (const e of sess.events) all.push({ ...e, u: u.id });
  all.sort((a, b) => a.t - b.t || a.u - b.u);
  const eventRows = all.map((e, i) => [i + 1, e.u, tstr(e.t), e.name, e.props]);

  // ---- daily_steps (40 users, 2024-03-01 .. 2024-05-31) ---------------------------------------------------------
  const STEP_START = '2024-03-01';
  const STEP_END = '2024-05-31';
  const stepPool = users.filter((u) => u.signup <= '2024-03-20' && !silent.has(u.id));
  const stepUsers = rng.weightedSample(stepPool, stepPool.map((u) => u.e + 0.2), 40).sort((a, b) => a.id - b.id);
  const kinds = rng.shuffle(['steady', ...Array(7).fill('steady'), ...Array(24).fill('typical'), ...Array(8).fill('sporadic')]);
  const early = stepUsers.map((u, i) => i).filter((i) => stepUsers[i].signup <= STEP_START);
  kinds[rng.pick(early)] = 'perfect';
  const RUNS = { steady: [35, 1.5], typical: [15, 2.0], sporadic: [5, 3] };
  const stepRows = [];
  stepUsers.forEach((u, idx) => {
    const kind = kinds[idx];
    const first = u.signup > STEP_START ? u.signup : STEP_START;
    const days = dateRange(first, STEP_END);
    const base = rng.int(3500, 10500);
    let present = true;
    let left = kind === 'perfect' ? days.length : 1 + Math.floor(-Math.log(1 - rng.next()) * (kind === 'steady' ? RUNS.steady[0] : RUNS[kind][0]));
    for (const d of days) {
      if (present) {
        const wk = dow(d);
        const factor = wk === 0 || wk === 6 ? 0.88 : 1.05;
        let steps = Math.round(base * factor * rng.logNormal(0, 0.28));
        if (rng.chance(0.04)) steps = Math.round(steps * rng.float(1.6, 2.2));
        stepRows.push([u.id, d, clamp(steps, 900, 25000)]);
      }
      left--;
      if (left <= 0 && kind !== 'perfect') {
        present = !present;
        const [pm, am] = RUNS[kind];
        left = present ? 1 + Math.floor(-Math.log(1 - rng.next()) * pm) : 1 + Math.floor(-Math.log(1 - rng.next()) * (am - 0.5));
      }
    }
  });

  const tables = [
    T('users', 'People who installed FitTrack in the first half of 2024.', [
      ['user_id', 'integer', 'PRIMARY KEY', 'Unique id of the user'],
      ['signup_date', 'date', 'NOT NULL', 'Day the user created an account'],
      ['country', 'text', 'NOT NULL', 'Country of the user'],
      ['platform', 'text', 'NOT NULL', 'Device platform: ios, android or web'],
      ['referral_source', 'text', 'NOT NULL', 'How the user found the app: organic, ads, friend or social'],
      ['birth_year', 'integer', '', 'Year of birth (empty when the user did not say)'],
    ], userRows),
    T('events', 'The raw event log of the app: one row per tap that FitTrack recorded.', [
      ['event_id', 'bigint', 'PRIMARY KEY', 'Unique id of the event (ids are in time order)'],
      ['user_id', 'integer', 'NOT NULL REFERENCES users (user_id)', 'User who triggered the event'],
      ['event_time', 'timestamp', 'NOT NULL', 'Date and time of the event'],
      ['event_name', 'text', 'NOT NULL', 'app_open, workout_started, workout_completed, goal_set, subscription_started, share or settings_changed'],
      ['properties', 'jsonb', "NOT NULL DEFAULT '{}'", 'Extra details about the event, stored as JSON (the keys depend on event_name)'],
    ], eventRows),
    T('subscriptions', 'Paid subscriptions bought by users (a user can subscribe again after cancelling).', [
      ['subscription_id', 'integer', 'PRIMARY KEY', 'Unique id of the subscription'],
      ['user_id', 'integer', 'NOT NULL REFERENCES users (user_id)', 'User who subscribed'],
      ['plan', 'text', 'NOT NULL', 'monthly or annual'],
      ['price', 'numeric(6,2)', 'NOT NULL', 'Price paid per billing period in dollars'],
      ['started_at', 'date', 'NOT NULL', 'Day the subscription started'],
      ['cancelled_at', 'date', '', 'Day the subscription was cancelled (empty while still active)'],
    ], subRows),
    T('daily_steps', 'Daily step counts for a group of 40 users who connected their step tracker (March to May 2024). Days without a row mean the tracker sent nothing.', [
      ['user_id', 'integer', 'NOT NULL REFERENCES users (user_id)', 'User who walked'],
      ['day', 'date', 'NOT NULL', 'The calendar day'],
      ['steps', 'integer', 'NOT NULL', 'Number of steps recorded that day'],
    ], stepRows, { constraints: ['PRIMARY KEY (user_id, day)'] }),
  ];

  return {
    id: 'app',
    name: 'FitTrack',
    icon: '🏃',
    tagline: 'Product analytics for a fitness app: events, funnels, retention and streaks.',
    description:
      'FitTrack is a fitness app with 300 users, about 7,000 tracked events, subscriptions and a table of daily step counts. ' +
      'It is built for product analytics: funnels, weekly retention by signup cohort, sessionization, streaks (gaps and islands) and reading JSON properties. ' +
      'Events come in bursts (sessions) separated by hours or days of silence.',
    tables,
    extra: { silent: [...silent], stepUsers: stepUsers.map((u) => u.id), kinds },
  };
}

// ---- documentation: app -----------------------------------------------------------------------
async function docApp(q, ds) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const one = async (sql) => (await q.rows(sql))[0];

  const u = await one('SELECT count(*) AS n, min(signup_date)::text AS lo, max(signup_date)::text AS hi, count(*) FILTER (WHERE birth_year IS NULL) AS nobirth, min(birth_year) AS b1, max(birth_year) AS b2 FROM users');
  const plat = await list('SELECT platform || \' \' || count(*) AS v FROM users GROUP BY platform ORDER BY count(*) DESC');
  const refs = await list('SELECT referral_source || \' \' || count(*) AS v FROM users GROUP BY referral_source ORDER BY count(*) DESC');
  const ctry = await list('SELECT country || \' \' || count(*) AS v FROM users GROUP BY country ORDER BY count(*) DESC, country LIMIT 5');
  const ev = await one('SELECT count(*) AS n, min(event_time)::text AS lo, max(event_time)::text AS hi, count(DISTINCT user_id) AS users FROM events');
  must((await q.val('SELECT count(*) FROM events e JOIN users u USING (user_id) WHERE e.event_time::date < u.signup_date')) === 0, 'no event before signup');
  const silent = await one('SELECT count(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.user_id)');
  const names = await list('SELECT event_name || \' \' || count(*) || \' (\' || count(DISTINCT user_id) || \' users)\' AS v FROM events GROUP BY event_name ORDER BY count(*) DESC');
  const funnel = await one("SELECT count(DISTINCT user_id) FILTER (WHERE event_name = 'app_open') AS opened, count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_started') AS started, count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_completed') AS completed, count(DISTINCT user_id) FILTER (WHERE event_name = 'subscription_started') AS subscribed FROM events");
  const firstEv = await q.val("SELECT count(*) FROM (SELECT DISTINCT ON (user_id) user_id, event_name, event_time FROM events ORDER BY user_id, event_time, event_id) t JOIN users u USING (user_id) WHERE t.event_name = 'app_open' AND t.event_time::date = u.signup_date");
  const firstTotal = await q.val('SELECT count(DISTINCT user_id) FROM events');
  must(firstEv === firstTotal, 'every active user starts with an app_open on the signup day');
  const keys = await list("SELECT event_name || ': ' || string_agg(DISTINCT k, ', ' ORDER BY k) AS v FROM (SELECT event_name, jsonb_object_keys(properties) AS k FROM events) t GROUP BY event_name ORDER BY event_name");
  const vals = async (en, key) => list(`SELECT v FROM (SELECT properties->>'${key}' AS v, count(*) AS n FROM events WHERE event_name = '${en}' GROUP BY 1) t ORDER BY n DESC, v`);
  const ranges = await one("SELECT min((properties->>'duration_min')::int) AS d1, max((properties->>'duration_min')::int) AS d2 FROM events WHERE event_name IN ('workout_started', 'workout_completed')");
  const gaps = await one("WITH g AS (SELECT event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap FROM events) SELECT to_char(max(gap) FILTER (WHERE gap <= interval '30 minutes'), 'HH24:MI:SS') AS within, to_char(min(gap) FILTER (WHERE gap > interval '30 minutes'), 'HH24:MI:SS') AS between FROM g");
  const sess = await one("WITH g AS (SELECT user_id, event_name, event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap FROM events) SELECT count(*) FILTER (WHERE gap IS NULL OR gap > interval '30 minutes') AS sessions, count(*) FILTER (WHERE event_name = 'app_open') AS opens, count(*) FILTER (WHERE (gap IS NULL OR gap > interval '30 minutes') AND event_name = 'app_open') AS opens_at_start FROM g");
  must(sess.sessions === sess.opens && sess.opens_at_start === sess.opens, 'each session starts with exactly one app_open');
  const perSession = await one("WITH g AS (SELECT user_id, event_time, CASE WHEN event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) > interval '30 minutes' OR lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) IS NULL THEN 1 ELSE 0 END AS s FROM events), t AS (SELECT user_id, sum(s) OVER (PARTITION BY user_id ORDER BY event_time) AS sid FROM g) SELECT round(avg(n), 2)::text AS av, max(n) AS mx FROM (SELECT count(*) AS n FROM t GROUP BY user_id, sid) x");
  const retention = await list("SELECT 'week ' || wk || ': ' || active AS v FROM (SELECT ((e.event_time::date - u.signup_date) / 7) AS wk, count(DISTINCT e.user_id) AS active FROM events e JOIN users u USING (user_id) GROUP BY 1 ORDER BY 1 LIMIT 9) t");
  const subs = await one('SELECT count(*) AS n, count(DISTINCT user_id) AS users, count(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled, min(started_at)::text AS lo, max(started_at)::text AS hi FROM subscriptions');
  const plans = await list('SELECT plan || \' \' || count(*) || \' at \' || min(price) AS v FROM subscriptions GROUP BY plan ORDER BY plan');
  const resub = await list('SELECT user_id::text AS v FROM subscriptions GROUP BY user_id HAVING count(*) > 1 ORDER BY user_id');
  must((await q.val("SELECT count(*) FROM (SELECT user_id, event_time::date AS d, properties->>'plan' AS p, (properties->>'price')::numeric AS pr FROM events WHERE event_name = 'subscription_started') a FULL JOIN subscriptions s ON s.user_id = a.user_id AND s.started_at = a.d AND s.plan = a.p AND s.price = a.pr WHERE a.user_id IS NULL OR s.user_id IS NULL")) === 0, 'subscriptions match subscription_started events');
  const cancelGap = await one('SELECT min(cancelled_at - started_at) AS lo, max(cancelled_at - started_at) AS hi FROM subscriptions WHERE cancelled_at IS NOT NULL');
  const cancelByPlan = await list("SELECT plan || ' ' || count(*) FILTER (WHERE cancelled_at IS NOT NULL) || ' of ' || count(*) AS v FROM subscriptions GROUP BY plan ORDER BY plan");
  const steps = await one('SELECT count(*) AS n, count(DISTINCT user_id) AS users, min(day)::text AS lo, max(day)::text AS hi, min(steps) AS s1, max(steps) AS s2, round(avg(steps))::int AS av FROM daily_steps');
  const islands = await one("WITH d AS (SELECT user_id, day, day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS g FROM daily_steps), s AS (SELECT user_id, g, count(*) AS len FROM d GROUP BY user_id, g) SELECT count(*) AS streaks, max(len) AS longest, count(*) FILTER (WHERE len >= 30) AS long30, count(*) FILTER (WHERE len = 1) AS single FROM s");
  const fullUser = await list("SELECT user_id::text AS v FROM daily_steps GROUP BY user_id HAVING count(*) = 92 ORDER BY user_id");
  const lateStart = await q.val("SELECT count(*) FROM (SELECT user_id FROM daily_steps GROUP BY user_id HAVING min(day) > DATE '2024-03-01') t");
  const possible = await q.val("SELECT sum(DATE '2024-05-31' - greatest(u.signup_date, DATE '2024-03-01') + 1)::int FROM users u WHERE u.user_id IN (SELECT user_id FROM daily_steps)");
  const missing = possible - steps.n;
  const signMonths = await list("SELECT to_char(signup_date, 'Mon') || ' ' || count(*) AS v FROM users GROUP BY date_trunc('month', signup_date), to_char(signup_date, 'Mon') ORDER BY date_trunc('month', signup_date)");
  const janHalf = await q.val("SELECT count(*) FROM users WHERE signup_date <= '2024-01-15'");
  const silentAds = await q.val("SELECT count(*) FROM users u WHERE u.referral_source = 'ads' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.user_id)");
  const quickSubs = await one("SELECT count(*) FILTER (WHERE s.started_at - u.signup_date <= 7) AS within7, count(*) AS n FROM subscriptions s JOIN users u USING (user_id)");
  must((await q.val('SELECT count(DISTINCT user_id) FROM daily_steps')) === 40, '40 step users');

  return {
    about:
      'FitTrack is a product-analytics playground: an event log (`events`) with JSON `properties`, a small `subscriptions` table that agrees with the `subscription_started` events, and a table of daily step counts with deliberate gaps. ' +
      'Timestamps are plain `timestamp` values (no time zone, think "UTC"). "As of" date: **2024-07-31** (the end of the event log); step data covers March to May 2024.',
    conventions: [
      `**Users:** ${u.n} users who signed up ${u.lo} to ${u.hi} (per month: ${signMonths}; ${janHalf} of them joined in the first half of January - New Year's resolutions); platforms: ${plat}; referral source: ${refs}; top countries: ${ctry}. ${u.nobirth} users have no \`birth_year\` (the others are born ${u.b1} to ${u.b2}).`,
      `**Events:** ${commas(ev.n)} events from ${ev.lo} to ${ev.hi} by ${ev.users} users: ${names}. No event is dated before its user's signup date, and every user who has events starts with an \`app_open\` on the signup day.`,
      `**Funnel (users with at least one event of the type):** opened the app ${funnel.opened}, started a workout ${funnel.started}, completed a workout ${funnel.completed}, started a subscription ${funnel.subscribed} (of ${u.n} users; ${(100 * funnel.subscribed / u.n).toFixed(0)}% subscribed). The funnel is deliberately leaky: the rest of the users opened the app but never started a workout.`,
      `**JSON \`properties\`** keys per event: ${keys}. Values - \`screen\`: ${await vals('app_open', 'screen')}; \`app_version\`: ${await vals('app_open', 'app_version')} (2.4.0 was released on 2024-03-12 and 2.5.0 on 2024-06-04; web users update immediately, mobile users update after 0-35 days, a few much later); \`workout_type\`: ${await vals('workout_started', 'workout_type')}; \`duration_min\` is ${ranges.d1} to ${ranges.d2} (integer) and \`calories\` is roughly duration times a per-sport rate; \`goal\`: ${await vals('goal_set', 'goal')} with \`target_per_week\` 2 to 6; \`plan\`: ${await vals('subscription_started', 'plan')} with \`price\` 9.99 (monthly) or 79.99 (annual); \`channel\` (share): ${await vals('share', 'channel')}; \`setting\` (settings_changed): ${await vals('settings_changed', 'setting')}. Use \`->>\` for text, \`(properties->>'price')::numeric\` for numbers and \`properties @> '{"plan": "annual"}'\` for containment. \`workout_started\` carries the planned duration and an estimated calorie count, \`workout_completed\` the actual calories.`,
      `**Sessions.** Events arrive in bursts. Inside a session the gap between consecutive events of a user is at most **${gaps.within}** (hh:mm:ss) and a new session starts at least **${gaps.between}** after the previous event, so any inactivity timeout between 30 minutes and 3 hours gives the same answer: **${commas(sess.sessions)} sessions** (${perSession.av} events per session on average, at most ${perSession.mx}). Every session starts with exactly one \`app_open\`. A workout lasts under 30 minutes, so a workout never splits a session.`,
      `**Retention decays by weeks since signup.** Users with any event in week 0, 1, 2, ...: ${retention} (later weeks are lower partly because recent cohorts have not had time to reach them). Users come back in irregular patterns, so weeks without activity in the middle are common.`,
      `**Subscriptions:** ${subs.n} rows for ${subs.users} users, started ${subs.lo} to ${subs.hi}; plans ${plans}; cancelled: ${subs.cancelled} (${cancelByPlan}). A cancellation comes ${cancelGap.lo} to ${cancelGap.hi} days after the start. Each row matches exactly one \`subscription_started\` event of the same user, plan, price and day (and vice versa). ${quickSubs.within7} of the ${quickSubs.n} subscriptions start within 7 days of the user's signup.`,
      `**daily_steps:** ${commas(steps.n)} rows for ${steps.users} users between ${steps.lo} and ${steps.hi}; \`steps\` ${commas(steps.s1)} to ${commas(steps.s2)} (average ${commas(steps.av)}), a bit lower on weekends. A missing row means "no data that day": ${commas(possible)} user-days would be possible (each user from 2024-03-01, or from their signup day if later - ${lateStart} users start after 2024-03-01), so ${commas(missing)} days are missing.`,
    ],
    quirks: [
      `**${silent.n} users have no events at all** (signed up but never opened the app) - the anti-join example; ${silentAds} of them came from ads (ad traffic is over-represented among them).`,
      `**Re-subscribers:** users ${resub} cancelled a subscription and later subscribed again (one user, several \`subscriptions\` rows).`,
      `**Workouts that were never completed:** ${commas(await q.val("SELECT count(*) FROM events s WHERE s.event_name = 'workout_started' AND NOT EXISTS (SELECT 1 FROM events c WHERE c.user_id = s.user_id AND c.event_name = 'workout_completed' AND c.event_time > s.event_time AND c.event_time <= s.event_time + interval '30 minutes' AND c.properties->>'workout_type' = s.properties->>'workout_type')"))} \`workout_started\` events have no matching \`workout_completed\` within 30 minutes (abandoned workouts) - good for funnel conversion by workout type.`,
      `**Streaks / islands.** In \`daily_steps\` the ${steps.users} users together have ${islands.streaks} runs of consecutive days; the longest run is ${islands.longest} days, ${islands.long30} runs last 30 days or more, ${islands.single} are single days. Users with all 92 days and no gap at all: ${fullUser}.`,
      `**Counts at a glance:** ${commas(ev.users)} users have events, ${silent.n} have none; ${funnel.subscribed} users have a \`subscription_started\` event (= users with a subscription).`,
      '`event_id` is a `bigint` (and `jsonb` is stored in normalised form: keys may print in a different order than they were written).',
    ],
    facts: [
      await f('Users who opened / started a workout / completed a workout / subscribed', "SELECT count(DISTINCT user_id) FILTER (WHERE event_name = 'app_open') || ' / ' || count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_started') || ' / ' || count(DISTINCT user_id) FILTER (WHERE event_name = 'workout_completed') || ' / ' || count(DISTINCT user_id) FILTER (WHERE event_name = 'subscription_started') FROM events"),
      await f('Events per type', 'SELECT event_name, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC', 'pairs'),
      await f('Events per month', "SELECT to_char(event_time, 'YYYY-MM') AS month, count(*) FROM events GROUP BY to_char(event_time, 'YYYY-MM') ORDER BY 1", 'pairs'),
      await f('Busiest weekday (0 = Sunday) by number of events', 'SELECT extract(dow FROM event_time)::int AS dow, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 3', 'pairs'),
      await f('Busiest hour of the day by number of events', 'SELECT extract(hour FROM event_time)::int AS hour, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 3', 'pairs'),
      await f('Sessions (30-minute inactivity rule)', "SELECT count(*) FROM (SELECT event_time - lag(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS gap FROM events) t WHERE gap IS NULL OR gap > interval '30 minutes'", 'int'),
      await f('Share of users active 7-13 days after signup (week-1 retention, among users with events)', "SELECT round(100.0 * count(DISTINCT e.user_id) FILTER (WHERE e.event_time::date - u.signup_date BETWEEN 7 AND 13) / count(DISTINCT e.user_id), 1) || '%' FROM events e JOIN users u ON u.user_id = e.user_id"),
      await f('Subscription revenue booked (sum of price over all subscriptions)', 'SELECT sum(price) FROM subscriptions', 'money'),
      await f('Median days from signup to first subscription', 'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.started_at - u.signup_date) FROM (SELECT user_id, min(started_at) AS started_at FROM subscriptions GROUP BY user_id) s JOIN users u ON u.user_id = s.user_id'),
      await f('Average completed workout duration and calories per type', "SELECT properties->>'workout_type' AS workout_type, round(avg((properties->>'duration_min')::int), 1) || ' min, ' || round(avg((properties->>'calories')::int)) || ' kcal' FROM events WHERE event_name = 'workout_completed' GROUP BY 1 ORDER BY 1", 'pairs'),
      await f('Longest streak of consecutive step-tracking days', "WITH d AS (SELECT user_id, day, day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS g FROM daily_steps) SELECT 'user ' || user_id || ': ' || count(*) || ' days' FROM d GROUP BY user_id, g ORDER BY count(*) DESC, user_id LIMIT 1"),
      await f('Most active user (events)', 'SELECT user_id || \' (\' || count(*) || \' events)\' FROM events GROUP BY user_id ORDER BY count(*) DESC, user_id LIMIT 1'),
    ],
    topics: [
      'Funnels (open -> workout_started -> workout_completed -> subscription) overall and by platform, referral source or country; conversion with `COUNT(DISTINCT ...) FILTER`.',
      'Retention: weekly cohorts by signup week, week-N retention matrices, classic "users active in week k / users in cohort".',
      'Sessionization with `LAG` and a running `SUM` of a new-session flag; events and duration per session.',
      'Gaps and islands on `daily_steps` (streaks of consecutive days) and on weekly activity.',
      'JSON: `->`, `->>`, `@>`, `jsonb_object_keys`, casting properties to numbers; aggregating by `properties->>\'workout_type\'`.',
      'Time-to-event: days from signup to first workout / subscription; subscription lifetime and churn.',
      'Anti-joins: users who never opened the app, users who started but never completed a workout.',
    ],
  };
}

// =============================================================================
// 7. school - Maple High School
// =============================================================================

function buildSchool() {
  const rng = new Rng(7007);

  // ---- teachers (12) -------------------------------------------------------------------
  const teacherRows = [
    [1, 'Linda Park', 'Math', '2008-08-18', 71500],
    [2, 'Marcus Johnson', 'Math', '2014-08-20', 66000],
    [3, 'Elena Rossi', 'English', '2011-08-15', 68500],
    [4, 'David Okafor', 'English', '2019-08-19', 58000],
    [5, 'Priya Nair', 'Science', '2016-08-22', 63000],
    [6, 'Thomas Weber', 'Science', '2007-08-20', 88000],
    [7, 'Sofia Martinez', 'History', '2012-08-20', 65500],
    [8, 'Kenji Tanaka', 'Computer Science', '2021-08-23', 61000],
    [9, 'Hannah Cooper', 'Art', '2017-08-21', 56500],
    [10, 'Robert Walsh', 'Physical Education', '2005-08-22', 74000],
    [11, 'Aisha Khan', 'Music', '2018-08-20', 57500],
    [12, 'Jonas Lindqvist', 'Drama', '2023-08-21', 52000],
  ];

  // ---- courses (18) ----------------------------------------------------------------------
  // id, title, subject, teacher, credits, room, grades allowed
  const C = [
    [1, 'Algebra I', 'Math', 1, 3, 'A101', [9]],
    [2, 'Geometry', 'Math', 1, 3, 'A101', [9, 10]],
    [3, 'Algebra II', 'Math', 2, 3, 'A102', [10, 11]],
    [4, 'Pre-Calculus', 'Math', 2, 3, 'A102', [11, 12]],
    [5, 'English 9', 'English', 3, 3, 'B201', [9]],
    [6, 'English 10', 'English', 3, 3, 'B201', [10]],
    [7, 'English Literature', 'English', 4, 3, 'B202', [11, 12]],
    [8, 'Biology', 'Science', 5, 4, 'Lab 1', [9, 10]],
    [9, 'Chemistry', 'Science', 6, 4, 'Lab 2', [10, 11]],
    [10, 'Physics', 'Science', 6, 4, 'Lab 2', [11, 12]],
    [11, 'World History', 'History', 7, 3, 'C301', [9, 10]],
    [12, 'US History', 'History', 7, 3, 'C301', [10, 11, 12]],
    [13, 'Intro to Programming', 'Computer Science', 8, 2, 'Lab 3', [9, 10, 11, 12]],
    [14, 'Studio Art', 'Art', 9, 2, 'Art Studio', [9, 10, 11, 12]],
    [15, 'Physical Education', 'Physical Education', 10, 1, 'Gym', [9, 10, 11, 12]],
    [16, 'Health & Wellness', 'Physical Education', 10, 1, 'D105', [9, 10]],
    [17, 'Concert Band', 'Music', 11, 2, 'Music Room', [9, 10, 11, 12]],
    [18, 'Spanish I', 'Spanish', null, 3, 'D204', [9, 10, 11, 12]],
  ];
  const courseRows = C.map((c) => [c[0], c[1], c[2], c[3], c[4], c[5]]);
  const HEALTH = 16;

  // ---- students (120) ----------------------------------------------------------------------------
  const sNames = makeNames(rng, 120);
  const GRADE_START = { 9: '2024-08-26', 10: '2023-08-28', 11: '2022-08-29', 12: '2021-08-30' };
  const BIRTH_FROM = { 9: '2009-09-01', 10: '2008-09-01', 11: '2007-09-01', 12: '2006-09-01' };
  const stu = [];
  let ni = 0;
  for (const g of [9, 10, 11, 12]) {
    for (let k = 0; k < 30; k++) {
      const n = sNames[ni++];
      let birthShift = rng.chance(0.06) ? (rng.chance(0.5) ? -365 : 365) : 0;
      const birth = dstr(dnum(BIRTH_FROM[g]) + rng.int(0, 364) + birthShift);
      stu.push({ g, first: n.first, last: n.last, birth, enrolled: GRADE_START[g], springOnly: false });
    }
  }
  // 5 transfer students during the fall, 3 who joined in January (spring only)
  const transferIdx = rng.sample([...Array(120).keys()].filter((i) => stu[i].g !== 9), 5);
  for (const i of transferIdx) stu[i].enrolled = dstr(rng.int(dnum(stu[i].enrolled) + 120, dnum('2024-09-27')));
  const springIdx = [stu.findIndex((s) => s.g === 10 && s.enrolled === GRADE_START[10]), stu.findIndex((s) => s.g === 11 && s.enrolled === GRADE_START[11]), stu.findIndex((s) => s.g === 12 && s.enrolled === GRADE_START[12])];
  for (const i of springIdx) {
    stu[i].enrolled = dstr(dnum('2025-01-06') + rng.int(0, 2));
    stu[i].springOnly = true;
  }
  const noEmail = new Set(rng.sample([...Array(120).keys()], 12));
  stu.forEach((s, i) => {
    s.email = noEmail.has(i) ? null : emailOf(s.first, s.last, 'example.org');
    s.ability = clamp(rng.normal(76, 9), 42, 96);
  });
  // ids in enrollment order (oldest cohort first)
  stu.sort((a, b) => (a.enrolled < b.enrolled ? -1 : a.enrolled > b.enrolled ? 1 : a.last < b.last ? -1 : a.last > b.last ? 1 : a.first < b.first ? -1 : 1));
  stu.forEach((s, i) => (s.id = i + 1));
  const studentRows = stu.map((s) => [s.id, s.first, s.last, s.g, s.birth, s.email, s.enrolled]);

  // ---- enrollments ----------------------------------------------------------------------------------------
  const pickCourse = (g, subject) => {
    const opts = C.filter((c) => c[2] === subject && c[6].includes(g));
    return opts.length ? rng.pick(opts)[0] : null;
  };
  const mathChoice = { 9: [[1, 60], [2, 40]], 10: [[2, 40], [3, 60]], 11: [[3, 45], [4, 55]], 12: [[4, 100]] };
  const sciChoice = { 9: [[8, 100]], 10: [[8, 35], [9, 65]], 11: [[9, 50], [10, 50]], 12: [[10, 100]] };
  const histChoice = { 9: [[11, 100]], 10: [[11, 50], [12, 50]], 11: [[12, 100]], 12: [[12, 100]] };
  const engCourse = { 9: 5, 10: 6, 11: 7, 12: 7 };
  const weightedChoice = (list) => rng.weighted(list.map((x) => x[0]), list.map((x) => x[1]));
  const enr = []; // {s, c, term}
  const key = (s, c, t) => `${s}|${c}|${t}`;
  const have = new Set();
  const add = (s, c, term) => {
    const k = key(s.id, c, term);
    if (have.has(k)) return false;
    have.add(k);
    enr.push({ s, c, term });
    return true;
  };
  const ELECTIVES = [13, 14, 15, 16, 17, 18];
  const electiveOK = (g, c) => C[c - 1][6].includes(g);
  for (const s of stu) {
    const fall = [];
    if (!s.springOnly) {
      if (rng.chance(0.75)) fall.push(engCourse[s.g]);
      if (rng.chance(0.7)) fall.push(weightedChoice(mathChoice[s.g]));
      if (rng.chance(0.55)) fall.push(weightedChoice(sciChoice[s.g]));
      if (rng.chance(0.4)) fall.push(weightedChoice(histChoice[s.g]));
      if (rng.chance(0.5)) fall.push(rng.pick(ELECTIVES.filter((c) => electiveOK(s.g, c))));
      if (rng.chance(0.2)) fall.push(rng.pick(ELECTIVES.filter((c) => electiveOK(s.g, c))));
      if (fall.length < 2) fall.push(rng.pick(ELECTIVES.filter((c) => electiveOK(s.g, c))), engCourse[s.g]);
      for (const c of fall) add(s, c, '2024-Fall');
    }
    // spring: year-long core courses continue, electives mostly change
    const spring = [];
    for (const c of fall) {
      const core = C[c - 1][2] === 'Math' || C[c - 1][2] === 'English' || C[c - 1][2] === 'Science' || C[c - 1][2] === 'History';
      if (rng.chance(core ? 0.62 : 0.4)) spring.push(c);
    }
    const extra = s.springOnly ? rng.int(2, 3) : rng.chance(0.3) ? 1 : 0;
    for (let k = 0; k < extra; k++) {
      const subj = s.springOnly && k === 0 ? 'English' : rng.pick(['Math', 'Science', 'History', 'English', null]);
      const c = subj ? pickCourse(s.g, subj) : rng.pick(ELECTIVES.filter((x) => electiveOK(s.g, x)));
      if (c) spring.push(c);
    }
    for (const c of spring) add(s, c, '2025-Spring');
  }

  // ---- exams & final scores ----------------------------------------------------------------------------------
  const diff = C.map(() => rng.normal(0, 3.5));
  const schoolDay = (from, span) => {
    let d = addDays(from, rng.int(0, span));
    while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
    return d;
  };
  const weekdayOn = (from, offset) => {
    let d = addDays(from, offset);
    while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
    return d;
  };
  const exams = []; // {s, c, date, type, score}
  const scoreOf = (e, type) => r1(clamp(e.s.ability + diff[e.c - 1] + (type === 'quiz' ? 2 : type === 'final' ? -1 : 0) + rng.normal(0, 7), 12, 100));
  const incompletePool = enr.filter((e) => e.term === '2024-Fall');
  const incomplete = new Set(rng.sample(incompletePool, 3));
  const finals = new Map();
  for (const e of enr) {
    const fall = e.term === '2024-Fall';
    const health = e.c === HEALTH && !fall;
    const qn = fall ? 1 + (rng.chance(0.2) ? 1 : 0) : 1 + (rng.chance(0.2) ? 1 : 0);
    const quizzes = [];
    for (let q = 0; q < qn; q++) {
      const date = fall ? schoolDay('2024-09-09', 75) : health ? schoolDay('2025-01-27', 24) : schoolDay('2025-01-27', 66);
      quizzes.push({ s: e.s, c: e.c, date, type: 'quiz', score: scoreOf(e, 'quiz') });
    }
    const mid = {
      s: e.s,
      c: e.c,
      date: fall ? weekdayOn('2024-10-14', e.c % 5) : health ? weekdayOn('2025-02-17', e.c % 3) : weekdayOn('2025-03-10', e.c % 5),
      type: 'midterm',
      score: scoreOf(e, 'midterm'),
    };
    exams.push(...quizzes, mid);
    let fin = null;
    if ((fall && !incomplete.has(e)) || health) {
      fin = {
        s: e.s,
        c: e.c,
        date: fall ? weekdayOn('2024-12-09', (e.c + e.s.id) % 9) : weekdayOn('2025-03-17', (e.c + e.s.id) % 5),
        type: 'final',
        score: scoreOf(e, 'final'),
      };
      exams.push(fin);
    }
    if (fin) {
      const qavg = sum(quizzes.map((x) => x.score)) / quizzes.length;
      e.final = r2(0.2 * qavg + 0.35 * mid.score + 0.45 * fin.score);
    } else e.final = null;
  }
  exams.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.s.id - b.s.id || a.c - b.c || (a.type < b.type ? -1 : 1)));
  const examRows = exams.map((x, i) => [i + 1, x.s.id, x.c, x.date, x.type, x.score]);
  enr.sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0) || a.s.id - b.s.id || a.c - b.c);
  const enrollRows = enr.map((e) => [e.s.id, e.c, e.term, e.final]);

  // ---- clubs ----------------------------------------------------------------------------------------------------
  const clubRows = [
    [1, 'Robotics Club', 8],
    [2, 'Chess Club', 1],
    [3, 'Drama Society', 12],
    [4, 'Environmental Club', 5],
    [5, 'Debate Team', 3],
    [6, 'Photography Club', 9],
    [7, 'Book Club', 4],
    [8, 'Yearbook Committee', null],
  ];
  const clubSize = [30, 14, 26, 22, 18, 16, 14, 10];
  const act = new Map(stu.map((s) => [s.id, rng.logNormal(0, 0.8)]));
  const members = [];
  const ACADEMIC_STARTS = ['2021-09-13', '2022-09-12', '2023-09-11', '2024-09-09'];
  clubRows.forEach(([cid], ci) => {
    const pool = stu.slice();
    const w = pool.map((s) => act.get(s.id) * (cid === 1 || cid === 2 ? (s.g <= 11 ? 1.3 : 0.8) : 1));
    const chosen = rng.weightedSample(pool, w, clubSize[ci]);
    for (const s of chosen) {
      const options = ACADEMIC_STARTS.filter((d) => addDays(d, 14) >= s.enrolled);
      let joined;
      if (s.enrolled >= '2025-01-01' || options.length === 0) joined = addDays(s.enrolled, rng.int(7, 40));
      else {
        const start = rng.pick(options);
        joined = start > s.enrolled ? addDays(start, rng.int(0, 21)) : addDays(s.enrolled, rng.int(5, 40));
        if (rng.chance(0.15)) joined = addDays('2025-01-13', rng.int(0, 30));
        if (joined < s.enrolled) joined = addDays(s.enrolled, 7);
      }
      if (joined > '2025-03-31') joined = '2025-03-03';
      members.push([cid, s.id, joined]);
    }
  });
  members.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const tables = [
    T('teachers', 'The teaching staff of Maple High School.', [
      ['teacher_id', 'integer', 'PRIMARY KEY', 'Unique id of the teacher'],
      ['full_name', 'text', 'NOT NULL', 'Full name'],
      ['subject', 'text', 'NOT NULL', 'Main subject the teacher is responsible for'],
      ['hire_date', 'date', 'NOT NULL', 'Day the teacher started at the school'],
      ['salary', 'numeric(9,2)', 'NOT NULL', 'Yearly salary in dollars'],
    ], teacherRows),
    T('students', 'Students currently enrolled at the school (grades 9 to 12).', [
      ['student_id', 'integer', 'PRIMARY KEY', 'Unique id of the student (lower ids enrolled earlier)'],
      ['first_name', 'text', 'NOT NULL', 'Given name'],
      ['last_name', 'text', 'NOT NULL', 'Family name'],
      ['grade_level', 'integer', 'NOT NULL CHECK (grade_level BETWEEN 9 AND 12)', 'Current grade: 9 (freshman) to 12 (senior)'],
      ['birth_date', 'date', 'NOT NULL', 'Date of birth'],
      ['email', 'text', '', 'School email address (empty if not issued yet)'],
      ['enrolled_on', 'date', 'NOT NULL', 'First day at Maple High School'],
    ], studentRows),
    T('courses', 'Courses offered during the 2024-25 school year.', [
      ['course_id', 'integer', 'PRIMARY KEY', 'Unique id of the course'],
      ['title', 'text', 'NOT NULL', 'Course title'],
      ['subject', 'text', 'NOT NULL', 'Subject area of the course'],
      ['teacher_id', 'integer', 'REFERENCES teachers (teacher_id)', 'Teacher who teaches the course (empty if nobody is assigned yet)'],
      ['credits', 'integer', 'NOT NULL', 'Credits earned for completing the course'],
      ['room', 'text', 'NOT NULL', 'Classroom where the course meets'],
    ], courseRows),
    T('enrollments', 'Which student takes which course in which term, with the final score once it is known.', [
      ['student_id', 'integer', 'NOT NULL REFERENCES students (student_id)', 'The student'],
      ['course_id', 'integer', 'NOT NULL REFERENCES courses (course_id)', 'The course'],
      ['term', 'text', 'NOT NULL', 'School term: 2024-Fall or 2025-Spring'],
      ['final_score', 'numeric(5,2)', '', 'Final course score from 0 to 100 (empty while the course is still running or the score is missing)'],
    ], enrollRows, { constraints: ['PRIMARY KEY (student_id, course_id, term)'] }),
    T('exam_scores', 'Individual quiz, midterm and final exam results.', [
      ['exam_id', 'integer', 'PRIMARY KEY', 'Unique id of the exam result'],
      ['student_id', 'integer', 'NOT NULL REFERENCES students (student_id)', 'Student who took the exam'],
      ['course_id', 'integer', 'NOT NULL REFERENCES courses (course_id)', 'Course the exam belongs to'],
      ['exam_date', 'date', 'NOT NULL', 'Day the exam was taken'],
      ['exam_type', 'text', 'NOT NULL', 'quiz, midterm or final'],
      ['score', 'numeric(5,2)', 'NOT NULL', 'Score from 0 to 100'],
    ], examRows),
    T('clubs', 'Student clubs and the teacher who advises each one.', [
      ['club_id', 'integer', 'PRIMARY KEY', 'Unique id of the club'],
      ['name', 'text', 'NOT NULL', 'Club name'],
      ['advisor_id', 'integer', 'REFERENCES teachers (teacher_id)', 'Teacher who advises the club (empty if still looking for one)'],
    ], clubRows),
    T('club_members', 'Which students belong to which clubs.', [
      ['club_id', 'integer', 'NOT NULL REFERENCES clubs (club_id)', 'The club'],
      ['student_id', 'integer', 'NOT NULL REFERENCES students (student_id)', 'The student'],
      ['joined_on', 'date', 'NOT NULL', 'Day the student joined the club'],
    ], members, { constraints: ['PRIMARY KEY (club_id, student_id)'] }),
  ];

  return {
    id: 'school',
    name: 'Maple High School',
    icon: '🏫',
    tagline: 'Students, courses, exam scores and clubs: grades and rankings.',
    description:
      'Maple High School has 120 students, 12 teachers, 18 courses and two terms of enrollments with exam results. ' +
      'It is a friendly place to practice averages, GROUP BY, HAVING and ranking functions, and to see how LEFT JOIN reveals students without clubs or courses without teachers. ' +
      'The 2025-Spring term is still in progress, so many final scores are empty.',
    tables,
    extra: { incomplete: [...incomplete].map((e) => [e.s.id, e.c]), springOnly: stu.filter((s) => s.springOnly).map((s) => s.id) },
  };
}

// ---- documentation: school --------------------------------------------------------------------
async function docSchool(q, ds) {
  const f = q.fact;
  const list = async (sql) => (await q.rows(sql)).map((r) => r.v).join(', ');
  const one = async (sql) => (await q.rows(sql))[0];

  const grades = await list('SELECT grade_level || \': \' || count(*) AS v FROM students GROUP BY grade_level ORDER BY grade_level');
  const cohort = await list('SELECT grade_level || \': first day \' || mode() WITHIN GROUP (ORDER BY enrolled_on) AS v FROM students GROUP BY grade_level ORDER BY grade_level');
  const transfers = await q.val("SELECT count(*) FROM students s WHERE enrolled_on <> (SELECT mode() WITHIN GROUP (ORDER BY enrolled_on) FROM students x WHERE x.grade_level = s.grade_level)");
  const springOnly = await list("SELECT s.student_id::text AS v FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.term = '2024-Fall') ORDER BY s.student_id");
  must(springOnly === ds.extra.springOnly.join(', '), 'spring-only students');
  const noEmail = await q.val('SELECT count(*) FROM students WHERE email IS NULL');
  const tch = await one('SELECT count(*) AS n, min(salary)::text AS lo, max(salary)::text AS hi, min(hire_date)::text AS h1, max(hire_date)::text AS h2 FROM teachers');
  const subjects = await list('SELECT subject || \' \' || count(*) AS v FROM teachers GROUP BY subject ORDER BY subject');
  const noCourseT = await list('SELECT t.teacher_id || \' \' || t.full_name || \' (\' || t.subject || \')\' AS v FROM teachers t WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.teacher_id = t.teacher_id)');
  const noTeacherC = await list('SELECT course_id || \' \' || title AS v FROM courses WHERE teacher_id IS NULL');
  const enr = await list('SELECT term || \': \' || count(*) || \' enrollments, \' || count(final_score) || \' with a score\' AS v FROM enrollments GROUP BY term ORDER BY term');
  const fallNull = await list("SELECT 'student ' || student_id || ' in course ' || course_id AS v FROM enrollments WHERE term = '2024-Fall' AND final_score IS NULL ORDER BY student_id");
  const springScored = await one("SELECT count(*) AS n, string_agg(DISTINCT course_id::text, ', ') AS courses FROM enrollments WHERE term = '2025-Spring' AND final_score IS NOT NULL");
  const perStudent = await list("SELECT n || ' course' || (CASE WHEN n > 1 THEN 's' ELSE '' END) || ': ' || count(*) AS v FROM (SELECT student_id, count(*) AS n FROM enrollments WHERE term = '2024-Fall' GROUP BY student_id) t GROUP BY n ORDER BY n");
  const ex = await one('SELECT count(*) AS n, min(exam_date)::text AS lo, max(exam_date)::text AS hi FROM exam_scores');
  const exTypes = await list('SELECT exam_type || \' \' || count(*) || \' (avg \' || round(avg(score), 1) || \')\' AS v FROM exam_scores GROUP BY exam_type ORDER BY exam_type');
  const scoreRange = await one('SELECT min(score)::text AS lo, max(score)::text AS hi FROM exam_scores');
  const formula = await one("WITH q AS (SELECT student_id, course_id, CASE WHEN exam_date < DATE '2025-01-01' THEN '2024-Fall' ELSE '2025-Spring' END AS term, avg(score) FILTER (WHERE exam_type = 'quiz') AS qa, max(score) FILTER (WHERE exam_type = 'midterm') AS m, max(score) FILTER (WHERE exam_type = 'final') AS f FROM exam_scores GROUP BY 1, 2, 3) SELECT count(*) AS checked, max(abs(round(0.2 * qa + 0.35 * m + 0.45 * f, 2) - e.final_score))::text AS maxdiff FROM q JOIN enrollments e USING (student_id, course_id, term) WHERE e.final_score IS NOT NULL");
  must(Number(formula.maxdiff) <= 0.011, 'final_score follows the weighted formula');
  const orphanExams = await q.val("SELECT count(*) FROM exam_scores x WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = x.student_id AND e.course_id = x.course_id AND ((x.exam_date < DATE '2025-01-01' AND e.term = '2024-Fall') OR (x.exam_date >= DATE '2025-01-01' AND e.term = '2025-Spring')))");
  must(orphanExams === 0, 'every exam belongs to an enrollment');
  const noFinalExam = await q.val("SELECT count(*) FROM enrollments e WHERE e.term = '2024-Fall' AND NOT EXISTS (SELECT 1 FROM exam_scores x WHERE x.student_id = e.student_id AND x.course_id = e.course_id AND x.exam_type = 'final' AND x.exam_date < DATE '2025-01-01')");
  must(noFinalExam === 3, 'the three incomplete fall enrollments have no final exam');
  const clubs = await list('SELECT c.name || \' \' || count(m.student_id) AS v FROM clubs c LEFT JOIN club_members m USING (club_id) GROUP BY c.club_id, c.name ORDER BY count(m.student_id) DESC, c.name');
  const noClub = await q.val('SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM club_members m WHERE m.student_id = s.student_id)');
  const multiClub = await one('SELECT max(n) AS mx, count(*) FILTER (WHERE n >= 2) AS many FROM (SELECT student_id, count(*) AS n FROM club_members GROUP BY student_id) t');
  const noAdvisor = await list('SELECT name AS v FROM clubs WHERE advisor_id IS NULL');
  const advNoCourse = await list("SELECT c.name || ' (advisor ' || t.full_name || ')' AS v FROM clubs c JOIN teachers t ON t.teacher_id = c.advisor_id WHERE NOT EXISTS (SELECT 1 FROM courses x WHERE x.teacher_id = t.teacher_id)");
  const gradeOK = await q.val("SELECT count(*) FROM enrollments e JOIN students s USING (student_id) WHERE (e.course_id = 1 AND s.grade_level <> 9) OR (e.course_id = 5 AND s.grade_level <> 9) OR (e.course_id = 6 AND s.grade_level <> 10) OR (e.course_id = 7 AND s.grade_level < 11) OR (e.course_id = 4 AND s.grade_level < 11) OR (e.course_id = 10 AND s.grade_level < 11)");
  must(gradeOK === 0, 'grade-appropriate courses');
  const birthOdd = await q.val("SELECT count(*) FROM students WHERE birth_date < (CASE grade_level WHEN 9 THEN DATE '2009-09-01' WHEN 10 THEN DATE '2008-09-01' WHEN 11 THEN DATE '2007-09-01' ELSE DATE '2006-09-01' END) OR birth_date >= (CASE grade_level WHEN 9 THEN DATE '2010-09-01' WHEN 10 THEN DATE '2009-09-01' WHEN 11 THEN DATE '2008-09-01' ELSE DATE '2007-09-01' END)");

  return {
    about:
      'Maple High School is a compact, easy-to-picture dataset about grades and people: students sit in courses, take quizzes, midterms and finals, and join clubs. ' +
      '"As of" date: **2025-04-10** (mid spring term): the 2024-Fall term is finished and its scores are final, the 2025-Spring term is still running.',
    conventions: [
      `**Students:** 120 students, 30 per grade level (${grades}). Grade 9 to 12 students were born in the school years you would expect (grade 9: September 2009 - August 2010 and so on); ${birthOdd} students are a year younger or older than their grade (held back or skipped ahead). Student ids are in order of enrollment (oldest cohort first). Cohort first days: ${cohort}; ${transfers} students joined at another time (transfers), and ${springOnly.split(',').length} students (ids ${springOnly}) joined in January 2025, so they have **no 2024-Fall enrollments**. ${noEmail} students have no email yet.`,
      `**Teachers:** ${tch.n} teachers hired ${tch.h1} to ${tch.h2}, salaries ${money(tch.lo)} to ${money(tch.hi)}; subjects: ${subjects}.`,
      `**Courses:** 18 courses with 1 to 4 credits. Courses are grade-appropriate (Algebra I and English 9 are for grade 9 only, Physics and Pre-Calculus for grades 11-12, and so on), so enrollments respect the grade level. Students take ${perStudent} in the fall (this is a simplified catalog, not a full timetable).`,
      `**Terms and scores:** ${enr}. Courses are year-long for most students (many Fall enrollments continue in Spring) but the Spring term is incomplete: \`final_score\` is NULL while a course is running. The only Spring scores that exist (${springScored.n}) are for course ${springScored.courses} (Health & Wellness), a half-term course that ended in March.`,
      `**Exams:** ${commas(ex.n)} results between ${ex.lo} and ${ex.hi}: ${exTypes}; scores run from ${scoreRange.lo} to ${scoreRange.hi}. Every exam belongs to an enrollment (same student and course, exam date inside that term). Fall enrollments have 1-2 quizzes, one midterm (mid October) and one final (December 9-19); Spring enrollments have quizzes (late January to early April) and a midterm (mid March), but no finals yet.`,
      `**final_score** is derived from the exams: \`0.20 * average(quiz scores) + 0.35 * midterm + 0.45 * final\`, rounded to 2 decimals (verified for all ${formula.checked} scored enrollments; rounding differences are at most ${formula.maxdiff}). Students differ in ability, courses differ slightly in difficulty, and scores are roughly bell-shaped around the high 70s.`,
      `**Clubs:** 8 clubs with ${clubs} members (150 memberships). A student can be in several clubs (up to ${multiClub.mx}; ${multiClub.many} students are in two or more). Join dates fall at the start of a school year (September) or in January 2025 and never before the student enrolled.`,
    ],
    quirks: [
      `**Course without a teacher:** ${noTeacherC} (\`teacher_id\` is NULL) - use it for LEFT JOIN / COALESCE practice.`,
      `**Teacher without a course:** ${noCourseT}. ${advNoCourse} - the teacher who teaches no course still advises a club.`,
      `**Club without an advisor:** ${noAdvisor} (\`advisor_id\` is NULL).`,
      `**Incomplete fall enrollments:** ${fallNull} have \`final_score\` NULL and no final exam (the student missed the final), although the term is over.`,
      `**Spring-only students:** ${springOnly} have no 2024-Fall enrollments and ${noClub} students overall belong to no club.`,
      `**Students without email:** ${noEmail} (NULL).`,
      '`enrollments` has a composite primary key (student_id, course_id, term), so the same student can take the same course in both terms.',
      'There is no letter-grade column: letter grades (A-F) are a good CASE WHEN exercise (A = 90 and up, B = 80-89, C = 70-79, D = 60-69, F = below 60).',
    ],
    facts: [
      await f('Students / teachers / courses', "SELECT (SELECT count(*) FROM students) || ' / ' || (SELECT count(*) FROM teachers) || ' / ' || (SELECT count(*) FROM courses)"),
      await f('Enrollments per term', 'SELECT term, count(*) FROM enrollments GROUP BY 1 ORDER BY 1', 'pairs'),
      await f('Average final score of 2024-Fall by course (highest first)', "SELECT c.title, round(avg(e.final_score), 2) FROM enrollments e JOIN courses c ON c.course_id = e.course_id WHERE e.term = '2024-Fall' AND e.final_score IS NOT NULL GROUP BY c.course_id, c.title ORDER BY avg(e.final_score) DESC, c.title LIMIT 5", 'pairs'),
      await f('Student with the best average final score in 2024-Fall (at least 3 scored courses)', "SELECT s.first_name || ' ' || s.last_name || ' (student ' || s.student_id || ', ' || round(avg(e.final_score), 2) || ')' FROM enrollments e JOIN students s ON s.student_id = e.student_id WHERE e.term = '2024-Fall' AND e.final_score IS NOT NULL GROUP BY s.student_id, s.first_name, s.last_name HAVING count(*) >= 3 ORDER BY avg(e.final_score) DESC, s.student_id LIMIT 1"),
      await f('Fall enrollments with a final score of 90 or more', "SELECT count(*) FROM enrollments WHERE term = '2024-Fall' AND final_score >= 90", 'int'),
      await f('Fall enrollments below 60 (failing)', "SELECT count(*) FROM enrollments WHERE term = '2024-Fall' AND final_score < 60", 'int'),
      await f('Average exam score by exam type', 'SELECT exam_type, round(avg(score), 2) FROM exam_scores GROUP BY 1 ORDER BY 1', 'pairs'),
      await f('Students with no club', 'SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM club_members m WHERE m.student_id = s.student_id)', 'int'),
      await f('Largest club', 'SELECT c.name || \' (\' || count(*) || \' members)\' FROM club_members m JOIN clubs c ON c.club_id = m.club_id GROUP BY c.club_id, c.name ORDER BY count(*) DESC LIMIT 1'),
      await f('Average teacher salary by subject (top 3)', 'SELECT subject, round(avg(salary), 2) FROM teachers GROUP BY 1 ORDER BY avg(salary) DESC, subject LIMIT 3', 'pairs'),
      await f('Teacher teaching the most students in 2024-Fall', "SELECT t.full_name || ' (' || count(*) || ' enrollments)' FROM enrollments e JOIN courses c ON c.course_id = e.course_id JOIN teachers t ON t.teacher_id = c.teacher_id WHERE e.term = '2024-Fall' GROUP BY t.teacher_id, t.full_name ORDER BY count(*) DESC, t.teacher_id LIMIT 1"),
      await f('Grade-level averages of Fall final scores', "SELECT s.grade_level, round(avg(e.final_score), 2) FROM enrollments e JOIN students s ON s.student_id = e.student_id WHERE e.term = '2024-Fall' GROUP BY 1 ORDER BY 1", 'pairs'),
    ],
    topics: [
      'AVG / MIN / MAX / COUNT with GROUP BY and HAVING: average score per course, per teacher, per grade level.',
      'NULL logic: in-progress courses (`final_score IS NULL`), COALESCE, AVG ignoring NULLs, COUNT(*) vs COUNT(column).',
      'LEFT JOIN: students in no club, courses without a teacher, teachers without courses.',
      'Ranking: top student per grade (`RANK`, `DENSE_RANK`, `ROW_NUMBER`), percentiles, `NTILE`, running average of a student\'s exams.',
      'CASE for letter grades; conditional aggregation (`FILTER`) for pass/fail counts.',
      'Many-to-many through `enrollments` and `club_members`; checking consistency between `exam_scores` and `final_score`.',
    ],
  };
}

// =============================================================================
// 8. messy - Messy Data Co. (intentionally dirty, everything is TEXT)
// =============================================================================

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MESSY_COUNTRIES = [
  { code: 'US', w: 70, variants: [['USA', 25], ['U.S.', 10], ['United States', 30], ['us', 8], ['United States of America', 12], ['US', 5]], cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Seattle', 'Denver', 'Boston', 'Austin', 'Miami'] },
  { code: 'CA', w: 17, variants: [['Canada', 55], ['CA', 20], ['canada', 25]], cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'] },
  { code: 'UK', w: 8, variants: [['UK', 40], ['United Kingdom', 45], ['uk', 15]], cities: ['London', 'Manchester', 'Leeds', 'Glasgow', 'Bristol'] },
  { code: 'DE', w: 5, variants: [['Germany', 55], ['DE', 25], ['germany', 20]], cities: ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt'] },
];

const SURVEY_COMMENTS = [
  'Love the new design!',
  'Delivery was a bit slow but the product is great.',
  "Customer support was very helpful, thanks!",
  'Prices are too high for what you get.',
  'Would be nice to have more colors',
  'The app keeps crashing on my phone.',
  'Easy to use, my kids figured it out in minutes.',
  'Packaging could be better; one item arrived damaged.',
  'Great value. Will order again.',
  "I don't like the checkout process - too many steps.",
  'Website is confusing on mobile',
  'Five stars from me!!',
  'Not what I expected, but returns were easy.',
  'Fast shipping, nice quality.',
  'Please add more payment options (e.g. "buy now, pay later").',
  'Everything was perfect.',
  'Meh.',
  'The search function never finds what I need',
  'Good, not great.',
  'Been a customer for years and still happy.',
];

function buildMessy() {
  const rng = new Rng(8008);

  const fmtDate = (d, style) => {
    const y = yearOf(d);
    const m = monthOf(d);
    const day = +d.slice(8, 10);
    switch (style) {
      case 'iso': return d;
      case 'us': return `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}/${y}`;
      case 'mon': return `${String(day).padStart(2, '0')}-${MON3[m - 1]}-${y}`;
      case 'slash': return `${y}/${m}/${day}`;
      case 'long': return `${MONTH_LONG[m - 1]} ${day}, ${y}`;
      default: throw new Error('date style ' + style);
    }
  };
  const pickVariant = (variants) => rng.weighted(variants.map((v) => v[0]), variants.map((v) => v[1]));
  const altCase = (s) => [...s].map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join('');
  const titleCase = (s) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  // ---- raw_customers (120 rows = 105 people + 15 duplicates) ---------------------------------------
  const NB = 105;
  const names = makeNames(rng, NB);
  const people = names.map((n, i) => {
    const country = rng.weighted(MESSY_COUNTRIES, MESSY_COUNTRIES.map((c) => c.w));
    return {
      first: n.first,
      last: n.last,
      email: emailOf(n.first, n.last, rng.chance(0.75) ? 'example.com' : 'example.org'),
      country,
      city: rng.pick(country.cities),
      signup: dstr(rng.int(dnum('2021-01-01'), dnum('2024-10-31'))),
      phoneDigits: country.code === 'US' || country.code === 'CA'
        ? `${rng.pick(['212', '310', '415', '512', '617', '206', '303', '404', '305', '602', '416', '604', '514'])}555${String(rng.int(100, 199)).padStart(4, '0')}`
        : null,
      orders: rng.logNormal(0, 0.9),
    };
  });

  const renderName = (p, forceOdd) => {
    const full = `${p.first} ${p.last}`;
    const r = forceOdd ? 0.85 : rng.next();
    if (r < 0.28) return full;
    if (r < 0.4) return full.toLowerCase();
    if (r < 0.52) return full.toUpperCase();
    if (r < 0.6) return altCase(full);
    if (r < 0.74) return `  ${full.toLowerCase().replace(' ', '   ')} `;
    if (r < 0.82) return ` ${titleCase(full)}`;
    if (r < 0.9) return `${titleCase(p.last)}, ${titleCase(p.first)}`;
    return `${full.toLowerCase()}  `;
  };
  const renderEmail = (p) => {
    const r = rng.next();
    if (r < 0.58) return p.email;
    if (r < 0.7) return p.email.toUpperCase();
    if (r < 0.82) return `${p.email} `;
    if (r < 0.9) return ` ${p.email}`;
    if (r < 0.95) return titleCase(p.email.split('@')[0].replace('.', ' ')).replace(' ', '.') + '@' + p.email.split('@')[1];
    return p.email.toUpperCase() + ' ';
  };
  const renderPhone = (p) => {
    const d = p.phoneDigits;
    if (d) {
      const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6);
      return rng.weighted(
        [`(${a}) ${b}-${c}`, `${a}.${b}.${c}`, `+1 ${a} ${b} ${c}`, d, `${a}-${b}-${c}`, `1-${a}-${b}-${c}`],
        [26, 15, 15, 16, 20, 8],
      );
    }
    const n = String(rng.int(100, 999));
    if (p.country.code === 'UK') return rng.weighted([`+44 20 7946 0${n}`, `020 7946 0${n}`, `44207946 0${n}`.replace(' ', '')], [70, 20, 10]);
    return rng.weighted([`+49 30 1234${n}`, `030 1234${n}`, `49301234${n}`], [70, 20, 10]);
  };
  const renderCity = (p) => {
    const c = p.city;
    const r = rng.next();
    if (c === 'New York' && r < 0.25) return rng.pick(['NYC', 'new york city', 'New York City']);
    if (r < 0.62) return c;
    if (r < 0.74) return c.toLowerCase();
    if (r < 0.82) return c.toUpperCase();
    if (r < 0.92) return ` ${c} `;
    return `${c}  `;
  };
  const renderCountry = (p) => pickVariant(p.country.variants);
  const DATE_STYLES = ['iso', 'us', 'mon', 'slash'];
  const DATE_W = [38, 25, 17, 11];

  const renderCustomer = (p, dupMode) => {
    // phone: NULL / empty / formatted
    const rp = rng.next();
    let phone = rp < 0.1 ? null : rp < 0.18 ? '' : renderPhone(p);
    let email = rng.chance(0.04) ? null : rng.chance(0.03) ? '' : renderEmail(p);
    let signup = fmtDate(p.signup, rng.weighted(DATE_STYLES, DATE_W));
    let country = rng.chance(0.045) ? null : rng.chance(0.03) ? '' : renderCountry(p);
    let city = rng.chance(0.05) ? null : rng.chance(0.03) ? '' : renderCity(p);
    let name = renderName(p, dupMode === 'odd');
    if (dupMode === 'noemail') email = null;
    return { name, email, phone, signup, country, city };
  };

  const custRows0 = people.map((p) => renderCustomer(p));
  // sprinkle specific problems
  const pickRows = (n, from) => rng.sample([...Array(from).keys()], n);
  for (const i of pickRows(4, NB)) custRows0[i].email = rng.pick(['not-an-email', `${people[i].first.toLowerCase()}.${people[i].last.toLowerCase()}@@example.com`, `${people[i].first.toLowerCase()} ${people[i].last.toLowerCase()}@example.com`, `${people[i].email.split('@')[0]}.example.com`]);
  for (const i of pickRows(4, NB)) custRows0[i].signup = 'unknown';
  for (const i of pickRows(5, NB)) custRows0[i].signup = null;
  for (const i of pickRows(3, NB)) custRows0[i].signup = '';
  custRows0[pickRows(1, NB)[0]].name = null;
  for (const i of pickRows(2, NB)) custRows0[i].name = '';
  // duplicates of 15 people, formatted differently
  const dupPeople = rng.sample([...Array(NB).keys()], 15);
  const dupRows = dupPeople.map((i, k) => {
    const mode = k < 5 ? 'noemail' : k < 8 ? 'odd' : null;
    const row = renderCustomer(people[i], mode);
    if (row.email === custRows0[i].email && row.email) row.email = row.email.toUpperCase();
    if (row.name === custRows0[i].name) row.name = row.name ? row.name.toUpperCase() : titleCase(`${people[i].first} ${people[i].last}`);
    return { ...row, personIdx: i };
  });
  const allCust = [...custRows0.map((r, i) => ({ ...r, personIdx: i })), ...dupRows];
  const shuffled = rng.shuffle(allCust);
  const customerRows = shuffled.map((r, i) => [i + 1, r.name, r.email, r.phone, r.signup, r.country, r.city]);

  // ---- raw_orders (300 rows) -------------------------------------------------------------------------
  const NO = 284;
  const buyers = people.map((p) => p.orders);
  const STATUS_BASE = ['delivered', 'shipped', 'cancelled', 'pending', 'returned'];
  const STATUS_W = [62, 12, 12, 8, 6];
  const STATUS_VARIANTS = {
    delivered: [['Delivered', 35], ['delivered', 45], ['DELIVERED', 12], [' delivered', 4], ['delivered ', 4]],
    shipped: [['shipped ', 30], ['Shipped', 30], ['shipped', 40]],
    cancelled: [['cancelled', 45], ['canceled', 30], ['Cancelled', 15], ['CANCELED', 10]],
    pending: [['pending', 50], ['Pending', 30], ['PENDING', 20]],
    returned: [['returned', 60], ['Returned', 40]],
  };
  const ORDER_DATE_STYLES = ['iso', 'us', 'mon', 'slash', 'long'];
  const ORDER_DATE_W = [40, 25, 15, 9, 7];
  const orderBase = [];
  for (let i = 0; i < NO; i++) {
    const guest = rng.chance(0.04);
    const pi = guest ? -1 : rng.weighted([...Array(NB).keys()], buyers);
    const p = guest ? null : people[pi];
    const lo = p ? Math.max(dnum(p.signup), dnum('2023-06-01')) : dnum('2023-06-01');
    const date = dstr(rng.int(lo, dnum('2024-11-30')));
    let cents = Math.round(clamp(rng.logNormal(Math.log(70), 0.9), 4.5, 2400) * 100);
    if (rng.chance(0.4)) cents = Math.floor(cents / 100) * 100 + 99;
    const status = rng.weighted(STATUS_BASE, STATUS_W);
    const curBase = p && p.country.code === 'DE' && rng.chance(0.7) ? 'EUR' : 'USD';
    orderBase.push({
      ref: `ORD-${1001 + i}`,
      email: guest ? `guest.${rng.int(100, 999)}@example.com` : p.email,
      date,
      cents,
      status,
      cur: curBase,
    });
  }
  const fmtAmount = (cents, style) => {
    const v = cents / 100;
    const whole = Math.floor(cents / 100);
    const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    switch (style) {
      case 'dollar': return `$${withCommas(whole)}.${String(cents % 100).padStart(2, '0')}`;
      case 'plain2': return v.toFixed(2);
      case 'trim': return String(v);
      case 'padded': return `  ${cents % 100 === 0 ? whole : v} `;
      case 'dollar0': return `$${v.toFixed(2)}`;
      default: throw new Error(style);
    }
  };
  const renderOrder = (o) => {
    const rr = rng.next();
    const ref = rr < 0.85 ? o.ref : rr < 0.93 ? o.ref.toLowerCase() : o.ref.replace('-', '');
    const email = rng.chance(0.03) ? null : rng.chance(0.02) ? '' : renderEmail({ email: o.email, first: '', last: '' });
    const date = rng.chance(0.03) ? null : rng.chance(0.02) ? '' : fmtDate(o.date, rng.weighted(ORDER_DATE_STYLES, ORDER_DATE_W));
    let amount;
    const ra = rng.next();
    if (ra < 0.03) amount = 'N/A';
    else if (ra < 0.06) amount = '';
    else if (ra < 0.1) amount = null;
    else amount = fmtAmount(o.cents, rng.weighted(['dollar', 'plain2', 'trim', 'padded', 'dollar0'], o.cents >= 100000 ? [60, 15, 15, 5, 5] : [8, 34, 28, 10, 20]));
    let currency;
    const rc = rng.next();
    if (rc < 0.04) currency = rng.chance(0.5) ? null : '';
    else if (o.cur === 'EUR') currency = rng.chance(0.9) ? 'EUR' : 'eur';
    else currency = rng.weighted(['USD', 'usd', '$', 'Usd'], [72, 16, 8, 4]);
    const status = rng.chance(0.02) ? null : pickVariant(STATUS_VARIANTS[o.status]);
    return { ref, email, date, amount, currency, status };
  };
  let orderRows0 = orderBase.map((o) => renderOrder(o));
  // negative amounts (refunds) and absurd outliers
  const negIdx = rng.sample([...Array(NO).keys()].filter((i) => orderRows0[i].amount && orderRows0[i].amount.trim() && /\d/.test(orderRows0[i].amount)), 7);
  const cents = (i) => orderBase[i].cents;
  orderRows0[negIdx[0]].amount = `-${(cents(negIdx[0]) / 100).toFixed(2)}`;
  orderRows0[negIdx[1]].amount = `-${Math.floor(cents(negIdx[1]) / 100)}`;
  orderRows0[negIdx[2]].amount = `(${(cents(negIdx[2]) / 100).toFixed(2)})`;
  orderRows0[negIdx[3]].amount = `-$${(cents(negIdx[3]) / 100).toFixed(2)}`;
  orderRows0[negIdx[4]].amount = '999999.99';
  orderRows0[negIdx[5]].amount = '1000000';
  orderRows0[negIdx[6]].amount = '0.01';
  // 10 exact duplicates (same data, new row_id) and 6 conflicting duplicates (same order_ref, different data)
  const dupIdx = rng.sample([...Array(NO).keys()].filter((i) => !negIdx.includes(i)), 16);
  const exact = dupIdx.slice(0, 10).map((i) => ({ ...orderRows0[i], after: i }));
  const conflict = dupIdx.slice(10).map((i, k) => {
    const o = orderBase[i];
    const base = orderRows0[i];
    const copy = { ...base, after: i };
    if (k % 3 === 0) copy.amount = fmtAmount(o.cents + 100 * rng.int(1, 40), 'plain2');
    else if (k % 3 === 1) copy.status = o.status === 'delivered' ? 'cancelled' : 'Delivered';
    else copy.date = fmtDate(addDays(o.date, rng.int(1, 20)), 'iso');
    copy.ref = base.ref; // identical order_ref string
    return copy;
  });
  const merged = [];
  orderRows0.forEach((r, i) => {
    merged.push(r);
    for (const d of [...exact, ...conflict]) if (d.after === i) merged.push({ ...d, after: undefined });
  });
  const rawOrderRows = merged.map((r, i) => [i + 1, r.ref, r.email, r.date, r.amount, r.currency, r.status]);

  // ---- survey_responses (80 rows) ---------------------------------------------------------------------------
  const WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
  const surveyRows = [];
  for (let i = 0; i < 80; i++) {
    const rr = rng.next();
    const p = rng.pick(people);
    let respondent;
    if (rr < 0.4) respondent = p.email;
    else if (rr < 0.68) respondent = `${p.first} ${p.last.charAt(0)}.`;
    else if (rr < 0.78) respondent = 'anonymous';
    else if (rr < 0.88) respondent = null;
    else respondent = `cust-${String(rng.int(1, 120)).padStart(4, '0')}`;
    const score = rng.weighted([5, 4, 3, 2, 1], [35, 30, 18, 10, 7]);
    const r1x = rng.next();
    let q1;
    if (r1x < 0.62) q1 = String(score);
    else if (r1x < 0.74) q1 = rng.chance(0.5) ? `${score} ` : ` ${score}`;
    else if (r1x < 0.84) q1 = WORDS[score];
    else if (r1x < 0.87) q1 = `${score}/5`;
    else if (r1x < 0.92) q1 = '';
    else q1 = null;
    const nps = clamp(Math.round(score * 2 + rng.normal(0, 1.4)), 0, 10);
    const r2x = rng.next();
    let q2;
    if (r2x < 0.68) q2 = String(nps);
    else if (r2x < 0.75) q2 = ` ${nps} `;
    else if (r2x < 0.78) q2 = nps === 10 ? 'ten' : String(nps);
    else if (r2x < 0.83) q2 = 'N/A';
    else if (r2x < 0.9) q2 = '';
    else if (r2x < 0.95) q2 = null;
    else q2 = rng.pick(['Yes', 'no', 'maybe']);
    const r3x = rng.next();
    let q3;
    if (r3x < 0.58) q3 = rng.pick(SURVEY_COMMENTS);
    else if (r3x < 0.66) q3 = ` ${rng.pick(SURVEY_COMMENTS)}  `;
    else if (r3x < 0.8) q3 = null;
    else if (r3x < 0.9) q3 = '';
    else q3 = rng.pick(['n/a', 'N/A', 'none', '-', 'no comment']);
    const d = dstr(rng.int(dnum('2024-04-01'), dnum('2024-09-30')));
    const r4x = rng.next();
    let submitted;
    const hh = String(rng.int(0, 23)).padStart(2, '0');
    const mi = String(rng.int(0, 59)).padStart(2, '0');
    const ss = String(rng.int(0, 59)).padStart(2, '0');
    if (r4x < 0.4) submitted = `${d} ${hh}:${mi}:${ss}`;
    else if (r4x < 0.58) submitted = `${d}T${hh}:${mi}:${ss}Z`;
    else if (r4x < 0.76) submitted = fmtDate(d, 'us');
    else if (r4x < 0.94) submitted = fmtDate(d, 'long');
    else if (r4x < 0.97) submitted = null;
    else submitted = '';
    surveyRows.push([i + 1, respondent, q1, q2, q3, submitted]);
  }
  // a few out-of-range scores
  surveyRows[7][2] = '0';
  surveyRows[41][2] = '11';
  surveyRows[63][3] = '15';

  // ---- wide & long sales ------------------------------------------------------------------------------------------
  const PRODUCTS = ['Espresso Machine', 'Coffee Grinder', 'Milk Frother', 'Tea Kettle', 'French Press', 'Mug Set', 'Water Filter', 'Coffee Beans 1kg', 'Travel Tumbler', 'Cleaning Kit'];
  const BASE = [18500, 9200, 4100, 6800, 3300, 2600, 5400, 12100, 3900, 1500];
  const SEASON = [1.1, 1.0, 0.95, 0.9, 0.85, 0.8];
  const wide = PRODUCTS.map((name, i) => {
    const vals = SEASON.map((s) => r2(BASE[i] * s * rng.float(0.82, 1.18)));
    return [name, ...vals];
  });
  const MONTHS6 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const long = [];
  for (const row of wide) MONTHS6.forEach((m, k) => long.push([row[0], m, row[k + 1]]));

  const tables = [
    T('raw_customers', 'A customer list exported from several old systems: inconsistent spelling, formats and duplicates. Every column is text.', [
      ['row_id', 'integer', 'PRIMARY KEY', 'Row number of the import'],
      ['full_name', 'text', '', 'Customer name as typed (casing, spacing and order vary)'],
      ['email', 'text', '', 'Email address as typed (may have capitals, spaces or be invalid)'],
      ['phone', 'text', '', 'Phone number in many different formats'],
      ['signup_date', 'text', '', 'Signup date as text in several different formats'],
      ['country', 'text', '', 'Country name or code as typed'],
      ['city', 'text', '', 'City as typed'],
    ], customerRows),
    T('raw_orders', 'An order export with text amounts, mixed date formats, duplicate rows and inconsistent statuses.', [
      ['row_id', 'integer', 'PRIMARY KEY', 'Row number of the import'],
      ['order_ref', 'text', '', 'Order reference such as ORD-1001 (a few are written differently or appear twice)'],
      ['customer_email', 'text', '', 'Email of the customer who ordered, as typed'],
      ['order_date', 'text', '', 'Order date as text in several formats'],
      ['amount', 'text', '', 'Order amount as text (currency symbols, commas, spaces, N/A ...)'],
      ['currency', 'text', '', 'Currency as typed: USD, usd, $, EUR ...'],
      ['status', 'text', '', 'Order status with different spellings and casing'],
    ], rawOrderRows),
    T('survey_responses', 'Answers to a customer survey in wide format (one column per question), also stored as messy text.', [
      ['response_id', 'integer', 'PRIMARY KEY', 'Unique id of the response'],
      ['respondent', 'text', '', 'Who answered: an email, a short name, an id or nothing'],
      ['q1_satisfaction', 'text', '', 'How satisfied are you, 1 to 5? (digits, words, blanks ...)'],
      ['q2_recommend', 'text', '', 'How likely are you to recommend us, 0 to 10?'],
      ['q3_comment', 'text', '', 'Free-text comment'],
      ['submitted', 'text', '', 'When the survey was submitted, as text in several formats'],
    ], surveyRows),
    T('product_sales_wide', 'Monthly revenue per product in wide format: one column per month (a good table to unpivot).', [
      ['product', 'text', 'PRIMARY KEY', 'Product name'],
      ['jan', 'numeric', '', 'January revenue in dollars'],
      ['feb', 'numeric', '', 'February revenue in dollars'],
      ['mar', 'numeric', '', 'March revenue in dollars'],
      ['apr', 'numeric', '', 'April revenue in dollars'],
      ['may', 'numeric', '', 'May revenue in dollars'],
      ['jun', 'numeric', '', 'June revenue in dollars'],
    ], wide),
    T('monthly_sales_long', 'The same revenue figures in long format: one row per product and month (a good table to pivot).', [
      ['product', 'text', 'NOT NULL', 'Product name'],
      ['month', 'text', 'NOT NULL', 'Month abbreviation: Jan to Jun'],
      ['revenue', 'numeric(10,2)', '', 'Revenue in dollars'],
    ], long, { constraints: ['PRIMARY KEY (product, month)'] }),
  ];

  return {
    id: 'messy',
    name: 'Messy Data Co.',
    icon: '🧹',
    tagline: 'Dirty, real-world data: clean it with TRIM, LOWER, CASE, CAST and more.',
    description:
      'Messy Data Co. exports its data from old systems, so everything arrives as text: names in odd cases, phone numbers in many formats, dates written five different ways and duplicates hiding in plain sight. ' +
      'Use it to practice cleaning with TRIM, LOWER, REPLACE, CASE, COALESCE, NULLIF and CAST, finding duplicates, and reshaping data with pivot and unpivot. ' +
      'Nothing here is secret or personal: all names and emails are made up.',
    tables,
    extra: { dupPeople: dupPeople.length },
  };
}

// =============================================================================
// 9. blank - empty database
// =============================================================================

function buildBlank() {
  return {
    id: 'blank',
    name: 'Blank Database',
    icon: '✨',
    tagline: 'An empty database: create your own tables from scratch.',
    description:
      'This database starts completely empty. Use it to learn CREATE TABLE, INSERT, UPDATE, DELETE, constraints and indexes without any existing data getting in the way. ' +
      'Anything you create here is yours to experiment with.',
    tables: [],
    sqlOverride: '-- Blank database: it starts empty. Create your own tables with CREATE TABLE!\n',
  };
}

// =============================================================================
// documentation (content/DATASETS.md) - every number comes from querying the data
// =============================================================================

const commas = (v) => {
  const s = String(v);
  const [i, d] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? '.' + d : '');
};
const money = (v) => (Number(v) < 0 ? '-$' : '$') + commas(Math.abs(Number(v)).toFixed(2));
const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim();
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';
/** A statement made in the prose of the documentation must be true of the data. */
function must(cond, message) {
  if (!cond) throw new Error('DATASETS.md claim failed: ' + message);
}
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function makeQ(db) {
  const norm = (v) => (typeof v === 'bigint' ? Number(v) : v);
  const rows = async (sql) => {
    const r = await db.query(sql);
    return r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, norm(v)])));
  };
  const val = async (sql) => {
    const r = await rows(sql);
    if (!r.length) return null;
    return r[0][Object.keys(r[0])[0]];
  };
  /** Run a query and keep label + SQL + formatted result for the "handy facts" list. */
  const fact = async (label, sql, fmt = 'text') => {
    const r = await rows(sql);
    const first = r.length ? r[0][Object.keys(r[0])[0]] : null;
    let text;
    switch (fmt) {
      case 'int': text = code(commas(first)); break;
      case 'money': text = code(money(first)); break;
      case 'text': text = code(first === null ? 'NULL' : first); break;
      case 'list': text = r.map((x) => code(x[Object.keys(x)[0]])).join(', '); break;
      case 'pairs': text = r.map((x) => { const k = Object.keys(x); return `${code(x[k[0]] === null ? 'NULL' : x[k[0]])} ${commas(x[k[1]])}`; }).join(', '); break;
      case 'table': {
        const cols = Object.keys(r[0]);
        text = '\n\n' + [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...r.map((x) => `| ${cols.map((c) => esc(x[c] === null ? 'NULL' : x[c])).join(' | ')} |`)].join('\n');
        break;
      }
      default: throw new Error('fact fmt ' + fmt);
    }
    return { label, sql: oneLine(sql), text };
  };
  return { rows, val, fact };
}

const isNumericType = (t) => /^(integer|bigint|numeric)/.test(t);
const isTemporal = (t) => /^(date|timestamp)/.test(t);

/** value-range / enumerated-values cell for the column table */
async function columnStats(q, t, c) {
  const col = c.name;
  const isKey = /PRIMARY KEY|REFERENCES/.test(c.constraints) || t.constraints.some((k) => /PRIMARY KEY/.test(k) && new RegExp(`\\b${col}\\b`).test(k));
  const base = (await q.rows(`SELECT count(*) FILTER (WHERE ${col} IS NULL) AS nulls, count(DISTINCT ${col}) AS dist FROM ${t.name}`))[0];
  let cell = '';
  const total = t.rows.length;
  if (c.type === 'jsonb') {
    cell = 'JSON object (see notes)';
  } else if (c.type === 'boolean') {
    const r = await q.rows(`SELECT ${col}::text AS v, count(*) AS n FROM ${t.name} GROUP BY 1 ORDER BY 1 DESC`);
    cell = r.map((x) => `${x.v === null ? 'NULL' : x.v} (${commas(x.n)})`).join(', ');
  } else if (base.dist <= 12 && base.dist > 0 && (isKey ? base.dist <= 8 : (total - base.nulls) / base.dist >= 2)) {
    const r = await q.rows(`SELECT ${col}::text AS v, count(*) AS n FROM ${t.name} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1`);
    cell = r.map((x) => `${code(isNumericType(c.type) ? x.v : "'" + x.v + "'")} (${commas(x.n)})`).join(', ');
  } else if (isNumericType(c.type) || isTemporal(c.type)) {
    const r = (await q.rows(`SELECT min(${col})::text AS lo, max(${col})::text AS hi${isNumericType(c.type) && !isKey ? `, round(avg(${col})::numeric, 2)::text AS av` : ''} FROM ${t.name}`))[0];
    cell = `${code(r.lo)} to ${code(r.hi)}${r.av !== undefined ? `, avg ${r.av}` : ''}`;
  } else {
    const r = (await q.rows(`SELECT min(length(${col})) AS lo, max(length(${col})) AS hi FROM ${t.name}`))[0];
    cell = base.dist === total - base.nulls ? `all different (${r.lo}-${r.hi} characters)` : `${commas(base.dist)} different values`;
  }
  return { nulls: base.nulls, dist: base.dist, cell, total };
}

function relationshipLines(ds) {
  const out = [];
  for (const t of ds.tables) {
    for (const c of t.columns) {
      const fk = /REFERENCES\s+(\w+)\s*\((\w+)\)/.exec(c.constraints);
      if (fk) out.push(`- ${code(t.name + '.' + c.name)} → ${code(fk[1] + '.' + fk[2])}`);
    }
  }
  return out;
}

const DOC_HEADER = `# SQL Quest practice datasets - author guide

This document describes the nine practice databases that SQL Quest lessons run on. It is written for **content authors**: use it to find the right dataset for a lesson, to know which values and quirks exist, and to quote exact numbers in exercises.

**Everything below is generated.** The tables, the catalog (\`content/datasets/catalog.json\`) and every number in this file come from \`scripts/gen-datasets.mjs\`, which builds the data with a seeded random number generator and then *queries the generated data* with PGlite to produce the statistics and "handy facts". If you need to change a dataset, change the generator and re-run it; do not edit \`public/datasets/*.sql\` or this file by hand.

\`\`\`bash
node scripts/gen-datasets.mjs      # regenerate SQL, catalog and this document (about a minute)
node scripts/check-datasets.mjs    # load every dataset into a fresh PGlite and run sanity checks
\`\`\`

## Ground rules that hold for every dataset

- **Deterministic and fictional.** Running the generator twice gives byte-identical files. All people, companies, products and movies are invented; all emails use \`example.com\` or \`example.org\`.
- **Fixed dates.** Nothing is relative to today. Each dataset has its own "as of" moment (given below); use literal dates in exercises, never \`CURRENT_DATE\` or \`now()\` for expected results.
- **Ids are explicit and stable** (\`integer PRIMARY KEY\`, no sequences). A row keeps its id forever, so exercises may refer to ids such as \`customer_id = 7\`.
- **Constraints are real.** Primary keys, foreign keys, \`NOT NULL\`, \`UNIQUE\` and \`CHECK\` are enforced; loading a file proves referential integrity. There are **no secondary indexes** (the performance lessons add them) and each file ends with \`ANALYZE;\`.
- **PostgreSQL 18 (PGlite 0.5.8).** The database collation is \`C\`: \`ORDER BY\` on text sorts by byte value, so capital letters sort before lowercase ones ('Zoe' before 'adam'). Names are plain ASCII (no accents).
- **Naming.** Tables and columns are lowercase snake_case and never reserved words.
- **Money** is \`numeric\` (exact) and shown in US dollars unless a column name says otherwise. Result values from \`numeric\` columns come back as strings in the browser; cast with \`::float\` or \`::int\` if a lesson needs numbers.
- **NULL** is used on purpose where the story allows it (unknown email, walk-in customer, order not shipped yet). Each dataset lists its NULLs below.

### How to read the column tables

*NULLs* counts rows where the column is empty. *Distinct* is the number of different non-NULL values. *Range / values* shows the smallest and largest value (and the average for numbers); columns with 12 or fewer different values list every value with the number of rows that have it, e.g. \`'card'\` (98).

`;

async function writeDocs(datasets, opts = {}) {
  const db = new PGlite();
  const q = makeQ(db);
  const out = [DOC_HEADER];

  // overview table
  out.push('## The nine datasets at a glance', '');
  out.push('| id | name | tables | rows | best for |', '|---|---|---|---|---|');
  const BEST = {
    cafe: 'first queries: SELECT, WHERE, ORDER BY, NULL, first JOIN',
    shop: 'joins, GROUP BY, subqueries, CTEs, anti-joins',
    company: 'self joins, recursive CTEs, window functions on salaries',
    movies: 'many-to-many joins, ranking, window functions, sessionization',
    bank: 'running balances, date grouping, outlier / fraud detection',
    app: 'funnels, retention cohorts, sessionization, gaps and islands, JSON',
    school: 'averages, HAVING, ranking, LEFT JOIN with missing data',
    messy: 'data cleaning, deduplication, casting, pivot / unpivot',
    blank: 'CREATE TABLE, INSERT, constraints, indexes',
  };
  for (const ds of datasets) {
    const rows = ds.tables.reduce((a, t) => a + t.rows.length, 0);
    out.push(`| [${ds.id}](#${ds.id}) | ${ds.icon} ${ds.name} | ${ds.tables.length} | ${commas(rows)} | ${BEST[ds.id]} |`);
  }
  out.push('');

  let n = 0;
  for (const ds of datasets) {
    n++;
    if (opts.only && !opts.only.includes(ds.id)) continue;
    const t0 = Date.now();
    out.push(`<a id="${ds.id}"></a>`, '', `## ${n}. ${ds.id} - ${ds.icon} ${ds.name}`, '');
    out.push(`> ${ds.tagline}`, '', ds.description, '');
    if (ds.tables.length === 0) {
      out.push('This database contains **no tables**. The file `public/datasets/blank.sql` is a single comment line, so lessons start from an empty `public` schema.', '');
      out.push('### Notes for authors', '');
      out.push('- Use it for `CREATE TABLE`, `ALTER TABLE`, `INSERT`/`UPDATE`/`DELETE`, constraints and `CREATE INDEX` lessons.');
      out.push('- Each exercise starts from a fresh, empty database, so it is safe to assume no table exists.', '');
      continue;
    }
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await db.exec(ds.sql);
    const info = ds.doc ? await ds.doc(q, ds) : {};

    if (info.about) out.push(info.about, '');
    out.push('### Tables', '');
    out.push('| table | rows | what it holds |', '|---|---|---|');
    for (const t of ds.tables) out.push(`| ${code(t.name)} | ${commas(t.rows.length)} | ${esc(t.description)} |`);
    out.push('');
    out.push('### Relationships', '');
    const rel = relationshipLines(ds);
    out.push(...(rel.length ? rel : ['- none']), '');

    out.push('### Columns', '');
    for (const t of ds.tables) {
      out.push(`#### ${t.name}  (${commas(t.rows.length)} rows)`, '', esc(t.description), '');
      out.push('| column | type | meaning | NULLs | distinct | range / values |', '|---|---|---|---|---|---|');
      for (const c of t.columns) {
        const s = await columnStats(q, t, c);
        const nulls = s.nulls === 0 ? '-' : `${commas(s.nulls)} (${((s.nulls / s.total) * 100).toFixed(1)}%)`;
        const keyNote = '';
        out.push(`| ${code(c.name)} | ${code(c.type)}${keyNote} | ${esc(columnCatalogDescription(t, c))} | ${nulls} | ${commas(s.dist)} | ${esc(s.cell)} |`);
      }
      out.push('');
      const notes = (info.tableNotes || {})[t.name];
      if (notes) out.push(...notes.map((x) => `- ${x}`), '');
    }

    if (info.conventions && info.conventions.length) {
      out.push('### How the data was built (distributions and rules)', '', ...info.conventions.map((x) => `- ${x}`), '');
    }
    if (info.quirks && info.quirks.length) {
      out.push('### Notable facts & deliberate quirks', '', ...info.quirks.map((x) => `- ${x}`), '');
    }
    if (info.facts && info.facts.length) {
      out.push('### Handy facts (exact numbers, computed from the data)', '');
      for (const f of info.facts) {
        out.push(`- **${f.label}:** ${f.text}`, `  - query: ${code(f.sql)}`);
      }
      out.push('');
    }
    if (info.topics && info.topics.length) {
      out.push('### Good lesson topics for this dataset', '', ...info.topics.map((x) => `- ${x}`), '');
    }
    console.log(`docs ${ds.id} ${Date.now() - t0}ms`);
  }

  const target = opts.file || DOCS_FILE;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
  console.log(`wrote ${path.relative(ROOT, target)}`);
}

// =============================================================================
// main
// =============================================================================

const REGISTRY = [
  { build: typeof buildCafe === 'function' ? buildCafe : null, doc: typeof docCafe === 'function' ? docCafe : null },
  { build: typeof buildShop === 'function' ? buildShop : null, doc: typeof docShop === 'function' ? docShop : null },
  { build: typeof buildCompany === 'function' ? buildCompany : null, doc: typeof docCompany === 'function' ? docCompany : null },
  { build: typeof buildMovies === 'function' ? buildMovies : null, doc: typeof docMovies === 'function' ? docMovies : null },
  { build: typeof buildBank === 'function' ? buildBank : null, doc: typeof docBank === 'function' ? docBank : null },
  { build: typeof buildApp === 'function' ? buildApp : null, doc: typeof docApp === 'function' ? docApp : null },
  { build: typeof buildSchool === 'function' ? buildSchool : null, doc: typeof docSchool === 'function' ? docSchool : null },
  { build: typeof buildMessy === 'function' ? buildMessy : null, doc: typeof docMessy === 'function' ? docMessy : null },
  { build: typeof buildBlank === 'function' ? buildBlank : null, doc: typeof docBlank === 'function' ? docBlank : null },
].filter((r) => r.build);

async function main() {
  const args = process.argv.slice(2);
  const skipDocs = args.includes('--skip-docs');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',') : null;

  const datasets = [];
  for (const r of REGISTRY) {
    const t0 = Date.now();
    const ds = r.build();
    ds.doc = r.doc;
    datasets.push(ds);
    if (only && !only.includes(ds.id)) continue;
    fs.mkdirSync(SQL_DIR, { recursive: true });
    const sql = datasetSql(ds);
    ds.sql = sql;
    fs.writeFileSync(path.join(SQL_DIR, `${ds.id}.sql`), sql);
    const counts = ds.tables.map((t) => `${t.name}=${t.rows.length}`).join(' ');
    console.log(
      `${ds.id.padEnd(8)} ${(Buffer.byteLength(sql) / 1024).toFixed(0).padStart(5)} KB  ${Date.now() - t0}ms  ${counts}`,
    );
  }
  if (only) return;

  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(datasets.map(catalogEntry), null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, CATALOG_FILE)}`);

  if (skipDocs) return;
  const docsOnly = args.find((a) => a.startsWith('--docs-only='));
  const docsFile = args.find((a) => a.startsWith('--docs-file='));
  await writeDocs(datasets, {
    only: docsOnly ? docsOnly.slice(12).split(',') : null,
    file: docsFile ? docsFile.slice(12) : null,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
