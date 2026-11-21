#!/usr/bin/env node
/**
 * Adds (or updates) one entry in site/data/reels.json.
 *
 * Needs a product link. Optionally takes a reel link, a title and a description.
 * Title, description and image are read from the product page. If the product
 * page is on Shopify and has a video attached, that video is used as the reel.
 *
 * Runs in GitHub Actions (see .github/workflows/add-reel.yml) or locally:
 *   node scripts/add-reel.mjs <product-url> [reel-url]
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'site', 'data', 'reels.json');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BOT_UA = 'Mozilla/5.0 (compatible; Twitterbot/1.0)';

class UserError extends Error {}

/* ---------- small text helpers ---------- */

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', trade: '™', reg: '®', copy: '©',
};

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[g.toLowerCase()] ?? m;
  });
}

export function stripHtml(html = '') {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

export function truncate(s = '', max = 240) {
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
}

export function cleanTitle(title = '', siteName = '') {
  let t = decodeEntities(title).replace(/\s+/g, ' ').trim();
  if (siteName) {
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*[|\\-–—:·•]\\s*${esc}\\s*$`, 'i'), '');
  } else {
    // No site name to compare with: a trailing "| Store Name" is almost always the shop, not the product.
    const trimmed = t.replace(/\s+\|\s+[^|]{2,40}$/, '');
    if (trimmed.length >= 6) t = trimmed;
  }
  return truncate(t, 120);
}

function titleFromSlug(url) {
  const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
  const words = last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim();
  return words ? truncate(words.replace(/\b\w/g, (c) => c.toUpperCase()), 100) : '';
}

/* ---------- urls ---------- */

export function firstUrl(text = '') {
  const m = String(text).match(/https?:\/\/[^\s<>)\]"']+/);
  return m ? m[0] : '';
}

export function httpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

export function normKey(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    // Amazon has many addresses for one product; the 10-character product code is the same in all of them.
    if (/(^|\.)amazon\./.test(host)) {
      const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (m) return 'amazon:' + m[1].toUpperCase();
    }
    return host + u.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function siteUrl(env) {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes('/')) return '';
  const [owner, name] = repo.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}

/* ---------- reading the inputs ---------- */

// GitHub issue forms arrive as "### Label\n\nvalue" blocks.
export function parseIssue(title = '', body = '') {
  const sections = {};
  let current = null;
  for (const line of String(body).replace(/\r/g, '').split('\n')) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) { current = h[1].toLowerCase(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  const get = (prefix) => {
    const key = Object.keys(sections).find((k) => k.startsWith(prefix));
    if (!key) return '';
    const v = sections[key].join('\n').trim();
    return v === '_No response_' ? '' : v;
  };
  const urls = `${title}\n${body}`.match(/https?:\/\/[^\s<>)\]"']+/g) || [];
  const out = {
    product: get('product link'),
    reel: get('reel'),
    image: get('product image'),
    title: get('title'),
    description: get('description'),
    card: get('card number'),
    action: get('action'),
  };
  // Fallback for an issue that was not created with the form.
  if (!out.product && urls[0]) out.product = urls[0];
  if (!out.reel && !Object.keys(sections).length && urls[1]) out.reel = urls[1];
  return out;
}

function resolveInputs(env, argv) {
  if (env.EVENT_NAME === 'issues') return parseIssue(env.ISSUE_TITLE, env.ISSUE_BODY);
  const [product, reel] = argv;
  return {
    product: env.IN_PRODUCT || product || '',
    reel: env.IN_REEL || reel || '',
    image: env.IN_IMAGE || '',
    title: env.IN_TITLE || '',
    description: env.IN_DESCRIPTION || '',
    card: env.IN_CARD || '',
    action: env.IN_ACTION || '',
  };
}

/* ---------- reading the product page ---------- */

async function fetchPage(url, ua) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': ua,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    const text = (await res.text()).slice(0, 1_500_000);
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, text };
  } finally {
    clearTimeout(timer);
  }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`[\\s"']${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

export function extractMeta(html, baseUrl) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') || attr(m[0], 'name') || attr(m[0], 'itemprop') || '').toLowerCase();
    const content = attr(m[0], 'content');
    if (key && content != null && !(key in meta)) meta[key] = decodeEntities(content).trim();
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta['og:title'] || meta['twitter:title'] || (titleTag ? decodeEntities(titleTag[1]).trim() : '');
  const description = meta['og:description'] || meta['twitter:description'] || meta['description'] || '';
  let image = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  if (image) {
    try { image = new URL(image, baseUrl).href; } catch { image = ''; }
  }
  return { title, description, image, siteName: meta['og:site_name'] || '' };
}

// Shopify stores expose clean product data at /products/<handle>.js
async function fromShopify(pageUrl) {
  let u;
  try { u = new URL(pageUrl); } catch { return null; }
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return null;
  const res = await fetchPage(`${u.origin}/products/${m[1].replace(/\.js$/, '')}.js`, BROWSER_UA);
  if (!res.ok) return null;
  let p;
  try { p = JSON.parse(res.text); } catch { return null; }
  if (!p || !p.title) return null;

  const abs = (s) => { try { return new URL(s, u.origin).href; } catch { return ''; } };
  const image = abs(p.featured_image || (p.images && p.images[0]) || '');

  let video = '';
  for (const media of p.media || []) {
    if (media.media_type === 'video' && Array.isArray(media.sources)) {
      const mp4 = media.sources
        .filter((s) => /mp4/i.test(s.format || s.mime_type || ''))
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      if (mp4 && mp4.url) { video = abs(mp4.url); break; }
    } else if (media.media_type === 'external_video' && media.host === 'youtube' && media.external_id) {
      video = `https://www.youtube.com/watch?v=${encodeURIComponent(media.external_id)}`;
      break;
    }
  }
  return { title: p.title, description: stripHtml(p.description || ''), image, video };
}

async function getProductInfo(productUrl, warnings) {
  const info = { title: '', description: '', image: '', video: '', finalUrl: productUrl };
  let lastProblem = '';

  for (const ua of [BROWSER_UA, BOT_UA]) {
    try {
      const page = await fetchPage(productUrl, ua);
      info.finalUrl = page.finalUrl;
      if (!page.ok) { lastProblem = `HTTP ${page.status}`; continue; }
      const meta = extractMeta(page.text, page.finalUrl);
      if (meta.title) {
        info.title = cleanTitle(meta.title, meta.siteName);
        info.description = meta.description;
        info.image = meta.image;
        lastProblem = '';
        break;
      }
      lastProblem = 'the page has no title';
    } catch (e) {
      lastProblem = e.name === 'AbortError' ? 'the request timed out' : String(e.message || e);
    }
  }

  try {
    const shop = await fromShopify(info.finalUrl);
    if (shop) {
      info.title = cleanTitle(shop.title) || info.title;
      info.description = shop.description || info.description;
      info.image = shop.image || info.image;
      info.video = shop.video;
      lastProblem = '';
    }
  } catch { /* not a Shopify product, that is fine */ }

  if (lastProblem) warnings.push(`Couldn't read the product page (${lastProblem}), so some details are missing.`);
  return info;
}

/* ---------- data file ---------- */

async function readData() {
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new UserError(`reels.json is not valid JSON, so nothing was changed (${e.message}).`);
  }
}

/* ---------- main ---------- */

async function writeSummary(env, text) {
  console.log(text);
  if (env.SUMMARY_FILE) await writeFile(env.SUMMARY_FILE, text + '\n');
}

async function setOutputs(env, outputs) {
  if (!env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}`);
  await appendFile(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

export async function run(env = process.env, argv = process.argv.slice(2)) {
  const inputs = resolveInputs(env, argv);
  const warnings = [];

  const cardRaw = String(inputs.card || '').trim().replace(/^#/, '');
  const cardId = /^\d+$/.test(cardRaw) ? Number(cardRaw) : 0;
  if (cardRaw && !cardId) throw new UserError('The card number should be just a number, like 2.');

  // Deleting a card needs only its number.
  if (/^delete/i.test(String(inputs.action || '').trim())) {
    if (!cardId) throw new UserError('To delete a card, type its number in the "Card number" box.');
    const all = await readData();
    const target = all.find((e) => Number(e.id) === cardId);
    if (!target) throw new UserError(`There is no card number ${cardId}, so nothing was deleted.`);
    await writeFile(DATA_FILE, JSON.stringify(all.filter((e) => e !== target), null, 2) + '\n');
    await writeSummary(env, `🗑️ Deleted **#${target.id}: ${target.title}**\nIt disappears from the site in about a minute.`);
    await setOutputs(env, {
      id: target.id,
      status: 'deleted',
      commit_message: truncate(`Delete reel #${target.id}: ${target.title}`, 90),
    });
    return { entry: target, status: 'deleted', warnings };
  }

  const product = httpUrl(firstUrl(inputs.product));
  if (!product) throw new UserError('I need a product link that starts with http:// or https://.');

  let reel = '';
  if (inputs.reel) {
    reel = httpUrl(firstUrl(inputs.reel));
    if (!reel) warnings.push("The reel link didn't look like a web link, so it was ignored.");
  }

  // Image given by hand: a web link, or the file name of a picture uploaded into the site folder.
  let imageOverride = '';
  const rawImage = (inputs.image || '').trim();
  if (rawImage) {
    if (/^[\w\-.]+\.(png|jpe?g|webp|gif|avif)$/i.test(rawImage) && !rawImage.includes('..')) imageOverride = rawImage;
    else imageOverride = httpUrl(firstUrl(rawImage));
    if (!imageOverride) warnings.push("The product image link didn't look like a web link or an image file name, so it was ignored.");
  }

  const info = await getProductInfo(product, warnings);

  // Sample entries are removed as soon as the first real one arrives.
  const data = (await readData()).filter((e) => !e.sample);
  let existing;
  if (cardId) {
    // The card number wins over link matching.
    existing = data.find((e) => Number(e.id) === cardId);
    if (!existing) throw new UserError(`There is no card number ${cardId}, so nothing was changed.`);
  } else {
    const keys = new Set([normKey(product), normKey(info.finalUrl)]);
    existing = data.find((e) => keys.has(normKey(e.product)));
  }

  const title = inputs.title.trim() ? truncate(inputs.title.trim(), 140) : info.title || titleFromSlug(product);
  if (!existing && !inputs.title.trim() && !info.title) warnings.push('No title could be read, so one was made from the link. Send the link again with a Title to fix it.');

  let description = inputs.description.trim() || truncate(info.description, 240);
  if (description.toLowerCase() === title.toLowerCase()) description = '';

  const today = new Date().toISOString().slice(0, 10);
  let entry;
  let status;

  if (existing) {
    status = 'updated';
    entry = existing;
    if (cardId) entry.product = product;
    if (reel) entry.reel = reel;
    else if (!entry.reel && info.video) entry.reel = info.video;
    if (inputs.title.trim()) entry.title = title;
    if (inputs.description.trim()) entry.description = description;
    if (!entry.description && description) entry.description = description;
    if (imageOverride) entry.image = imageOverride;
    else if (!entry.image && info.image) entry.image = info.image;
  } else {
    status = 'added';
    const id = data.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0) + 1;
    entry = {
      id,
      title,
      description,
      image: imageOverride || info.image || '',
      reel: reel || info.video || '',
      product,
      added: today,
    };
    data.push(entry);
  }

  if (!entry.reel) warnings.push('No reel is attached yet. The card shows the product image and link. To attach the reel later, send the same product link again with the reel link filled in.');
  if (!entry.image) warnings.push('No product image was found, so the card uses a colored placeholder.');

  data.sort((a, b) => Number(b.id) - Number(a.id));
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');

  const site = siteUrl(env);
  const link = site ? `${site}#${entry.id}` : '';
  const lines = [
    `${status === 'added' ? '✅ Added' : '🔄 Updated'} **#${entry.id}: ${entry.title}**`,
    link ? `It goes live in about a minute: ${link}` : '',
    warnings.length ? '\nHeads up:\n' + warnings.map((w) => `- ${w}`).join('\n') : '',
  ].filter(Boolean);
  await writeSummary(env, lines.join('\n'));

  await setOutputs(env, {
    id: entry.id,
    status,
    commit_message: truncate(`${status === 'added' ? 'Add' : 'Update'} reel #${entry.id}: ${entry.title}`, 90),
  });
  return { entry, status, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async (err) => {
    const msg = err instanceof UserError ? err.message : `Unexpected error: ${err && err.message ? err.message : err}`;
    try { await writeSummary(process.env, `❌ ${msg}`); } catch { console.error(msg); }
    process.exit(1);
  });
}
