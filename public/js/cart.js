/* The basket (/panier) and the checkout's summary (/commande). Prices come from the server. */
(function () {
  'use strict';
  var S = (window.TW && window.TW.s) || {};
  var views = document.querySelectorAll('[data-cart-view]');
  if (!views.length) return;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function render() {
    var stored = window.TWSite.cart.lines();
    if (!stored.length) {
      views.forEach(function (v) { v.innerHTML = '<p class="empty">' + esc(S.cartEmpty) + '</p>'; });
      var sum0 = document.querySelector('[data-cart-sum]');
      if (sum0) sum0.hidden = true;
      document.dispatchEvent(new CustomEvent('tw:cart', { detail: [] }));
      return;
    }
    fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: stored }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var resolved = [];
        var subtotal = 0;
        var blocked = false;
        var html = res.lines.map(function (line, i) {
          var mine = stored[i];
          if (line.missing) return '';
          var qty = Number(mine.quantity);
          var short = line.available < qty;
          if (short) blocked = true;
          subtotal += line.priceNumber * qty;
          resolved.push({ externalId: line.externalId, color: line.color, size: line.size, quantity: qty, price: line.priceNumber });
          var opts = [line.colorLabel, line.size].filter(Boolean).join(' · ');
          return '<div class="line" data-line="' + i + '">' +
            '<div class="th">' + (line.image ? '<img src="' + esc(line.image) + '" alt="" loading="lazy" width="72" height="90">' : '') + '</div>' +
            '<div><h3><a href="' + esc(line.url) + '">' + esc(line.name) + '</a></h3><small>' + esc(opts) + '</small>' +
            (views[0].hasAttribute('data-readonly') ? '<small>× ' + qty + '</small>' :
              '<div class="qty" style="margin-top:6px"><button type="button" data-step="-1" aria-label="−">−</button><span>' + qty + '</span><button type="button" data-step="1" aria-label="+">+</button></div> <button type="button" class="rm" data-remove>' + esc(S.remove) + '</button>') +
            (short ? '<div class="warn">' + (line.available > 0 ? esc(S.lowStock.replace('{n}', line.available)) : esc(S.outOfStock)) + '</div>' : '') +
            '</div><b>' + esc(window.TWSite.money(line.priceNumber * qty)) + '</b></div>';
        }).join('');
        // Drop lines whose article left the catalogue.
        var kept = stored.filter(function (_, i) { return !res.lines[i].missing; });
        if (kept.length !== stored.length) window.TWSite.cart.save(kept);
        views.forEach(function (v) {
          v.innerHTML = html || '<p class="empty">' + esc(S.cartEmpty) + '</p>';
          if (v.hasAttribute('data-readonly')) {
            v.insertAdjacentHTML('beforeend', '<p style="margin-top:8px"><a href="/panier">✎ ' + (window.TW.lang === 'fr' ? 'Modifier le panier' : 'تعديل السلة') + '</a></p>');
          }
        });
        var sum = document.querySelector('[data-cart-sum]');
        if (sum) {
          sum.hidden = !resolved.length;
          sum.querySelector('[data-cart-subtotal]').textContent = window.TWSite.money(subtotal);
          var go = sum.querySelector('[data-cart-checkout]');
          go.setAttribute('aria-disabled', String(blocked));
          go.style.pointerEvents = blocked ? 'none' : '';
          go.style.opacity = blocked ? '.55' : '';
        }
        document.dispatchEvent(new CustomEvent('tw:cart', { detail: blocked ? [] : resolved }));
      });
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest('[data-line]');
    if (!row) return;
    var i = Number(row.getAttribute('data-line'));
    var list = window.TWSite.cart.lines();
    if (!list[i]) return;
    if (e.target.closest('[data-remove]')) list.splice(i, 1);
    var step = e.target.closest('[data-step]');
    if (step) list[i].quantity = Math.max(1, Math.min(50, Number(list[i].quantity) + Number(step.getAttribute('data-step'))));
    else if (!e.target.closest('[data-remove]')) return;
    window.TWSite.cart.save(list);
    render();
  });

  render();
})();
