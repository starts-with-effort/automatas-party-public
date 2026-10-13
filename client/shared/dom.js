// h('div', { class: 'card', onClick: fn, style: { '--team': color } }, 'texto', otroNodo)
// Construye nodos con textContent: el texto que viene del servidor nunca se interpreta como HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') setStyle(el, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  appendChildren(el, children);
  return el;
}

export function replace(container, ...children) {
  container.replaceChildren();
  appendChildren(container, children);
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

function setStyle(el, style) {
  for (const [name, value] of Object.entries(style)) {
    if (name.startsWith('--')) el.style.setProperty(name, value);
    else el.style[name] = value;
  }
}
