/**
 * Server-side HTML without a template engine: a tagged template that escapes
 * every interpolated value unless it is already `raw()` HTML. Arrays are joined.
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/gu, (c) => ESCAPES[c]);

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Mark a string as trusted HTML. */
export const raw = (value) => new Raw(String(value ?? ''));

const render = (value) => {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
};

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

/** JSON safe to embed inside a <script> element. */
export const jsonForScript = (value) =>
  raw(JSON.stringify(value ?? null).replace(/</gu, '\\u003c').replace(/[\u2028\u2029]/gu, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029')));
