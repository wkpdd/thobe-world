// Website dashboard: picture uploads, product search, confirmations. No framework.
(() => {
  for (const box of document.querySelectorAll('[data-upload]')) {
    const file = box.querySelector('[data-file]');
    const value = box.querySelector('[data-value]');
    const preview = box.querySelector('[data-preview]');
    const status = box.querySelector('[data-status]');
    const drop = box.querySelector('.drop');
    const hint = status.textContent;
    file.addEventListener('change', async () => {
      const picked = file.files?.[0];
      if (!picked) return;
      if (picked.size > 15 * 1024 * 1024) {
        status.textContent = 'Image trop lourde (15 Mo au plus).';
        return;
      }
      drop.classList.add('busy');
      status.textContent = 'Envoi de l’image…';
      try {
        const res = await fetch('/admin/media', { method: 'POST', headers: { 'content-type': picked.type || 'image/jpeg' }, body: picked, credentials: 'same-origin' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.message || `Erreur ${res.status}`);
        value.value = json.name;
        preview.src = json.src;
        preview.hidden = false;
        status.textContent = 'Image prête. Pensez à enregistrer.';
      } catch (error) {
        status.textContent = `L’image n’a pas été envoyée : ${error.message}`;
      } finally {
        drop.classList.remove('busy');
        file.value = '';
      }
    });
    box.querySelector('[data-clear]')?.addEventListener('click', () => {
      value.value = '';
      preview.hidden = true;
      status.textContent = hint;
    });
  }

  // A required picture must be uploaded before the form is sent.
  for (const form of document.querySelectorAll('form.form')) {
    form.addEventListener('submit', (event) => {
      const missing = [...form.querySelectorAll('[data-value][data-required]')].find((i) => !i.value);
      if (missing) {
        event.preventDefault();
        const status = missing.closest('[data-upload]').querySelector('[data-status]');
        status.textContent = 'Ajoutez d’abord cette image.';
        missing.closest('[data-upload]').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  const picker = document.querySelector('[data-picker]');
  if (picker) {
    const items = [...picker.querySelectorAll('.pitem')];
    const count = picker.querySelector('[data-picked]');
    picker.querySelector('[data-filter]').addEventListener('input', (event) => {
      const q = event.target.value.trim().toLowerCase();
      for (const item of items) item.hidden = Boolean(q) && !item.dataset.name.includes(q);
    });
    picker.addEventListener('change', () => {
      count.textContent = `${picker.querySelectorAll('input[type=checkbox]:checked').length} choisi(s)`;
    });
  }

  for (const form of document.querySelectorAll('form[data-confirm]')) {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  }
})();
