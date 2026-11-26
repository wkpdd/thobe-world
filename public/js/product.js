/* The product landing page: colour → photos, size → stock, quantity capped at stock. */
(function () {
  'use strict';
  var P = window.TW_PRODUCT;
  var S = (window.TW && window.TW.s) || {};
  if (!P) return;
  var root = document.querySelector('[data-product]');
  var state = { color: null, size: null, qty: 1 };
  var pressed = root.querySelector('[data-color][aria-pressed="true"]');
  if (pressed) state.color = pressed.getAttribute('data-color');
  if (!P.colors.length) state.color = null;

  function cell(color, size) {
    var n = P.grid[(color || '') + '||' + (size || '')];
    return typeof n === 'number' && n > 0 ? n : 0;
  }
  /** Exclusive launches: at most this many per customer (null: no cap). */
  var cap = P.maxPerCustomer || null;
  function showQty() {
    var q = root.querySelector('[data-qty-value]');
    if (q) q.textContent = String(state.qty);
  }
  function colourTotal(color) {
    var c = P.colors.filter(function (x) { return x.value === color; })[0];
    return c ? c.stock : 0;
  }
  /** Units available for the current choice, or null when the choice is incomplete. */
  function available() {
    if (!P.isModel) return P.stock;
    var needColor = P.colors.length > 0;
    var needSize = P.sizes.length > 0;
    if ((needColor && !state.color) || (needSize && !state.size)) return null;
    return cell(state.color, state.size);
  }

  function drawStock() {
    var el = root.querySelector('[data-stock]');
    if (!el) return; // a launch not open yet: no stock line, no order form
    var n = available();
    var shown = n === null ? (state.color ? colourTotal(state.color) : P.stock) : n;
    el.className = 'stock';
    if (shown <= 0) {
      el.classList.add('out');
      el.textContent = S.outOfStock;
    } else if (shown === 1) {
      el.classList.add('low');
      el.textContent = S.lastOne;
    } else if (shown <= 5 || P.limited) {
      el.classList.add('low');
      el.innerHTML = '';
      el.appendChild(document.createTextNode((P.limited && S.launch ? S.launch.onlyLeft : S.lowStock).replace('{n}', shown)));
      var bar = document.createElement('span');
      bar.className = 'bar';
      bar.innerHTML = '<i style="width:' + Math.min(100, Math.max(12, shown * 18)) + '%"></i>';
      el.appendChild(bar);
    } else {
      el.classList.add('ok');
      el.textContent = '● ' + S.inStock;
    }
    el.setAttribute('data-available', n === null ? '' : String(n));
    var add = root.querySelector('[data-add-to-cart]');
    if (add) add.disabled = n === 0 || (n === null && shown <= 0);
    if (n !== null && state.qty > Math.max(1, n)) state.qty = Math.max(1, n);
    if (cap && state.qty > cap) state.qty = cap;
    showQty();
    document.dispatchEvent(new CustomEvent('tw:selection'));
  }

  function drawSizes() {
    root.querySelectorAll('[data-size]').forEach(function (b) {
      var size = b.getAttribute('data-size');
      var units = P.colors.length ? (state.color ? cell(state.color, size) : 1) : cell(null, size);
      b.disabled = units <= 0;
      b.setAttribute('aria-pressed', String(size === state.size));
      if (b.disabled && size === state.size) {
        state.size = null;
        b.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function setPhotos(list) {
    if (!list || !list.length) list = P.gallery;
    if (!list || !list.length) return;
    var main = root.querySelector('[data-main-photo] img');
    var thumbs = root.querySelector('[data-thumbs]');
    function show(i) {
      var set = list[i];
      if (!set || !main) return;
      main.src = set.src;
      if (set.srcset) { main.srcset = set.srcset; main.sizes = set.sizes; }
      thumbs.querySelectorAll('button').forEach(function (b, j) { b.setAttribute('aria-pressed', String(i === j)); });
    }
    thumbs.innerHTML = '';
    if (list.length > 1) {
      list.slice(0, 8).forEach(function (set, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(i === 0));
        b.setAttribute('aria-label', P.name + ' ' + (i + 1));
        var img = document.createElement('img');
        img.src = set.src.replace(/\/img\/\d+\//, '/img/160/');
        img.alt = '';
        img.loading = 'lazy';
        img.width = 72; img.height = 72;
        b.appendChild(img);
        b.addEventListener('click', function () { show(i); });
        thumbs.appendChild(b);
      });
    }
    show(0);
  }

  root.querySelectorAll('[data-color]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.color = b.getAttribute('data-color');
      root.querySelectorAll('[data-color]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      var c = P.colors.filter(function (x) { return x.value === state.color; })[0];
      var label = root.querySelector('[data-color-name]');
      if (label && c) label.textContent = c.label;
      setPhotos(c && c.photos);
      drawSizes();
      drawStock();
    });
  });
  root.querySelectorAll('[data-size]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      state.size = b.getAttribute('data-size');
      drawSizes();
      drawStock();
    });
  });
  root.querySelectorAll('[data-thumb]').forEach(function (b, i) {
    b.addEventListener('click', function () {
      var c = P.colors.filter(function (x) { return x.value === state.color; })[0];
      var list = c && c.photos.length ? c.photos : P.gallery;
      var set = list[i];
      var main = root.querySelector('[data-main-photo] img');
      if (set && main) { main.src = set.src; if (set.srcset) main.srcset = set.srcset; }
      root.querySelectorAll('[data-thumb]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
  });
  root.querySelectorAll('[data-qty]').forEach(function (b) {
    b.addEventListener('click', function () {
      var n = available();
      var max = n === null ? 20 : Math.max(1, n);
      if (cap) max = Math.min(max, cap);
      state.qty = Math.min(max, Math.max(1, state.qty + Number(b.getAttribute('data-qty'))));
      showQty();
      document.dispatchEvent(new CustomEvent('tw:selection'));
    });
  });

  /** The order line for the current choice, or an error code. */
  window.TW_LINE = function () {
    var n = available();
    if (n === null) return { error: 'variant' };
    if (n <= 0) return { error: 'stock' };
    return { externalId: P.externalId, color: state.color, size: state.size, quantity: state.qty, price: P.priceNumber };
  };

  function needChoice() {
    var missing = root.querySelector(P.colors.length && !state.color ? '.swatches' : '.sizes');
    if (missing) missing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.TWSite.toast((S.errors && S.errors.variant) || '');
  }

  var add = root.querySelector('[data-add-to-cart]');
  if (add) {
    add.addEventListener('click', function () {
      var line = window.TW_LINE();
      if (line.error === 'variant') return needChoice();
      if (line.error) return;
      window.TWSite.cart.add(line);
      window.TWSite.toast(S.added);
      window.TWSite.track('AddToCart', { value: P.priceNumber * line.quantity, id: P.externalId });
    });
  }
  document.querySelectorAll('[data-scroll-order]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var form = document.getElementById('orderForm') || document.getElementById('notify');
      if (!form) return;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { var f = form.querySelector('input[name=fullName]'); if (f) f.focus({ preventScroll: true }); }, 400);
    });
  });

  // A size alone in stock is chosen for the customer; so is a sole size.
  if (P.sizes.length === 1) state.size = P.sizes[0];
  drawSizes();
  drawStock();
})();
