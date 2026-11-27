/* Shared by every page: cart storage, header, toast, pixels. No framework. */
(function () {
  'use strict';
  var TW = window.TW || { s: {}, events: [] };
  var KEY = 'tw_cart';

  function read() {
    try {
      var list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode: the cart lives for this page only */ }
    count();
  }
  function count() {
    var n = read().reduce(function (s, l) { return s + (Number(l.quantity) || 0); }, 0);
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = String(n);
      el.setAttribute('data-count', String(n));
    });
  }
  var cart = {
    lines: read,
    save: write,
    add: function (line) {
      var list = read();
      var same = list.filter(function (l) { return l.externalId === line.externalId && (l.color || null) === (line.color || null) && (l.size || null) === (line.size || null); })[0];
      if (same) same.quantity = Number(same.quantity) + Number(line.quantity);
      else list.push({ externalId: line.externalId, color: line.color || null, size: line.size || null, quantity: Number(line.quantity) });
      write(list);
    },
    clear: function () { write([]); },
  };

  function money(value) {
    var n = Math.round(Number(value) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + (TW.s.da || 'DA');
  }

  var toastTimer;
  function toast(text) {
    var el = document.querySelector('[data-toast]');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /** Meta / TikTok / GA events, only when the pixel is configured. */
  function track(name, data) {
    data = data || {};
    try {
      if (TW.pixels && TW.pixels.meta && window.fbq) {
        window.fbq('track', name, { value: data.value, currency: data.currency || 'DZD', content_ids: data.id ? [data.id] : undefined, content_name: data.contentName, content_type: 'product' }, data.eventId ? { eventID: data.eventId } : undefined);
      }
      if (TW.pixels && TW.pixels.tiktok && window.ttq) {
        var map = { ViewContent: 'ViewContent', AddToCart: 'AddToCart', InitiateCheckout: 'InitiateCheckout', Purchase: 'CompletePayment', Lead: 'SubmitForm' };
        window.ttq.track(map[name] || name, { value: data.value, currency: data.currency || 'DZD', content_id: data.id }, data.eventId ? { event_id: data.eventId } : undefined);
      }
      if (TW.pixels && TW.pixels.ga && window.gtag) {
        var ga = { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase', Lead: 'generate_lead' };
        window.gtag('event', ga[name] || name, { value: data.value, currency: data.currency || 'DZD', transaction_id: name === 'Purchase' ? data.id : undefined });
      }
      // Google Ads: an order counts as a conversion (the label comes from the dashboard).
      if (name === 'Purchase' && TW.pixels && TW.pixels.adsPurchase && window.gtag) {
        window.gtag('event', 'conversion', { send_to: TW.pixels.adsPurchase, value: data.value, currency: data.currency || 'DZD', transaction_id: data.id });
      }
    } catch (e) { /* a blocked pixel must never break the shop */ }
  }

  window.TWSite = { cart: cart, money: money, toast: toast, track: track };

  document.addEventListener('DOMContentLoaded', function () {
    count();
    (TW.events || []).forEach(function (e) { track(e.name, Object.assign({ eventId: e.id }, e)); });
    var drawer = document.querySelector('[data-drawer]');
    document.querySelectorAll('[data-open-drawer]').forEach(function (b) { b.addEventListener('click', function () { drawer.classList.add('open'); }); });
    document.querySelectorAll('[data-close-drawer]').forEach(function (b) { b.addEventListener('click', function () { drawer.classList.remove('open'); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer) drawer.classList.remove('open'); });
    var bar = document.querySelector('[data-searchbar]');
    document.querySelectorAll('[data-toggle-search]').forEach(function (b) {
      b.addEventListener('click', function () {
        bar.classList.toggle('open');
        if (bar.classList.contains('open')) bar.querySelector('input').focus();
      });
    });
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) count(); });
})();
