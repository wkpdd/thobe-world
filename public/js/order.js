/* The cash-on-delivery form: delivery (H47 Pay's list), commune, live total, submit. */
(function () {
  'use strict';
  var TW = window.TW || { s: {} };
  var S = TW.s;
  var lang = TW.lang || 'ar';
  var form = document.querySelector('[data-order-form]');
  if (!form) return;
  var options = window.TW_DELIVERY; // null: the shop has not sent its list yet
  var mode = window.TW_MODE || 'product';
  var choice = { wilaya: null, carrier: null, option: null, fee: null };
  var cartLines = [];

  var NAMES = {
    ar: ['أدرار','الشلف','الأغواط','أم البواقي','باتنة','بجاية','بسكرة','بشار','البليدة','البويرة','تمنراست','تبسة','تلمسان','تيارت','تيزي وزو','الجزائر','الجلفة','جيجل','سطيف','سعيدة','سكيكدة','سيدي بلعباس','عنابة','قالمة','قسنطينة','المدية','مستغانم','المسيلة','معسكر','ورقلة','وهران','البيض','إليزي','برج بوعريريج','بومرداس','الطارف','تندوف','تيسمسيلت','الوادي','خنشلة','سوق أهراس','تيبازة','ميلة','عين الدفلى','النعامة','عين تموشنت','غرداية','غليزان','تيميمون','برج باجي مختار','أولاد جلال','بني عباس','عين صالح','عين قزام','تقرت','جانت','المغير','المنيعة'],
    fr: ['Adrar','Chlef','Laghouat','Oum El Bouaghi','Batna','Béjaïa','Biskra','Béchar','Blida','Bouira','Tamanrasset','Tébessa','Tlemcen','Tiaret','Tizi Ouzou','Alger','Djelfa','Jijel','Sétif','Saïda','Skikda','Sidi Bel Abbès','Annaba','Guelma','Constantine','Médéa','Mostaganem',"M'Sila",'Mascara','Ouargla','Oran','El Bayadh','Illizi','Bordj Bou Arréridj','Boumerdès','El Tarf','Tindouf','Tissemsilt','El Oued','Khenchela','Souk Ahras','Tipaza','Mila','Aïn Defla','Naâma','Aïn Témouchent','Ghardaïa','Relizane','Timimoun','Bordj Badji Mokhtar','Ouled Djellal','Béni Abbès','In Salah','In Guezzam','Touggourt','Djanet',"El M'Ghair",'El Meniaa'],
  };
  var names = NAMES[lang] || NAMES.ar;
  var mount = form.querySelector('[data-delivery]');
  var communeSelect = form.querySelector('[data-commune]');

  function loadCommunes(code) {
    communeSelect.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = S.chooseCommune;
    communeSelect.appendChild(first);
    communeSelect.disabled = true;
    if (!code) return;
    var padded = (code < 10 ? '0' : '') + code;
    fetch('/data/communes/' + padded + '.json').then(function (r) { return r.json(); }).then(function (list) {
      list.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c[1];
        o.textContent = lang === 'fr' ? c[1] : c[0] + ' — ' + c[1];
        communeSelect.appendChild(o);
      });
      communeSelect.disabled = false;
    }).catch(function () { communeSelect.disabled = false; });
  }

  function onDelivery(next) {
    var wilayaChanged = next.wilaya !== choice.wilaya;
    choice = next;
    if (wilayaChanged) loadCommunes(next.wilaya);
    clearError('wilaya');
    clearError('delivery');
    summary();
  }

  if (options && window.H47Delivery) {
    window.H47Delivery.mount(mount, {
      options: options,
      lang: lang === 'fr' ? 'fr' : 'ar',
      wilayaNames: names.reduce(function (m, n, i) { m[String(i + 1)] = n; return m; }, {}),
      onChange: onDelivery,
    });
  } else {
    // No list from H47 Pay yet: every wilaya, fee confirmed by phone.
    var label = document.createElement('label');
    label.className = 'fld';
    label.textContent = lang === 'fr' ? 'Wilaya' : 'الولاية';
    var select = document.createElement('select');
    select.className = 'in';
    select.name = 'wilaya';
    select.required = true;
    select.innerHTML = '<option value="">' + (lang === 'fr' ? 'Choisir…' : 'اختر…') + '</option>' + names.map(function (n, i) {
      var c = i + 1;
      return '<option value="' + c + '">' + (c < 10 ? '0' : '') + c + ' — ' + n + '</option>';
    }).join('');
    select.addEventListener('change', function () { onDelivery({ wilaya: select.value ? Number(select.value) : null, carrier: null, option: null, fee: null }); });
    label.appendChild(select);
    mount.appendChild(label);
    var opt = document.createElement('div');
    opt.className = 'h47d';
    opt.innerHTML = '<label><input type="radio" name="delivery_option" value="home" checked> ' + (lang === 'fr' ? 'À domicile' : 'إلى المنزل') + '</label><label><input type="radio" name="delivery_option" value="stopdesk"> ' + (lang === 'fr' ? 'Point relais' : 'مكتب التوصيل') + '</label>';
    mount.appendChild(opt);
  }

  function lines() {
    if (mode === 'product') {
      var line = window.TW_LINE ? window.TW_LINE() : { error: 'variant' };
      return line.error ? line : [line];
    }
    return cartLines;
  }
  function subtotal() {
    var l = lines();
    if (!Array.isArray(l)) return null;
    return l.reduce(function (s, x) { return s + (Number(x.price) || 0) * Number(x.quantity); }, 0);
  }
  function summary() {
    var sub = subtotal();
    var fee = choice.fee === null || choice.fee === undefined ? null : Number(choice.fee);
    var subEl = form.querySelector('[data-sum-sub]');
    var shipEl = form.querySelector('[data-sum-ship]');
    var totEl = form.querySelector('[data-sum-total]');
    subEl.textContent = sub === null ? '—' : window.TWSite.money(sub);
    shipEl.textContent = fee === null ? (options ? '—' : S.shippingTbd) : fee === 0 ? (lang === 'fr' ? 'Gratuite' : 'مجاني') : window.TWSite.money(fee);
    totEl.textContent = sub === null ? '—' : window.TWSite.money(sub + (fee || 0));
  }
  document.addEventListener('tw:selection', summary);
  document.addEventListener('tw:cart', function (e) { cartLines = e.detail || []; summary(); });

  function showError(field, message) {
    var box = form.querySelector('[data-err="' + field + '"]');
    var input = form.querySelector('[name="' + field + '"]');
    if (box) box.textContent = message || '';
    if (input) input.setAttribute('aria-invalid', 'true');
    var top = form.querySelector('[data-form-error]');
    if (!box && top) { top.textContent = message; top.classList.add('show'); }
  }
  function clearError(field) {
    var box = form.querySelector('[data-err="' + field + '"]');
    var input = form.querySelector('[name="' + field + '"]');
    if (box) box.textContent = '';
    if (input) input.removeAttribute('aria-invalid');
  }
  form.addEventListener('input', function (e) { if (e.target.name) clearError(e.target.name); });

  var started = false;
  form.addEventListener('focusin', function () {
    if (started) return;
    started = true;
    window.TWSite.track('InitiateCheckout', { value: subtotal() || 0 });
  });

  function normalizePhone(value) {
    var d = String(value || '').replace(/[\s().\-]/g, '').replace(/[٠-٩]/g, function (c) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)); });
    if (d.indexOf('+213') === 0) d = '0' + d.slice(4);
    else if (d.indexOf('00213') === 0) d = '0' + d.slice(5);
    return /^0[567]\d{8}$/.test(d) ? d : null;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var top = form.querySelector('[data-form-error]');
    top.classList.remove('show');
    var data = new FormData(form);
    var errors = [];
    var l = lines();
    if (!Array.isArray(l)) {
      if (l.error === 'variant') errors.push(['lines', S.errors.variant]);
      else errors.push(['lines', S.outOfStock]);
    } else if (!l.length) errors.push(['lines', S.cartEmpty]);
    if (String(data.get('fullName') || '').trim().length < 3) errors.push(['fullName', S.errors.name]);
    if (!normalizePhone(data.get('phone'))) errors.push(['phone', S.errors.phone]);
    var wilaya = data.get('wilaya');
    if (!wilaya) errors.push(['wilaya', S.errors.wilaya]);
    else if (!data.get('commune')) errors.push(['commune', S.errors.commune]);
    var option = data.get('delivery_option');
    if (wilaya && options && (!option || choice.fee === null)) errors.push(['delivery', S.errors.delivery]);
    if (errors.length) {
      errors.forEach(function (x) { showError(x[0], x[1]); });
      var firstField = form.querySelector('[aria-invalid="true"]') || form.querySelector('.ferr:not(:empty)') || top;
      if (errors[0][0] === 'lines' && mode === 'product') {
        var picker = document.querySelector('.swatches, .sizes');
        if (picker) picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.TWSite.toast(errors[0][1]);
      } else if (firstField) firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var button = form.querySelector('[data-submit]');
    var label = button.textContent;
    button.disabled = true;
    button.textContent = S.sending;
    var body = {
      fullName: data.get('fullName'),
      phone: data.get('phone'),
      wilaya: Number(wilaya),
      commune: data.get('commune'),
      address: data.get('address'),
      notes: data.get('notes'),
      carrier: data.get('delivery_carrier') || choice.carrier || null,
      deliveryOption: option || 'home',
      website: data.get('website'),
      lines: l.map(function (x) { return { externalId: x.externalId, color: x.color, size: x.size, quantity: x.quantity }; }),
    };
    fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.body && res.body.ok) {
          if (mode === 'cart') window.TWSite.cart.clear();
          window.location.href = res.body.redirect;
          return;
        }
        button.disabled = false;
        button.textContent = label;
        var msg = (res.body && res.body.message) || S.errors.generic;
        if (res.body && res.body.field && form.querySelector('[data-err="' + res.body.field + '"]')) showError(res.body.field, msg);
        else { top.textContent = msg; top.classList.add('show'); }
        top.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = label;
        top.textContent = S.errors.generic;
        top.classList.add('show');
      });
  });

  summary();
})();
