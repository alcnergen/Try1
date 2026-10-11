// Stil arka planları: SVG olarak üretilip sharp (librsvg) ile rasterleştirilir.
// "variant" yeniden üretimlerde aynı stilin farklı bir yorumunu seçer.

export const STYLES = {
  studio: { label: 'Beyaz stüdyo', fill: 0.8 },
  warm: { label: 'Sıcak ton', fill: 0.78 },
  pastel: { label: 'Pastel', fill: 0.76 },
  dark: { label: 'Koyu stüdyo', fill: 0.74 },
  lifestyle: { label: 'Yaşam alanı', fill: 0.66 },
};

const pick = (list, variant) => list[((variant % list.length) + list.length) % list.length];

function grain(id) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="3"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
  </filter>`;
}

function studio(W, H, c1, c2, cx, cy) {
  return `<defs>
      <radialGradient id="bg" cx="${cx}" cy="${cy}" r="0.85"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>
      <linearGradient id="fl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity="0"/><stop offset="1" stop-color="${c2}" stop-opacity="0.85"/></linearGradient>
      ${grain('gr')}
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect y="${H * 0.7}" width="${W}" height="${H * 0.3}" fill="url(#fl)"/>
    <rect width="${W}" height="${H}" filter="url(#gr)"/>`;
}

function plant(x, y, s, flip) {
  const leaves = [];
  for (let k = 0; k < 11; k++) {
    const a = -150 + k * 12;
    const L = 160 + ((k * 37) % 90);
    const r = (a * Math.PI) / 180;
    const cx = (Math.cos(r) * L) / 2;
    const cy = (Math.sin(r) * L) / 2;
    const g = ['#4f6b4a', '#5d7b55', '#435f40', '#6b8a5f'][k % 4];
    leaves.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${(L / 2).toFixed(0)}" ry="${(L / 7).toFixed(0)}" transform="rotate(${a} ${cx.toFixed(0)} ${cy.toFixed(0)})" fill="${g}"/>`);
  }
  return `<g transform="translate(${x},${y}) scale(${flip ? -s : s},${s})">${leaves.join('')}
    <path d="M-70,0 L70,0 L55,150 L-55,150 Z" fill="#c9a483"/><path d="M-70,0 L70,0 L68,18 L-68,18 Z" fill="#b38f6e"/></g>`;
}

function lifestyle(W, H, variant) {
  const [wall, floor, edge] = pick([
    ['#d9b9a0', '#9c7454', '#7f5c41'],
    ['#c9d1bf', '#a88763', '#8a6c4c'],
    ['#e6d7c3', '#8d6a4f', '#6f523b'],
    ['#cbbfd6', '#a0806a', '#836552'],
  ], variant);
  const flip = variant % 2 === 1;
  const s = Math.min(W, H) / 1000;
  const floorY = H * 0.86;
  const px = flip ? W * 0.13 : W * 0.87;
  return `<defs>
      <linearGradient id="wl" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient>
      <filter id="bl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${12 * s}"/></filter>
      ${grain('gr')}
    </defs>
    <rect width="${W}" height="${H}" fill="${wall}"/>
    <rect width="${W}" height="${H}" fill="url(#wl)"/>
    <rect y="${floorY}" width="${W}" height="${H - floorY}" fill="${floor}"/>
    <rect y="${floorY - 4 * s}" width="${W}" height="${10 * s}" fill="${edge}"/>
    ${plant(px, floorY - 150 * s * 1.1, s * 1.1, flip)}
    <g filter="url(#bl)" fill="#fff8e8" fill-opacity="0.16">
      <path d="M${W * (flip ? 0.6 : 0.1)},0 L${W * (flip ? 0.78 : 0.28)},0 L${W * (flip ? 0.4 : 0.74)},${H} L${W * (flip ? 0.22 : 0.56)},${H} Z"/>
    </g>
    <rect width="${W}" height="${H}" filter="url(#gr)"/>`;
}

function dark(W, H, variant) {
  const glow = pick(['#ffcf99', '#ffd9b8', '#c9d4ff'], variant);
  return `<defs>
      <radialGradient id="bg" cx="0.5" cy="0.38" r="0.9"><stop offset="0" stop-color="#3a3640"/><stop offset="1" stop-color="#141217"/></radialGradient>
      <radialGradient id="sp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${glow}" stop-opacity="0.24"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
      <linearGradient id="fl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>
      ${grain('gr')}
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <ellipse cx="${W / 2}" cy="${H * 0.46}" rx="${W * 0.5}" ry="${H * 0.46}" fill="url(#sp)"/>
    <rect y="${H * 0.75}" width="${W}" height="${H * 0.25}" fill="url(#fl)"/>
    <rect width="${W}" height="${H}" filter="url(#gr)"/>`;
}

export function backgroundSvg(style, W, H, variant = 0) {
  let body;
  switch (style) {
    case 'warm': {
      const [c1, c2] = pick([['#f6ebdc', '#e3cdb0'], ['#f4e4d4', '#dcc0a4'], ['#f7efe2', '#e6d5bb']], variant);
      body = studio(W, H, c1, c2, 0.5, 0.38);
      break;
    }
    case 'pastel': {
      const [c1, c2] = pick([['#e3eef2', '#b9cfd8'], ['#f3e6ea', '#dcc0ca'], ['#e8efe3', '#c5d6bf'], ['#efe9f6', '#d2c7e4']], variant);
      body = studio(W, H, c1, c2, 0.5, 0.35);
      break;
    }
    case 'dark':
      body = dark(W, H, variant);
      break;
    case 'lifestyle':
      body = lifestyle(W, H, variant);
      break;
    default: {
      const cx = pick([0.5, 0.42, 0.58], variant);
      body = studio(W, H, '#ffffff', '#e7e5e1', cx, 0.36);
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
}
