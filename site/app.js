(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const grid = $('#grid');
  const statusEl = $('#status');
  const modal = $('#modal');
  const stage = $('#stage');

  const state = { items: [], site: {}, query: '', lastFocus: null };

  /* ---------- helpers ---------- */

  // Only ever allow http(s) links from the data files.
  function safeUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      const u = new URL(value, location.href);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  }

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...kids.filter(Boolean));
    return node;
  }

  const playIcon = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z');
    p.setAttribute('fill', 'currentColor');
    svg.append(p);
    return svg;
  };

  async function loadJSON(url, inline) {
    if (inline) return inline;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  /* ---------- reel link → how to show it ---------- */

  function parseReel(raw) {
    const href = safeUrl(raw);
    if (!href) return null;
    const u = new URL(href);
    const host = u.hostname.replace(/^(www|m)\./, '');

    if (host === 'instagram.com' || host === 'instagr.am') {
      const m = u.pathname.match(/\/(reels?|p|tv)\/([\w-]+)/);
      if (m) {
        const kind = m[1] === 'reels' ? 'reel' : m[1];
        const base = `https://www.instagram.com/${kind}/${m[2]}/`;
        return { type: 'embed', src: base + 'embed/', open: base, label: 'Open on Instagram' };
      }
    }

    let yt = '';
    if (host === 'youtube.com') {
      const s = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
      yt = s ? s[1] : u.searchParams.get('v') || '';
    } else if (host === 'youtu.be') {
      yt = u.pathname.slice(1).split('/')[0];
    }
    if (/^[\w-]{6,}$/.test(yt)) {
      return {
        type: 'embed',
        src: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&playsinline=1&rel=0`,
        open: href,
        label: 'Open on YouTube',
      };
    }

    if (/\.(mp4|mov|webm|m4v)$/i.test(u.pathname)) {
      return { type: 'video', src: href, open: href, label: 'Open video' };
    }
    return { type: 'link', open: href, label: 'Open reel' };
  }

  /* ---------- cards ---------- */

  function placeholder(item) {
    const ph = el('div', { class: 'ph', 'aria-hidden': 'true' }, el('span', { text: `#${item.id}` }));
    ph.style.setProperty('--h', String((Number(item.id) * 47) % 360));
    return ph;
  }

  function renderCard(item) {
    const reel = parseReel(item.reel);
    const buy = safeUrl(item.product);
    const img = safeUrl(item.image);
    const label = state.site.buyLabel || 'Get yours here';

    const media = img ? el('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : placeholder(item);
    if (img) media.addEventListener('error', () => media.replaceWith(placeholder(item)), { once: true });

    const posterKids = [media, el('span', { class: 'badge', text: `#${item.id}` })];
    if (item.sample) posterKids.push(el('span', { class: 'chip', text: 'Sample' }));
    if (reel) posterKids.push(el('span', { class: 'play' }, playIcon()));

    let poster;
    if (reel) {
      poster = el('button', { class: 'poster', type: 'button', 'data-watch': item.id, 'aria-label': `Watch reel: ${item.title}` }, ...posterKids);
    } else if (buy) {
      poster = el('a', { class: 'poster', href: buy, target: '_blank', rel: 'noopener sponsored', 'aria-label': `${label}: ${item.title}` }, ...posterKids);
    } else {
      poster = el('div', { class: 'poster' }, ...posterKids);
    }

    const actions = el('div', { class: 'actions' });
    if (buy) actions.append(el('a', { class: 'btn primary', href: buy, target: '_blank', rel: 'noopener sponsored', text: label }));
    if (reel) actions.append(el('button', { class: 'btn ghost', type: 'button', 'data-watch': item.id, text: 'Watch reel' }));

    return el(
      'article',
      { class: 'card' },
      poster,
      el('div', { class: 'body' }, el('h2', { text: item.title }), item.description ? el('p', { class: 'desc', text: item.description }) : null, actions)
    );
  }

  function matches(item, q) {
    if (!q) return true;
    const hay = `${item.id} #${item.id} ${item.title} ${item.description || ''}`.toLowerCase();
    return q.split(/\s+/).every((t) => hay.includes(t));
  }

  function render() {
    const q = state.query.trim().toLowerCase();
    const list = state.items.filter((i) => matches(i, q));
    grid.replaceChildren(...list.map(renderCard));

    const n = list.length;
    $('#count').textContent = q ? `${n} match${n === 1 ? '' : 'es'}` : `${n} product${n === 1 ? '' : 's'}`;
    statusEl.hidden = n > 0 || !state.items.length;
    if (!statusEl.hidden) statusEl.textContent = 'Nothing matches that search.';
  }

  /* ---------- player modal ---------- */

  function openReel(id) {
    const item = state.items.find((i) => String(i.id) === String(id));
    const reel = item && parseReel(item.reel);
    if (!reel) return;

    state.lastFocus = document.activeElement;
    stage.replaceChildren();

    if (reel.type === 'embed') {
      stage.append(
        el('iframe', {
          src: reel.src,
          title: `Reel: ${item.title}`,
          allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: true,
          referrerpolicy: 'strict-origin-when-cross-origin',
        })
      );
    } else if (reel.type === 'video') {
      stage.append(el('video', { src: reel.src, controls: true, autoplay: true, playsinline: true, loop: true, 'aria-label': item.title }));
    } else {
      stage.append(el('p', { class: 'stage-note', text: 'This reel opens on its original site.' }));
    }

    $('#mNum').textContent = `#${item.id}`;
    $('#mTitle').textContent = item.title;

    const buy = safeUrl(item.product);
    const mBuy = $('#mBuy');
    mBuy.hidden = !buy;
    if (buy) {
      mBuy.href = buy;
      mBuy.textContent = state.site.buyLabel || 'Get yours here';
    }
    const mOpen = $('#mOpen');
    mOpen.href = reel.open;
    mOpen.textContent = reel.label;

    modal.hidden = false;
    document.body.classList.add('modal-open');
    modal.querySelector('.close').focus();
    history.replaceState(null, '', `#${item.id}`);
  }

  function closeReel() {
    if (modal.hidden) return;
    stage.replaceChildren(); // removing the player also stops playback
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    history.replaceState(null, '', location.pathname + location.search);
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
  }

  document.addEventListener('click', (e) => {
    const watch = e.target.closest('[data-watch]');
    if (watch) return openReel(watch.getAttribute('data-watch'));
    if (e.target.closest('[data-close]')) closeReel();
  });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') return closeReel();
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button, a[href], video[controls]')].filter((n) => !n.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- site settings ---------- */

  function inkFor(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#14110a' : '#ffffff';
  }

  function applySite(site) {
    if (site.name) {
      $('#brand').textContent = site.name;
      document.title = site.heading ? `${site.heading} · ${site.name}` : site.name;
    }
    const logo = safeUrl(site.logo);
    if (logo) {
      const img = document.createElement('img');
      img.className = 'logo';
      img.src = logo;
      img.alt = '';
      img.addEventListener('error', () => img.remove(), { once: true }); // no logo file yet: just show the name
      $('#brand').prepend(img);
      const icon = document.querySelector('link[rel="icon"]');
      if (icon) { icon.href = logo; icon.removeAttribute('type'); }
    }
    if (site.heading) $('#heroTitle').textContent = site.heading;
    if (site.tagline != null) $('#heroTag').textContent = site.tagline;

    const ig = safeUrl(site.instagram);
    if (ig) {
      const a = $('#igLink');
      a.href = ig;
      a.hidden = false;
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(site.accent || '')) {
      document.documentElement.style.setProperty('--accent', site.accent);
      document.documentElement.style.setProperty('--accent-ink', inkFor(site.accent));
    }
    $('#disclosure').textContent = site.disclosure || '';
  }

  /* ---------- start ---------- */

  async function init() {
    try {
      const [site, items] = await Promise.all([
        loadJSON('data/site.json', window.__SITE__).catch(() => ({})),
        loadJSON('data/reels.json', window.__REELS__),
      ]);
      state.site = site || {};
      // Numbers always run 1, 2, 3... in the order cards were added, even if some were deleted.
      const list = (Array.isArray(items) ? items : []).filter((i) => i && i.title).sort((a, b) => Number(a.id) - Number(b.id));
      list.forEach((item, i) => { item.id = i + 1; });
      state.items = list.reverse();
    } catch (err) {
      statusEl.hidden = false;
      statusEl.textContent = "Couldn't load the list. If you opened this file straight from disk, view it through a web server or GitHub Pages instead.";
      console.error(err);
      return;
    }

    applySite(state.site);
    $('#sampleNote').hidden = !state.items.some((i) => i.sample);
    $('#q').addEventListener('input', (e) => { state.query = e.target.value; render(); });

    if (!state.items.length) {
      $('#count').textContent = '';
      statusEl.hidden = false;
      statusEl.textContent = 'No reels yet. Check back soon.';
      return;
    }
    render();

    const m = location.hash.match(/^#(\d+)$/);
    if (m) openReel(m[1]);
  }

  init();
})();
