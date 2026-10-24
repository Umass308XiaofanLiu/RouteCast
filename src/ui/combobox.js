// combobox.js — accessible place search (ARIA 1.2 combobox with listbox popup).
import { geocode } from '../lib/providers.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createCombobox({ input, list, hint, onSelect, fetchImpl }) {
  let results = [];
  let active = -1;
  let timer = null;
  let ctrl = null;
  let selected = null;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const render = (msg) => {
    list.innerHTML = '';
    if (msg) {
      list.innerHTML = `<li class="empty" role="option" aria-disabled="true">${escapeHtml(msg)}</li>`;
    } else {
      results.forEach((r, i) => {
        const li = document.createElement('li');
        li.id = `${list.id}-opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === active ? 'true' : 'false');
        li.innerHTML = `<span>${escapeHtml(r.label)}</span><small>${escapeHtml(r.detail || '')}</small>`;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(i);
        });
        list.appendChild(li);
      });
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-opt-${active}`);
  };

  const choose = (i) => {
    const r = results[i];
    if (!r) return;
    set(r);
    close();
    onSelect?.(r);
  };

  function set(place) {
    selected = place;
    input.value = place ? place.label : '';
    input.removeAttribute('aria-invalid');
    hint.textContent = place ? `${place.timezone.replace('_', ' ')}` : '';
  }

  async function search(q) {
    ctrl?.abort();
    ctrl = new AbortController();
    render('Searching…');
    try {
      results = (await geocode(q, { fetchImpl, signal: ctrl.signal })).slice(0, 8);
      active = results.length ? 0 : -1;
      render(results.length ? null : 'No US place found');
    } catch (e) {
      if (e?.name === 'AbortError' || ctrl.signal.aborted) return;
      results = [];
      render('Place search is unavailable — try a demo trip');
    }
  }

  input.addEventListener('input', () => {
    selected = null;
    hint.textContent = '';
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(() => search(q), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      if (active >= 0 && results[active]) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  return {
    get value() {
      return selected;
    },
    set,
    /** Resolve free text to the best match if the user did not pick from the list. */
    async resolve() {
      if (selected) return selected;
      const q = input.value.trim();
      if (q.length < 2) return null;
      const r = await geocode(q, { fetchImpl });
      if (r[0]) set(r[0]);
      return r[0] || null;
    },
  };
}
