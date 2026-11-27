/**
 * « Statistiques » in the dashboard. Charts are SVG drawn here on the server
 * (the dashboard's CSP allows no inline script or style): one series per chart,
 * in the shop's dark gold, a hover title on every mark, and the numbers in a
 * table next to each chart, so nothing depends on seeing the colour.
 */
import { html, raw } from '../html.js';

const INK = '#1F1B16';
const MUTED = '#6B6255';
const GRID = '#E6DCCB';
const MARK = '#8A6A2E'; // 4.7:1 on white: readable as a mark and as text
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR'));
const da = (n) => (n === null || n === undefined ? '—' : `${fmt(Math.round(n))} DA`);
const esc = (s) => String(s).replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Round axis maximum: 1, 2, 5 × 10^n. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const tickLabel = (v) => (v >= 10_000 ? `${Math.round(v / 1000)}K` : fmt(v));

function axes({ w, h, pad, max }) {
  const ticks = [0, max / 2, max];
  return ticks.map((t) => {
    const y = pad.t + (h - pad.t - pad.b) * (1 - t / max);
    return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${MUTED}">${tickLabel(t)}</text>`;
  }).join('');
}

/** Values over days: a 2px line on a 10 % wash, hover dots, the last value labelled. */
export function lineChart(points, { label, format = fmt }) {
  const w = 720;
  const h = 220;
  const pad = { t: 16, r: 46, b: 26, l: 44 };
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const x = (i) => pad.l + (points.length < 2 ? 0 : ((w - pad.l - pad.r) * i) / (points.length - 1));
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
  const every = Math.max(1, Math.ceil(points.length / 8));
  const lastIndex = points.length - 1;
  const xLabels = points.map((p, i) => ((i % every === 0 && lastIndex - i >= every / 2) || i === lastIndex ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(p.short ?? p.label)}</text>` : '')).join('');
  const dots = points.map((p, i) => `<g><title>${esc(p.label)} : ${esc(format(p.value))}</title><circle cx="${x(i)}" cy="${y(p.value)}" r="9" fill="transparent"/>${i === points.length - 1 ? `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${MARK}" stroke="#fff" stroke-width="2"/>` : ''}</g>`).join('');
  const last = points.at(-1);
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${axes({ w, h, pad, max })}<path d="${area}" fill="${MARK}" fill-opacity="0.1"/><path d="${line}" fill="none" stroke="${MARK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${last ? `<text x="${x(points.length - 1) + 8}" y="${y(last.value) + 4}" font-size="12" font-weight="600" fill="${INK}">${esc(format(last.value))}</text>` : ''}${xLabels}</svg>`);
}

