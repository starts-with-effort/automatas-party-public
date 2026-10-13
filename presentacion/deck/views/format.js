// Formato de estados, símbolos y descripciones instantáneas para HTML y SVG, con subíndices de
// verdad (q₀, Z₀, p_f) y colores con significado fijo.
import { splitSymbol } from '../pda/pda.js';
import { escapeHtml } from '../ui.js';

// Mismos valores que party.css y deck.css (GSAP necesita colores concretos para interpolar).
export const COLORS = {
  ink: '#1c1640',
  paper: '#efebff',
  surface: '#ffffff',
  sun: '#ffc93c',
  pink: '#ff4f8b',
  ok: '#128a52',
  okSoft: '#d8f5e6',
  bad: '#e8384f',
  badSoft: '#ffe0e5',
  muted: '#5d5785',
  dim: '#e4e0f3',
};

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  parent?.append(el);
  return el;
}

export function htmlEl(tag, className = '', html = '', parent = null) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  parent?.append(el);
  return el;
}

// ------------------------------------------------------------ HTML
export function symHtml(name) {
  const { base, sub } = splitSymbol(name);
  return sub ? `${escapeHtml(base)}<sub>${escapeHtml(sub)}</sub>` : escapeHtml(base);
}
export const stackHtml = (stack) => (stack.length ? stack.map(symHtml).join('') : 'ε');
export const inputHtml = (input) => (input ? escapeHtml(input) : 'ε');
export const idHtml = (id) => `(${symHtml(id.state)}, ${inputHtml(id.input)}, ${stackHtml(id.stack)})`;
export const transitionHtml = (tr) => `${tr.read ? escapeHtml(tr.read) : 'ε'}, ${symHtml(tr.top)} / ${stackHtml(tr.push)}`;

// ------------------------------------------------------------ SVG (dentro de un <text>)
// El subíndice usa baseline-shift: no mueve el texto que sigue.
export function symSvg(name) {
  const { base, sub } = splitSymbol(name);
  return sub ? `${escapeHtml(base)}<tspan class="sub" baseline-shift="-0.18em">${escapeHtml(sub)}</tspan>` : escapeHtml(base);
}
export const stackSvg = (stack) => (stack.length ? stack.map(symSvg).join('') : 'ε');
export const idSvg = (id) => `(${symSvg(id.state)}, ${id.input ? escapeHtml(id.input) : 'ε'}, ${stackSvg(id.stack)})`;
export const transitionSvg = (tr) => `${tr.read ? escapeHtml(tr.read) : 'ε'}, ${symSvg(tr.top)} / ${stackSvg(tr.push)}`;

// Rótulos a mano: «ε, {Z0} / ε» → Z₀ con formato de símbolo; «P_N» → P con subíndice N.
export function richSvg(text) {
  return escapeHtml(text)
    .replace(/\{([A-Za-z0-9]+)\}/g, (_, name) => symSvg(name))
    .replace(/\b([A-Za-z])_([A-Za-z0-9]+)/g, '$1<tspan class="sub" baseline-shift="-0.18em">$2</tspan>');
}
export function richHtml(text) {
  return escapeHtml(text)
    .replace(/\{([A-Za-z0-9]+)\}/g, (_, name) => symHtml(name))
    .replace(/\b([A-Za-z])_([A-Za-z0-9]+)/g, '$1<sub>$2</sub>');
}
