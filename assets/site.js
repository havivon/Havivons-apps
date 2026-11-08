// Havivon's apps — shared logic for index.html and app.html.
// Data: data/apps.json (versions + downloads, written by sync.py),
//       data/content.json (texts), data/screens.json (icon + screenshots).

const CATEGORIES = {
  android: { label: 'אנדרואיד', icon: 'smartphone' },
  web: { label: 'ווב', icon: 'globe' },
  game: { label: 'משחקים וחידונים', icon: 'gamepad-2' },
  desktop: { label: 'למחשב', icon: 'monitor' },
};

const DOWNLOAD_LABEL = { apk: 'הורדת APK', html: 'הורדת הקובץ', zip: 'הורדה (ZIP)', exe: 'הורדת מתקין', msi: 'הורדת מתקין' };

// ---------- theme ----------
const Theme = {
  init() {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  },
  toggle() {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
  },
};
Theme.init();

// ---------- data ----------
async function getJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? r.json() : {};
  } catch (e) {
    return {};
  }
}

async function loadApps() {
  const [catalog, content, screens] = await Promise.all([
    getJson('data/apps.json'), getJson('data/content.json'), getJson('data/screens.json'),
  ]);
  showSiteUpdated(catalog.generated);
  return (catalog.apps || []).map((a) => {
    const c = content[a.id] || {};
    const s = screens[a.id] || {};
    return {
      ...c, ...a,
      name: c.name || a.id,
      version: a.version || c.version || null,
      icon: s.icon || null,
      screens: s.screens || [],
      features: c.features || [],
      description: c.description || [],
    };
  });
}

// "generated" is the day sync.py last changed the catalog (a new version, download or app)
function showSiteUpdated(iso) {
  if (!iso) return;
  document.querySelectorAll('[data-updated]').forEach((e) => { e.textContent = `עודכן לאחרונה ${fmtDate(iso)}`; });
  document.querySelectorAll('[data-updated-box]').forEach((e) => { e.hidden = false; });
}

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function fmtSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

function withVersion(url, app) {
  // bust the browser cache when a new build replaces downloads/<id>.<ext>
  if (/^https?:/.test(url)) return url;
  return `${url}?v=${encodeURIComponent(app.version || app.updated || '')}`;
}

function iconHtml(app, size) {
  if (app.icon) return `<img src="${esc(app.icon)}" alt="" width="${size}" height="${size}" class="app-icon shrink-0" style="width:${size}px;height:${size}px" loading="lazy">`;
  const cat = CATEGORIES[app.category] || CATEGORIES.web;
  return `<span class="app-icon shrink-0 grid place-items-center bg-accent-soft" style="width:${size}px;height:${size}px"><i data-lucide="${cat.icon}"></i></span>`;
}

function actionButtons(app, { compact = false } = {}) {
  const out = [];
  if (app.download) {
    const label = DOWNLOAD_LABEL[app.download.type] || 'הורדה';
    const size = app.download.size && !compact ? ` <span class="opacity-75 text-sm">· ${fmtSize(app.download.size)}</span>` : '';
    out.push(`<a class="btn btn-primary" href="${esc(withVersion(app.download.url, app))}" download><i data-lucide="download"></i>${label}${size}</a>`);
  }
  if (app.site_download) {
    out.push(`<a class="btn btn-ghost" href="${esc(app.site_download.url)}" download><i data-lucide="folder-down"></i>הורדת האתר (ZIP)</a>`);
  }
  if (app.open) {
    const cls = app.download ? 'btn btn-ghost' : 'btn btn-primary';
    out.push(`<a class="${cls}" href="${esc(app.open)}" target="_blank" rel="noopener"><i data-lucide="external-link"></i>פתח באתר</a>`);
  }
  if (!out.length) out.push(`<span class="btn btn-ghost cursor-default muted"><i data-lucide="hourglass"></i>בקרוב להורדה</span>`);
  return out.join('');
}

