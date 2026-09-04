/**
 * The overlay that makes a headed run watchable.
 *
 * Playwright drives a real browser but it does not move a real cursor: clicks and
 * wheel events are dispatched into the page, so a person watching a headed run sees
 * things happen with no visible cause. This script is injected into every page before
 * the page's own scripts and draws the missing half — a pointer that follows the
 * synthetic mouse, a ripple where a click lands, a badge naming what just happened.
 *
 * It is a demo aid, not instrumentation. It never reads page content, never touches
 * application state, and is only injected for headed runs, so a headless CI run and a
 * headed demo run exercise exactly the same application code.
 */

/**
 * Injected via `--init-script`, so this runs in the page, before page scripts, in
 * every frame and after every navigation. It must assume nothing exists yet.
 */
export const WATCH_OVERLAY = String.raw`
(() => {
  if (window.top !== window) return;          // main frame only
  if (window.__odysseyOverlay) return;        // survive re-injection
  window.__odysseyOverlay = true;

  var ready = function (fn) {
    if (document.body) return fn();
    // An init script runs before the document has any nodes at all — not just before
    // <body>, but before <html> — so observe the document node itself. Observing
    // documentElement throws here, because it is still null.
    new MutationObserver(function (_, obs) {
      if (document.body) { obs.disconnect(); fn(); }
    }).observe(document, { childList: true, subtree: true });
  };

  ready(function () {
    var host = document.createElement('div');
    host.setAttribute('data-odyssey-overlay', '');
    // A shadow root keeps our styles out of the page and the page's out of ours —
    // important, because the app under test is the thing being measured.
    var root = host.attachShadow({ mode: 'open' });
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    root.innerHTML =
      '<style>' +
      '.cur{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'border:2px solid #38bdf8;background:rgba(56,189,248,.22);' +
      'box-shadow:0 0 0 2px rgba(2,6,23,.45),0 0 14px rgba(56,189,248,.9);' +
      'transition:transform .09s linear;will-change:transform}' +
      '.ring{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;' +
      'border:2px solid #38bdf8;opacity:.95;animation:pop .5s ease-out forwards}' +
      '@keyframes pop{to{width:64px;height:64px;margin:-32px 0 0 -32px;opacity:0}}' +
      '.tag{position:fixed;left:16px;bottom:16px;font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'color:#e2e8f0;background:rgba(2,6,23,.86);border:1px solid rgba(56,189,248,.5);' +
      'border-radius:6px;padding:6px 10px;opacity:0;transition:opacity .2s}' +
      '.tag.on{opacity:1}' +
      '.scroll{position:fixed;right:14px;width:34px;height:34px;margin-top:-17px;border-radius:50%;' +
      'display:grid;place-items:center;font:700 16px/1 system-ui;color:#0f172a;background:#38bdf8;' +
      'box-shadow:0 0 16px rgba(56,189,248,.85);animation:fade .6s ease-out forwards}' +
      '@keyframes fade{to{opacity:0}}' +
      '</style>' +
      '<div class="cur" id="cur" style="transform:translate(-100px,-100px)"></div>' +
      '<div class="tag" id="tag"></div>';
    (document.body || document.documentElement).appendChild(host);

    var cur = root.getElementById('cur');
    var tag = root.getElementById('tag');
    var hideTag;

    var say = function (text) {
      tag.textContent = text;
      tag.classList.add('on');
      clearTimeout(hideTag);
      hideTag = setTimeout(function () { tag.classList.remove('on'); }, 1400);
    };

    var x = -100, y = -100;
    var move = function (e) {
      if (typeof e.clientX !== 'number') return;
      x = e.clientX; y = e.clientY;
      cur.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    };

    var ripple = function () {
      var r = document.createElement('div');
      r.className = 'ring';
      r.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      root.appendChild(r);
      setTimeout(function () { r.remove(); }, 520);
    };

    addEventListener('pointermove', move, true);
    addEventListener('mousemove', move, true);

    addEventListener('pointerdown', function (e) {
      move(e); ripple();
      var el = e.target;
      var name = (el && (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name'))))
        || (el && el.textContent ? el.textContent.trim().slice(0, 40) : '');
      say(name ? 'click · ' + name : 'click');
    }, true);

    addEventListener('wheel', function (e) {
      var down = e.deltaY >= 0;
      var s = document.createElement('div');
      s.className = 'scroll';
      s.style.top = (down ? innerHeight - 60 : 60) + 'px';
      s.textContent = down ? '↓' : '↑';
      root.appendChild(s);
      setTimeout(function () { s.remove(); }, 620);
      say('scroll ' + (down ? 'down' : 'up'));
    }, true);

    addEventListener('keydown', function (e) {
      var k = e.key;
      say('type · ' + (k.length === 1 ? k : k.toLowerCase()));
    }, true);
  });
})();
`;
