/* Exclusive launches: the countdown, and « notify me ». */
(function () {
  'use strict';
  var S = (window.TW && window.TW.s) || {};
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var clocks = Array.prototype.slice.call(document.querySelectorAll('[data-countdown]'));
  if (clocks.length) {
    var reloaded = false;
    var tick = function () {
      clocks.forEach(function (el) {
        var left = Math.max(0, Date.parse(el.getAttribute('data-countdown')) - Date.now());
        var units = { d: Math.floor(left / 86400000), h: Math.floor(left / 3600000) % 24, m: Math.floor(left / 60000) % 60, s: Math.floor(left / 1000) % 60 };
        Object.keys(units).forEach(function (k) {
          var b = el.querySelector('[data-unit="' + k + '"]');
          if (b) b.textContent = pad(units[k]);
        });
        // The hour has come: the server now accepts orders, show the page that takes them.
        if (left === 0 && !reloaded) {
          reloaded = true;
          setTimeout(function () { window.location.reload(); }, 1500);
        }
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-notify]'), function (form) {
    var msg = form.querySelector('[data-notify-msg]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('button[type=submit]');
      var f = form.elements; // not form.name: that is the form's own name
      var data = { launch: f.namedItem('launch').value, name: f.namedItem('name').value, phone: f.namedItem('phone').value, website: f.namedItem('website').value };
      button.disabled = true;
      msg.className = 'notify-msg';
      fetch('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          msg.textContent = json.message || '';
          msg.classList.add(json.ok ? 'ok' : 'err');
          if (json.ok) {
            form.classList.add('done');
            if (window.TWSite) window.TWSite.track('Lead', { id: data.launch });
          } else if (json.field === 'phone') {
            f.namedItem('phone').focus();
          }
        })
        .catch(function () {
          msg.textContent = (S.errors && S.errors.generic) || '';
          msg.classList.add('err');
        })
        .then(function () { button.disabled = false; });
    });
  });
})();