function revealOnScroll() {
  const els = document.querySelectorAll('.reveal:not(.in)');
  if (!('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

function icons() { if (window.lucide) lucide.createIcons(); }

// ---------- home ----------
async function renderHome() {
  const apps = await loadApps();
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const search = document.getElementById('search');
  let filter = 'all';

  document.getElementById('count-all').textContent = apps.length;
  document.getElementById('count-android').textContent = apps.filter((a) => a.download?.type === 'apk').length;
  document.getElementById('count-web').textContent = apps.filter((a) => a.open).length;

  const chips = document.getElementById('chips');
  const present = Object.keys(CATEGORIES).filter((k) => apps.some((a) => a.category === k));
  chips.innerHTML = [['all', 'הכול', 'layout-grid'], ...present.map((k) => [k, CATEGORIES[k].label, CATEGORIES[k].icon])]
    .map(([k, label, ic]) => `<button type="button" class="chip inline-flex items-center gap-1.5" data-filter="${k}" aria-pressed="${k === 'all'}"><i data-lucide="${ic}" class="w-4 h-4"></i>${label}</button>`)
    .join('');
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    chips.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    draw();
  });
  search.addEventListener('input', draw);

  function draw() {
    const q = search.value.trim().toLowerCase();
    const list = apps.filter((a) => (filter === 'all' || a.category === filter)
      && (!q || [a.name, a.tagline, a.summary, a.id].join(' ').toLowerCase().includes(q)));
    empty.hidden = list.length > 0;
    grid.innerHTML = list.map((a) => `
      <article class="card reveal surface rounded-3xl p-5 flex flex-col gap-4">
        <a href="app.html?id=${encodeURIComponent(a.id)}" class="flex items-start gap-4 group">
          ${iconHtml(a, 60)}
          <div class="min-w-0">
            <h3 class="font-display text-lg font-semibold leading-tight group-hover:underline decoration-2 underline-offset-4" style="text-decoration-color:var(--accent)">${esc(a.name)}</h3>
            <p class="muted text-sm mt-1">${esc(a.tagline || '')}</p>
          </div>
        </a>
        <p class="text-[15px] leading-relaxed flex-1">${esc(a.summary || '')}</p>
        <div class="flex flex-wrap items-center gap-2 text-xs muted">
          <span class="inline-flex items-center gap-1 surface-2 rounded-full px-2.5 py-1"><i data-lucide="${(CATEGORIES[a.category] || CATEGORIES.web).icon}" class="w-3.5 h-3.5"></i>${(CATEGORIES[a.category] || CATEGORIES.web).label}</span>
          ${a.version ? `<span class="surface-2 rounded-full px-2.5 py-1" dir="ltr">v${esc(a.version)}</span>` : ''}
          ${a.updated ? `<span class="surface-2 rounded-full px-2.5 py-1">עודכן ${fmtDate(a.updated)}</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-2 pt-1">
          ${actionButtons(a, { compact: true })}
          <a class="btn btn-ghost" href="app.html?id=${encodeURIComponent(a.id)}">פרטים<i data-lucide="arrow-left"></i></a>
        </div>
      </article>`).join('');
    icons();
    revealOnScroll();
  }
  draw();
}

// ---------- app page ----------
async function renderApp() {
  const id = new URLSearchParams(location.search).get('id');
  const apps = await loadApps();
  const app = apps.find((a) => a.id === id);
  const root = document.getElementById('app');
  if (!app) {
    root.innerHTML = `<div class="text-center py-24"><p class="font-display text-2xl">האפליקציה לא נמצאה</p><a class="btn btn-primary mt-6" href="./">לכל האפליקציות</a></div>`;
    icons();
    return;
  }
  document.title = `${app.name} · האפליקציות של Havivon`;
  const cat = CATEGORIES[app.category] || CATEGORIES.web;
  const meta = [
    app.version && `<span dir="ltr">v${esc(app.version)}</span>`,
    app.updated && `עודכן ${fmtDate(app.updated)}`,
    app.download?.size && fmtSize(app.download.size),
  ].filter(Boolean).join('<span class="opacity-40 mx-2">•</span>');

  root.innerHTML = `
    <section class="hero-glow rounded-[2rem] surface p-6 sm:p-10 reveal">
      <div class="flex flex-col sm:flex-row sm:items-center gap-6">
        ${iconHtml(app, 104)}
        <div class="flex-1 min-w-0">
          <span class="inline-flex items-center gap-1.5 text-xs font-medium bg-accent-soft rounded-full px-3 py-1"><i data-lucide="${cat.icon}" class="w-3.5 h-3.5"></i>${cat.label}</span>
          <h1 class="font-display text-3xl sm:text-5xl font-bold mt-3 leading-tight">${esc(app.name)}</h1>
          <p class="text-lg sm:text-xl muted mt-2">${esc(app.tagline || '')}</p>
          ${meta ? `<p class="text-sm muted mt-3">${meta}</p>` : ''}
        </div>
      </div>
      <div class="flex flex-wrap gap-3 mt-7">${actionButtons(app)}${app.repo ? `<a class="btn btn-ghost" href="${esc(app.repo)}" target="_blank" rel="noopener"><i data-lucide="github"></i>קוד מקור</a>` : ''}</div>
    </section>

    ${app.screens.length ? `
    <section class="mt-12 reveal" aria-label="צילומי מסך">
      <h2 class="font-display text-2xl font-semibold mb-5">צילומי מסך</h2>
      <div class="shots flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
        ${app.screens.map((s, i) => `
          <figure class="shrink-0 w-[230px] sm:w-[260px]">
            <img class="shot w-full h-auto" src="${esc(s.src)}" alt="${esc(s.caption || '')}" loading="lazy" data-index="${i}">
            ${s.caption ? `<figcaption class="text-sm muted mt-2 leading-snug">${esc(s.caption)}</figcaption>` : ''}
          </figure>`).join('')}
      </div>
    </section>` : ''}

    <section class="grid lg:grid-cols-5 gap-10 mt-12">
      <div class="lg:col-span-3 reveal">
        <h2 class="font-display text-2xl font-semibold mb-4">על האפליקציה</h2>
        <div class="space-y-4 text-[17px] leading-8">${app.description.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      </div>
      <aside class="lg:col-span-2 space-y-4 reveal">
        ${app.requirements ? infoBox('cpu', 'דרישות', app.requirements) : ''}
        ${app.install_notes ? infoBox('package-open', 'איך מתקינים', app.install_notes) : ''}
        ${app.privacy ? infoBox('shield-check', 'פרטיות', app.privacy) : ''}
      </aside>
    </section>

    ${app.features.length ? `
    <section class="mt-14">
      <h2 class="font-display text-2xl font-semibold mb-6 reveal">למה כדאי</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${app.features.map((f) => `
          <div class="card reveal surface rounded-2xl p-5">
            <span class="grid place-items-center w-11 h-11 rounded-xl bg-accent-soft"><i data-lucide="${esc(f.icon || 'sparkles')}"></i></span>
            <h3 class="font-display font-semibold text-lg mt-4">${esc(f.title)}</h3>
            <p class="muted mt-1.5 leading-relaxed">${esc(f.text)}</p>
          </div>`).join('')}
      </div>
    </section>` : ''}

    <section class="mt-16 reveal">
      <h2 class="font-display text-2xl font-semibold mb-5">עוד אפליקציות</h2>
      <div class="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4">
        ${apps.filter((a) => a.id !== app.id).map((a) => `
          <a href="app.html?id=${encodeURIComponent(a.id)}" class="card surface rounded-2xl p-3 flex items-center gap-3 shrink-0 w-64">
            ${iconHtml(a, 44)}
            <span class="min-w-0"><span class="block font-medium truncate">${esc(a.name)}</span><span class="block text-xs muted truncate">${esc(a.tagline || '')}</span></span>
          </a>`).join('')}
      </div>
    </section>`;

  const dlg = document.getElementById('lightbox');
  const big = dlg.querySelector('img');
  let idx = 0;
  const show = (i) => { idx = (i + app.screens.length) % app.screens.length; big.src = app.screens[idx].src; big.alt = app.screens[idx].caption || ''; };
  root.querySelectorAll('.shot').forEach((img) => img.addEventListener('click', () => { show(Number(img.dataset.index)); dlg.showModal(); }));
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  dlg.querySelector('[data-prev]').addEventListener('click', () => show(idx + 1));
  dlg.querySelector('[data-next]').addEventListener('click', () => show(idx - 1));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(idx + 1);
    if (e.key === 'ArrowRight') show(idx - 1);
  });

  icons();
  revealOnScroll();
}

function infoBox(icon, title, text) {
  return `<div class="surface rounded-2xl p-5">
    <h3 class="flex items-center gap-2 font-display font-semibold"><i data-lucide="${icon}" class="w-5 h-5 accent"></i>${title}</h3>
    <p class="muted mt-2 leading-relaxed">${esc(text)}</p>
  </div>`;
}

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => { Theme.toggle(); }));
  document.querySelectorAll('[data-year]').forEach((e) => { e.textContent = new Date().getFullYear(); });
  if (document.body.dataset.page === 'home') renderHome();
  if (document.body.dataset.page === 'app') renderApp();
  icons();
});
