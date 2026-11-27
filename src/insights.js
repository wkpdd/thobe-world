/**
 * « Idées »: what the numbers suggest doing, in plain French. Each rule only
 * speaks when there is enough data for it to mean something.
 */
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const fmt = (n) => Number(n).toLocaleString('fr-FR');

export function insights(r) {
  const out = [];
  const add = (kind, title, text) => out.push({ kind, title, text });
  const visitors = r.kpis.visitors.value;

  // Demand the catalogue does not answer.
  for (const s of r.searches.filter((x) => x.zero >= 3).slice(0, 3)) {
    add('demande', `On cherche « ${s.term} »`, `${fmt(s.zero)} recherche(s) sans aucun résultat. Ajoutez cet article dans H47 Pay, ou ce mot dans la description d’un article proche.`);
  }
  for (const p of r.products.filter((x) => x.soldOutViews >= 10).sort((a, b) => b.soldOutViews - a.soldOutViews).slice(0, 3)) {
    add('stock', `Réapprovisionner « ${p.name} »`, `Vu ${fmt(p.soldOutViews)} fois alors qu’il était épuisé : ce sont des ventes perdues.`);
  }
  // Articles that attract but do not sell, and the reverse.
  for (const p of r.products.filter((x) => x.views >= 40 && (x.conversion ?? 0) < 1 && (x.stock ?? 1) > 0).slice(0, 3)) {
    add('article', `« ${p.name} » attire mais vend peu`, `${fmt(p.views)} vues pour ${fmt(p.orders)} commande(s). Vérifiez le prix, les photos (couleurs, porté), les tailles disponibles et la description.`);
  }
  const stars = r.products.filter((x) => x.views >= 20 && (x.conversion ?? 0) >= 5).sort((a, b) => b.conversion - a.conversion).slice(0, 2);
  for (const p of stars) {
    add('article', `« ${p.name} » convertit très bien`, `${p.conversion} % des visiteurs qui le voient le commandent. Mettez-le dans le carrousel ou en publicité.`);
  }
  // Sizes and colours that sell.
  if (r.sales.sizes.length >= 2 && r.sales.itemsSold >= 10) {
    const [first, second] = r.sales.sizes;
    add('stock', `La taille ${first.key} part le plus`, `${fmt(first.value)} pièces, devant la ${second.key} (${fmt(second.value)}). Gardez-en davantage en stock.`);
  }
  // Funnel leaks.
  const cart = r.funnel.find((f) => f.step === 'Ajouts au panier').value;
  const form = r.funnel.find((f) => f.step === 'Formulaire de commande').value;
  if (form >= 10 && r.sales.orders / form < 0.5) {
    add('tunnel', 'Des formulaires abandonnés', `${fmt(form)} clients ont commencé le formulaire, ${fmt(r.sales.orders)} l’ont envoyé. Un numéro WhatsApp visible et la livraison annoncée tôt rassurent.`);
  }
  if (cart >= 10 && form / cart < 0.4) {
    add('tunnel', 'Des paniers oubliés', `${fmt(cart)} ajouts au panier pour ${fmt(form)} passages à la commande. Le bouton « Commander maintenant » sur la page article convertit mieux que le panier.`);
  }
  // Where customers come from.
  const sources = r.traffic.sources;
  const totalSources = sources.reduce((a, s) => a + s.value, 0);
  if (totalSources >= 30 && sources[0]) {
    add('marketing', `${sources[0].key} amène ${Math.round((sources[0].value / totalSources) * 100)} % des visiteurs`, `${sources.slice(1, 4).map((s) => `${s.key} ${Math.round((s.value / totalSources) * 100)} %`).join(', ') || 'Aucune autre source notable'}. Ajoutez ?utm_source=…&utm_campaign=… à vos liens publicitaires pour voir quelle campagne rapporte.`);
  }
  const inApp = r.traffic.browsers.filter((b) => /in-app/u.test(b.key)).reduce((a, b) => a + b.value, 0);
  const allBrowsers = r.traffic.browsers.reduce((a, b) => a + b.value, 0);
  if (allBrowsers >= 30 && inApp / allBrowsers >= 0.3) {
    add('marketing', `${Math.round((inApp / allBrowsers) * 100)} % ouvrent le site dans Facebook, Instagram ou TikTok`, 'Ces navigateurs intégrés sont lents et oublient le panier : gardez le formulaire sur la page article (déjà le cas) et des photos légères.');
  }
  // When to post.
  // A best hour or day only means something when the orders are spread out.
  const spread = (list) => list.filter((v) => v > 0).length;
  const byOrders = r.sales.orders >= 10 && spread(r.sales.hours) >= 4;
  const hours = byOrders ? r.sales.hours : r.traffic.hours;
  const hoursTotal = hours.reduce((a, b) => a + b, 0);
  if (hoursTotal >= 30 && spread(hours) >= 4) {
    const best = hours.indexOf(Math.max(...hours));
    add('marketing', `Le meilleur moment : vers ${best} h`, `C’est l’heure où ${byOrders ? 'les commandes' : 'les visites'} sont les plus nombreuses. Publiez et lancez vos publicités un peu avant.`);
  }
  if (r.sales.orders >= 14 && spread(r.sales.weekdays) >= 4) {
    const w = r.sales.weekdays;
    add('marketing', `Le ${DAYS[w.indexOf(Math.max(...w))]} vend le plus`, `Et le ${DAYS[w.indexOf(Math.min(...w))]} le moins. Gardez vos lancements et promotions pour les bons jours.`);
  }
  // Delivery: where returns and cancellations cost money.
  for (const w of r.sales.wilayas.filter((x) => x.orders >= 5 && (x.returned + x.cancelled) / x.orders >= 0.3).slice(0, 3)) {
    add('livraison', `${w.name} : beaucoup de commandes perdues`, `${w.returned} retour(s) et ${w.cancelled} annulation(s) sur ${w.orders} commandes. Confirmez par téléphone avant l’envoi, ou proposez le point relais (stop desk).`);
  }
  if (r.sales.returnRate !== null && r.sales.returnRate >= 15) {
    add('livraison', `Taux de retour élevé : ${r.sales.returnRate} %`, 'Chaque colis retourné coûte la livraison aller-retour. Les numéros déjà signalés « colis retourné » sont marqués dans H47 Pay : appelez-les avant d’expédier.');
  }
  // Loyalty.
  if (r.sales.orders >= 10) {
    const share = Math.round((r.sales.returningCustomers / r.sales.orders) * 100);
    add('fidélité', `${share} % de clients qui reviennent`, share < 15 ? 'Peu de clients reviennent : un petit mot dans le colis avec votre Instagram et une remise pour la prochaine commande aide.' : 'Vos clients reviennent : un lancement exclusif « réservé aux clients » les récompenserait.');
  }
  // Launches.
  for (const l of r.marketing.launches.filter((x) => x.subscribers >= 5)) {
    add('lancement', `« ${l.title} » : ${fmt(l.subscribers)} inscrits`, 'Écrivez-leur sur WhatsApp à l’ouverture (Lancements → Inscrits) : ce sont vos acheteurs les plus chauds.');
  }
  // Broken links.
  for (const nf of r.traffic.notFound.filter((x) => x.value >= 5).slice(0, 2)) {
    add('technique', `Lien cassé : ${nf.key}`, `${fmt(nf.value)} visiteurs sont tombés sur une page introuvable. Corrigez le lien là où il est publié.`);
  }
  // The most useful first, at most eight: a list nobody reads helps nobody.
  const order = ['demande', 'stock', 'livraison', 'article', 'tunnel', 'lancement', 'marketing', 'fidélité', 'technique'];
  out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  out.splice(8);
  if (!out.length) {
    add('info', 'Pas encore assez de données', visitors ? 'Les idées apparaissent quand il y a assez de visites et de commandes pour en tirer quelque chose (quelques dizaines).' : 'Les statistiques commencent maintenant : revenez dans quelques jours.');
  }
  return out;
}
