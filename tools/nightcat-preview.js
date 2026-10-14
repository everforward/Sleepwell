const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.NIGHTCAT_PREVIEW_PORT || 4180);
const PAGES = { '/': 'agent', '/record': 'record', '/night-settings': 'night-settings', '/night-memory': 'night-memory', '/sound': 'sound', '/journal': 'journal', '/sleep': 'sleep', '/focus': 'focus' };
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
// 内联 wxss 的 @import（浏览器不支持小程序相对路径与 rpx 变换）。
function readCss(file, seen = new Set()) {
  return read(file).replace(/@import\s+['"]([^'"]+)['"]\s*;/g, (all, target) => {
    const resolved = path.posix.join(path.posix.dirname(file), target);
    if (seen.has(resolved)) return '';
    seen.add(resolved);
    return readCss(resolved, seen);
  });
}
function moduleSources() {
  const sources = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const relative = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith('.js')) sources['/' + relative] = read(relative);
    }
  }
  for (const folder of ['utils', 'services', 'experts', 'skills']) walk(folder);
  return sources;
}
function clientRuntime(payload) {
  const data = payload;
  const moduleCache = {};
  let page;
  let rendering = false;
  const app = {
    globalData: { audioState: { sound: 'breeze', playing: false, volume: 0.42, timerMinutes: 30 } },
    playSound(sound, url, minutes) { this.globalData.audioState = Object.assign({}, this.globalData.audioState, { sound, playing: true, timerMinutes: minutes }); },
    pauseSound() { this.globalData.audioState = Object.assign({}, this.globalData.audioState, { playing: false }); }
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: innerWidth, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 32, bottom: 64, left: innerWidth - 96 }),
    getStorageSync: (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    setStorageSync: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    showShareMenu() {}, hideKeyboard() {}, onKeyboardHeightChange(fn) { window.keyboardListener = fn; }, offKeyboardHeightChange() {},
    navigateTo: ({ url }) => { window.lastNavigation = { type: 'navigateTo', url }; },
    reLaunch: ({ url }) => { window.lastNavigation = { type: 'reLaunch', url }; },
    navigateBack() {}, showToast: (opts) => { window.lastToast = (opts && opts.title) || ''; }
  };
  function loadModule(file) {
    if (moduleCache[file]) return moduleCache[file].exports;
    const module = { exports: {} };
    moduleCache[file] = module;
    const resolve = (name) => {
      const resolved = new URL(name + '.js', 'http://preview' + file).pathname;
      return loadModule(resolved);
    };
    new Function('require', 'module', 'exports', 'wx', 'getApp', data.modules[file])(resolve, module, module.exports, wx, () => app);
    return module.exports;
  }
  // 与真实 WXML 一致：数据里没有的变量求值为 undefined，而不是抛 ReferenceError。
  function evaluate(expression, scope) {
    try {
      return new Function('scope', 'with(scope) { return (' + expression + '); }')(scope);
    } catch (error) {
      if (error instanceof ReferenceError) return undefined;
      throw error;
    }
  }
  function interpolate(value, scope) {
    const exact = value.match(/^\{\{([\s\S]*?)\}\}$/);
    if (exact) return evaluate(exact[1], scope);
    return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => String(evaluate(expr, scope)));
  }
  const source = new DOMParser().parseFromString(data.wxml, 'text/html');
  const tags = { view: 'div', text: 'span', 'scroll-view': 'div', image: 'img', img: 'img', input: 'input', button: 'button' };
  function renderNode(node, scope, parent, inLoop = false) {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(interpolate(node.textContent, scope))); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (!inLoop && node.hasAttribute('wx:for')) {
      const items = interpolate(node.getAttribute('wx:for'), scope) || [];
      const itemName = node.getAttribute('wx:for-item') || 'item';
      const indexName = node.getAttribute('wx:for-index') || 'index';
      items.forEach((item, index) => renderNode(node, Object.assign({}, scope, { [itemName]: item, [indexName]: index }), parent, true));
      return;
    }
    const element = document.createElement(tags[node.tagName.toLowerCase()] || 'div');
    if (node.tagName.toLowerCase() === 'block') element.style.display = 'contents';
    for (const attribute of node.attributes) {
      const name = attribute.name;
      if (name.startsWith('wx:') || /^(bind|catch)/.test(name)) continue;
      const value = interpolate(attribute.value, scope);
      if (name === 'disabled') { element.disabled = Boolean(value); continue; }
      if (name === 'value') { element.value = value; continue; }
      if (name === 'focus') continue;
      element.setAttribute(name, String(value));
    }
    if (node.tagName.toLowerCase() === 'scroll-view') { element.style.overflowY = 'auto'; element.dataset.scrollView = 'true'; }
    const dataset = {};
    for (const attribute of node.attributes) if (attribute.name.startsWith('data-')) dataset[attribute.name.slice(5)] = interpolate(attribute.value, scope);
    for (const attribute of node.attributes) {
      if (!/^(bind|catch)/.test(attribute.name)) continue;
      const event = attribute.name.replace(/^(bind|catch)/, '');
      const eventName = { tap: 'click', input: 'input', focus: 'focus', blur: 'blur', confirm: 'keydown' }[event];
      if (!eventName) continue;
      element.addEventListener(eventName, (e) => {
        if (rendering) return;
        if (event === 'confirm' && e.key !== 'Enter') return;
        if (attribute.name.startsWith('catch')) e.stopPropagation();
        const handler = page[attribute.value];
        if (handler) handler.call(page, { currentTarget: { dataset }, detail: { value: e.target.value } });
      });
    }
    renderChildren(node, scope, element);
    parent.appendChild(element);
  }
  function renderChildren(node, scope, parent) {
    let matched = false;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) continue;
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.hasAttribute('wx:if')) {
          matched = Boolean(interpolate(child.getAttribute('wx:if'), scope));
          if (!matched) continue;
        } else if (child.hasAttribute('wx:elif')) {
          if (matched) continue;
          matched = Boolean(interpolate(child.getAttribute('wx:elif'), scope));
          if (!matched) continue;
        } else if (child.hasAttribute('wx:else')) {
          if (matched) continue;
          matched = true;
        } else matched = false;
      }
      renderNode(child, scope, parent);
    }
  }
  function render() {
    rendering = true;
    const previousInput = document.activeElement;
    const focused = previousInput && previousInput.tagName === 'INPUT';
    const start = focused ? previousInput.selectionStart : null;
    const scrollPositions = [...document.querySelectorAll('[data-scroll-view]')].map((el) => el.scrollTop);
    const mount = document.getElementById('app');
    mount.replaceChildren();
    renderChildren(source.body, page.data, mount);
    [...document.querySelectorAll('[data-scroll-view]')].forEach((el, i) => { el.scrollTop = scrollPositions[i] || 0; });
    const input = document.querySelector('input');
    if (input && (focused || page.data.inputFocus)) {
      input.focus({ preventScroll: true });
      if (start !== null) input.setSelectionRange(start, start);
    }
    const anchor = document.getElementById('chat-status');
    if (anchor && page.data.message) anchor.scrollIntoView({ block: 'nearest' });
    const stream = document.querySelector('.chat-stream') || document.querySelector('.chat-messages');
    if (stream) stream.scrollTop = stream.scrollHeight;
    rendering = false;
  }
  new Function('require', 'Page', 'wx', 'getApp', data.script)((name) => loadModule(new URL(name + '.js', 'http://preview/pages/' + data.pageName + '/index.js').pathname), (definition) => { page = definition; }, wx, () => app);
  page.data = structuredClone(page.data);
  page.setData = (values) => {
    const changed = Object.keys(values).some((key) => page.data[key] !== values[key]);
    Object.assign(page.data, values);
    if (changed && Object.keys(values).some((key) => key !== 'inputFocus')) render();
  };
  window.previewPage = page;
  window.previewWx = wx;
  // 与真实页面一致：未定义的生命周期直接跳过。
  if (page.onLoad) page.onLoad();
  if (page.onShow) page.onShow();
  render();
  addEventListener('resize', () => document.documentElement.style.setProperty('--rpx', innerWidth / 750 + 'px'));
  document.documentElement.style.setProperty('--rpx', innerWidth / 750 + 'px');
}

