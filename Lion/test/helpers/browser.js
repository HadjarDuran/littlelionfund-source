// Loads the dashboard's browser scripts (plain globals, no modules) into a
// Node vm context with tiny stand-ins for window/document/storage, so the
// chart and series maths can be unit-tested exactly as the browser runs it.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'js');
const FILES = ['icons.js', 'util.js', 'data.js', 'chart.js', 'ui.js'];

export function loadApp() {
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const el = () => ({ querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, classList: { add() { }, remove() { }, toggle() { } }, style: {} });
  const sandbox = {
    console, Intl, Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: mem(), sessionStorage: mem(),
    document: { ...el(), body: el(), documentElement: el(), createElement: el, createElementNS: el },
    fetch: async () => { throw new Error('no network in tests'); },
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: () => { },
    ResizeObserver: class { observe() { } disconnect() { } },
    MutationObserver: class { observe() { } disconnect() { } },
    CSS: { escape: s => s },
  };
  sandbox.window = sandbox;
  sandbox.window.matchMedia = () => ({ matches: true, addEventListener() { } });
  sandbox.window.addEventListener = () => { };
  const ctx = vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(readFileSync(join(pub, f), 'utf8'), ctx, { filename: f });
  // Top-level const/function declarations live in the script scope: reach them by name.
  return new Proxy({}, { get: (_, k) => vm.runInContext(String(k), ctx) });
}

// Daily calendar helper: business days between two ISO dates.
export function days(from, to, fn) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) {
    const d = new Date(t); const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    out.push({ d: iso, v: fn(iso, out.length) });
  }
  return out;
}