/** Counts per bucket (days, hours): columns ≤ 24 px, rounded tops, the highest labelled. */
export function columnChart(points, { label, format = fmt }) {
  const w = 720;
  const h = 200;
  const pad = { t: 18, r: 12, b: 26, l: 44 };
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const band = (w - pad.l - pad.r) / Math.max(1, points.length);
  const bw = Math.min(24, band - 2);
  const base = h - pad.b;
  const best = points.reduce((b, p, i) => (p.value > (points[b]?.value ?? -1) ? i : b), 0);
  const every = Math.max(1, Math.ceil(points.length / 12));
  const bars = points.map((p, i) => {
    const cx = pad.l + band * i + band / 2;
    const bh = ((h - pad.t - pad.b) * p.value) / max;
    const r = Math.min(4, bh / 2, bw / 2);
    const x0 = cx - bw / 2;
    const top = base - bh;
    const d = bh > 0 ? `M${x0} ${base}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + bw - r}Q${x0 + bw} ${top} ${x0 + bw} ${top + r}V${base}Z` : '';
    return `<g><title>${esc(p.label)} : ${esc(format(p.value))}</title><rect x="${cx - band / 2}" y="${pad.t}" width="${band}" height="${h - pad.t - pad.b}" fill="transparent"/>${d ? `<path d="${d}" fill="${MARK}"/>` : ''}${i === best && p.value > 0 ? `<text x="${cx}" y="${top - 5}" text-anchor="middle" font-size="11" font-weight="600" fill="${INK}">${esc(format(p.value))}</text>` : ''}${i % every === 0 ? `<text x="${cx}" y="${h - 8}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(p.short ?? p.label)}</text>` : ''}</g>`;
  }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${axes({ w, h, pad, max })}${bars}</svg>`);
}

/** A share bar inside a table cell (the number is always written next to it). */
const meter = (value, max) => raw(`<svg class="meter" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="8" rx="4" fill="${GRID}"/><rect width="${max > 0 ? Math.max(value > 0 ? 2 : 0, (100 * value) / max) : 0}" height="8" rx="4" fill="${MARK}"/></svg>`);

function rankTable(rows, { key = 'Élément', value = 'Nombre', empty = 'Rien pour l’instant.', format = fmt }) {
  if (!rows.length) return html`<p class="muted small">${empty}</p>`;
  const max = Math.max(...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return html`<table class="table rank"><thead><tr><th>${key}</th><th class="num">${value}</th><th class="num">Part</th><th class="meter-cell"></th></tr></thead><tbody>
  ${rows.map((r) => html`<tr><td>${r.key}</td><td class="num">${format(r.value)}</td><td class="num">${total ? `${Math.round((r.value / total) * 100)} %` : '—'}</td><td class="meter-cell">${meter(r.value, max)}</td></tr>`)}
  </tbody></table>`;
}

const change = (k) => {
  if (k.change === null || k.change === undefined) return html`<span class="delta">—</span>`;
  const up = k.change >= 0;
  return html`<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(k.change)} %</span>`;
};
const tile = (label, k, format = fmt, hint = '') => html`<div class="tile"><span class="lbl">${label}</span><b>${format(k.value)}</b><span class="vs">${change(k)} vs période précédente</span>${hint ? html`<span class="muted small">${hint}</span>` : ''}</div>`;

const STATUS = { pending: 'En attente', confirmed: 'Confirmées', shipped: 'Expédiées', delivered: 'Livrées', cancelled: 'Annulées', returned: 'Retournées' };
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const shortDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function statsBody({ report, ideas, period, ip }) {
  const r = report;
  const s = r.sales;
  const periods = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']];
  const funnelMax = Math.max(1, ...r.funnel.map((f) => f.value));
  return html`<div class="head"><h1>Statistiques</h1>
    <nav class="tabs" aria-label="Période">${periods.map(([d, l]) => html`<a href="/admin/statistiques?p=${d}"${d === period ? raw(' aria-current="page"') : ''}>${l}</a>`)}</nav>
  </div>
  <p class="muted">Du ${shortDate(r.period.from)} au ${shortDate(r.period.to)} (heure d’Alger). Mesuré par le site lui-même depuis le ${shortDate(r.since)} : sans cookie, sans adresse IP conservée, rien n’est envoyé à un tiers. Les ventes viennent des commandes de H47 Pay.</p>

  <section class="tiles">
    ${tile('Visiteurs', r.kpis.visitors, fmt, 'un même appareil compte une fois par jour')}
    ${tile('Pages vues', r.kpis.views)}
    ${tile('Commandes', r.kpis.orders)}
    ${tile('Chiffre d’affaires', r.kpis.revenue, da, 'articles, hors annulées et livraison')}
    ${tile('Panier moyen', r.kpis.averageOrder, da)}
    ${tile('Taux de conversion', r.kpis.conversion, (v) => `${fmt(v)} %`, 'commandes ÷ visiteurs')}
  </section>

  <section class="card">
    <h2>Idées</h2>
    <p class="muted small">Ce que les chiffres de la période suggèrent.</p>
    <ul class="ideas">${ideas.map((i) => html`<li class="idea ${i.kind}"><span class="tag">${i.kind}</span><b>${i.title}</b><span>${i.text}</span></li>`)}</ul>
  </section>

  <section class="grid2">
    <div class="card"><h2>Visiteurs par jour</h2><p class="muted small">Le dernier point est aujourd’hui, encore en cours.</p>${lineChart(r.daily.map((d) => ({ label: d.date, short: shortDate(d.date), value: d.visitors })), { label: 'Visiteurs par jour' })}</div>
    <div class="card"><h2>Commandes par jour</h2>${columnChart(r.daily.map((d) => ({ label: `${d.date} · ${da(d.revenue)}`, short: shortDate(d.date), value: d.orders })), { label: 'Commandes par jour' })}</div>
  </section>

  <section class="card">
    <h2>Du visiteur à la commande</h2>
    <table class="table funnel"><tbody>${r.funnel.map((f, i) => html`<tr><td>${f.step}</td><td class="num"><b>${fmt(f.value)}</b></td><td class="num muted">${i && r.funnel[i - 1].value ? `${Math.round((f.value / r.funnel[i - 1].value) * 100)} % de l’étape précédente` : ''}</td><td class="meter-cell">${meter(f.value, funnelMax)}</td></tr>`)}</tbody></table>
  </section>

  <section class="card">
    <h2>Articles</h2>
    <p class="muted small">Vues, ajouts au panier et commandes de la période. « Vu épuisé » : des visites sur un article sans stock, donc des ventes manquées.</p>
    ${r.products.length ? html`<div class="scroll"><table class="table"><thead><tr><th>Article</th><th class="num">Vues</th><th class="num">Panier</th><th class="num">Commandes</th><th class="num">Pièces</th><th class="num">Ventes</th><th class="num">Conversion</th><th class="num">Stock</th><th class="num">Vu épuisé</th></tr></thead><tbody>
    ${r.products.slice(0, 40).map((p) => html`<tr><td>${p.name}</td><td class="num">${fmt(p.views)}</td><td class="num">${fmt(p.cartAdds)}</td><td class="num">${fmt(p.orders)}</td><td class="num">${fmt(p.units)}</td><td class="num">${da(p.revenue)}</td><td class="num">${p.conversion === null ? '—' : `${p.conversion} %`}</td><td class="num">${fmt(p.stock)}</td><td class="num">${p.soldOutViews ? html`<b>${fmt(p.soldOutViews)}</b>` : '0'}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted small">Rien pour l’instant.</p>`}
  </section>

  <section class="grid2">
    <div class="card"><h2>D’où viennent les visiteurs</h2>${rankTable(r.traffic.sources, { key: 'Source', value: 'Visiteurs' })}
      ${r.traffic.campaigns.length ? html`<h3>Campagnes (liens avec utm_…)</h3>${rankTable(r.traffic.campaigns, { key: 'source / support / campagne', value: 'Visiteurs' })}` : html`<p class="muted small">Astuce : ajoutez <code>?utm_source=instagram&amp;utm_campaign=aid</code> à vos liens publicitaires pour voir chaque campagne ici.</p>`}</div>
    <div class="card"><h2>Recherches sur le site</h2>
      ${r.searches.length ? html`<table class="table"><thead><tr><th>Recherche</th><th class="num">Fois</th><th class="num">Sans résultat</th></tr></thead><tbody>${r.searches.map((q) => html`<tr><td>${q.term}</td><td class="num">${fmt(q.n)}</td><td class="num">${q.zero ? html`<b>${fmt(q.zero)}</b> <span class="muted small">aucun article</span>` : '0'}</td></tr>`)}</tbody></table>` : html`<p class="muted small">Aucune recherche pour l’instant.</p>`}</div>
  </section>

  <section class="grid2">
    <div class="card"><h2>Commandes par statut</h2>
      <table class="table"><tbody>${Object.entries(STATUS).map(([k, l]) => html`<tr><td>${l}</td><td class="num">${fmt(s.statuses[k] ?? 0)}</td></tr>`)}</tbody></table>
      <p class="small">Confirmation : <b>${s.confirmationRate ?? '—'} %</b> · Annulation : <b>${s.cancellationRate ?? '—'} %</b> · Retours : <b>${s.returnRate ?? '—'} %</b> des expédiées</p>
      <p class="small">Clients : <b>${fmt(s.newCustomers)}</b> nouveaux · <b>${fmt(s.returningCustomers)}</b> déjà venus · ${fmt(s.itemsSold)} pièces · livraison facturée ${da(s.deliveryFees)}</p></div>
    <div class="card"><h2>Livraison</h2>
      ${rankTable(s.carriers, { key: 'Société', value: 'Commandes' })}
      ${rankTable(s.deliveryTypes.map((t) => ({ ...t, key: t.key === 'stopdesk' ? 'Point relais (stop desk)' : 'À domicile' })), { key: 'Mode', value: 'Commandes' })}</div>
  </section>

  <section class="card">
    <h2>Par wilaya</h2>
    ${s.wilayas.length ? html`<div class="scroll"><table class="table"><thead><tr><th>Wilaya</th><th class="num">Commandes</th><th class="num">Ventes</th><th class="num">Livrées</th><th class="num">Retours</th><th class="num">Annulées</th><th class="meter-cell"></th></tr></thead><tbody>
    ${s.wilayas.map((w) => html`<tr><td>${String(w.code).padStart(2, '0')} · ${w.name}</td><td class="num">${fmt(w.orders)}</td><td class="num">${da(w.revenue)}</td><td class="num">${fmt(w.delivered)}</td><td class="num">${fmt(w.returned)}</td><td class="num">${fmt(w.cancelled)}</td><td class="meter-cell">${meter(w.orders, s.wilayas[0].orders)}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted small">Aucune commande sur la période.</p>`}
  </section>

  <section class="grid2">
    <div class="card"><h2>Tailles commandées</h2>${rankTable(s.sizes, { key: 'Taille', value: 'Pièces' })}</div>
    <div class="card"><h2>Couleurs commandées</h2>${rankTable(s.colors, { key: 'Couleur', value: 'Pièces' })}</div>
  </section>

  <section class="grid2">
    <div class="card"><h2>Visites selon l’heure</h2>${columnChart(r.traffic.hours.map((v, h) => ({ label: `${h} h`, short: `${h}h`, value: v })), { label: 'Visites selon l’heure' })}</div>
    <div class="card"><h2>Commandes selon l’heure</h2>${columnChart(s.hours.map((v, h) => ({ label: `${h} h`, short: `${h}h`, value: v })), { label: 'Commandes selon l’heure' })}
      <h3>Selon le jour</h3>${columnChart(s.weekdays.map((v, i) => ({ label: DAYS[i], value: v })), { label: 'Commandes selon le jour' })}</div>
  </section>

  <section class="grid3">
    <div class="card"><h2>Appareils</h2>${rankTable(r.traffic.devices, { key: 'Appareil', value: 'Visiteurs' })}</div>
    <div class="card"><h2>Navigateurs</h2>${rankTable(r.traffic.browsers, { key: 'Navigateur', value: 'Visiteurs' })}</div>
    <div class="card"><h2>Systèmes · langue</h2>${rankTable(r.traffic.systems, { key: 'Système', value: 'Visiteurs' })}${rankTable(r.traffic.languages.map((l) => ({ ...l, key: l.key === 'fr' ? 'Français' : 'Arabe' })), { key: 'Langue', value: 'Pages' })}</div>
  </section>

  <section class="grid2">
    <div class="card"><h2>Pages les plus vues</h2>${rankTable(r.traffic.pages, { key: 'Page', value: 'Vues' })}</div>
    <div class="card"><h2>Sites qui envoient des visiteurs</h2>${rankTable(r.traffic.referrers, { key: 'Site', value: 'Visiteurs' })}
      <h2>Pages introuvables (404)</h2>${rankTable(r.traffic.notFound, { key: 'Adresse', value: 'Fois', empty: 'Aucune.' })}</div>
  </section>

  <section class="grid2">
    <div class="card"><h2>Lancements</h2>${r.marketing.launches.length ? html`<table class="table"><thead><tr><th>Lancement</th><th class="num">Vues de la page</th><th class="num">Inscrits « prévenez-moi »</th></tr></thead><tbody>${r.marketing.launches.map((l) => html`<tr><td>${l.title}</td><td class="num">${fmt(l.views)}</td><td class="num">${fmt(l.subscribers)}</td></tr>`)}</tbody></table>` : html`<p class="muted small">Aucun lancement.</p>`}</div>
    <div class="card"><h2>Carrousel</h2>${r.marketing.slideClicks.length ? rankTable(r.marketing.slideClicks.map((c) => ({ key: c.title, value: c.clicks })), { key: 'Diapositive', value: 'Clics' }) : html`<p class="muted small">Aucun clic sur une diapositive pour l’instant.</p>`}</div>
  </section>

  <section class="card">
    <h2>Exporter · relier à H47 Pay</h2>
    <p class="small">Télécharger : <a href="/admin/statistiques.json?p=${period}">rapport complet (JSON)</a> · <a href="/admin/statistiques.csv?p=${period}&amp;t=jours">jours (CSV)</a> · <a href="/admin/statistiques.csv?p=${period}&amp;t=articles">articles (CSV)</a> · <a href="/admin/statistiques.csv?p=${period}&amp;t=wilayas">wilayas (CSV)</a> · <a href="/admin/statistiques.csv?p=${period}&amp;t=recherches">recherches (CSV)</a></p>
    <p class="small">Le même rapport (avec les idées) est servi à H47 Pay ou au hub à l’adresse <code>/api/stats.json?days=30</code>, avec l’en-tête <code>X-NewStore-Key</code> (la clé de synchronisation). Aucun nom, téléphone ni adresse n’y figure : seulement des nombres et des montants.</p>
    <p class="muted small">Votre adresse vue par le site : <code>${ip ?? 'inconnue'}</code>. Si elle n’est pas la vôtre, signalez-le : les limites par appareil en dépendent.</p>
  </section>`;
}

const csvCell = (v) => {
  const t = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/u.test(t) ? `'${t}` : t).replace(/"/gu, '""')}"`;
};
export function statsCsv(report, table) {
  const rows = {
    jours: [['date', 'visiteurs', 'pages_vues', 'commandes', 'ventes_da'], ...report.daily.map((d) => [d.date, d.visitors, d.views, d.orders, d.revenue])],
    articles: [['article', 'vues', 'paniers', 'commandes', 'pieces', 'ventes_da', 'conversion_pct', 'stock', 'vu_epuise'], ...report.products.map((p) => [p.name, p.views, p.cartAdds, p.orders, p.units, p.revenue, p.conversion ?? '', p.stock ?? '', p.soldOutViews])],
    wilayas: [['code', 'wilaya', 'commandes', 'ventes_da', 'livrees', 'retours', 'annulees'], ...report.sales.wilayas.map((w) => [w.code, w.name, w.orders, w.revenue, w.delivered, w.returned, w.cancelled])],
    recherches: [['recherche', 'fois', 'sans_resultat'], ...report.searches.map((q) => [q.term, q.n, q.zero])],
  }[table];
  if (!rows) return null;
  return `﻿${rows.map((r) => r.map(csvCell).join(';')).join('\n')}\n`;
}