function preview(pageName = 'agent') {
  const payload = { pageName, wxml: read('pages/' + pageName + '/index.wxml'), script: read('pages/' + pageName + '/index.js'), modules: moduleSources() };
  const css = (read('app.wxss') + '\n' + readCss('pages/' + pageName + '/index.wxss'))
    .replace(/(^|\n)page\s*\{/g, '$1body {')
    .replace(/(?<![\w-])(view|text|image|scroll-view)(?![\w-])/g, (tag) => ({ view: 'div', text: 'span', image: 'img', 'scroll-view': 'div' }[tag]))
    .replace(/(-?\d*\.?\d+)rpx/g, 'calc($1 * var(--rpx))')
    .replace(/env\(safe-area-inset-bottom\)/g, 'var(--safe-bottom)');
  const encoded = JSON.stringify(payload).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>夜喵</title><style>:root{--rpx:.5px;--safe-bottom:34px}html,body{margin:0;height:100%;overflow:hidden}button{cursor:pointer;border:0}img{object-fit:cover}input,textarea{outline:none;border:0;background:transparent}#app{height:100%}' + css + '</style></head><body><div id="app"></div><script>(' + clientRuntime.toString() + ')(' + encoded + ')</script></body></html>';
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (PAGES[pathname]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(preview(PAGES[pathname])); return; }
  if (!pathname.startsWith('/assets/agent/') && !pathname.startsWith('/assets/record/')) { res.writeHead(404); res.end(); return; }
  const file = path.resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(path.join(root, 'assets') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  fs.createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log('Nightcat preview: http://127.0.0.1:' + port));
