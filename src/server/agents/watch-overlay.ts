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
    // Sizes here are deliberately larger than they look right at desk distance. The
    // overlay is watched over a shoulder, in a screen recording and on a projector, and a
    // tasteful 22px dot is invisible in all three.
    root.innerHTML =
      '<style>' +
      '.cur{position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;' +
      'border:3px solid #38bdf8;background:rgba(56,189,248,.28);' +
      'box-shadow:0 0 0 3px rgba(2,6,23,.55),0 0 22px rgba(56,189,248,.95);' +
      'transition:transform .09s linear,background .1s,border-color .1s;will-change:transform}' +
      // The press state. A click is two things happening in the same instant — the cursor
      // hits the target and the target reacts — and without a change at the cursor itself
      // the only evidence of the first is a ripple that has already started expanding.
      '.cur.down{background:rgba(250,204,21,.55);border-color:#facc15;' +
      'box-shadow:0 0 0 3px rgba(2,6,23,.55),0 0 26px rgba(250,204,21,1)}' +
      '.ring{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'border:3px solid #38bdf8;opacity:1;animation:pop .62s ease-out forwards}' +
      '.ring.touch{border-color:#facc15;border-width:4px}' +
      '@keyframes pop{to{width:110px;height:110px;margin:-55px 0 0 -55px;opacity:0}}' +
      '.tag{position:fixed;left:18px;bottom:18px;font:700 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'color:#e2e8f0;background:rgba(2,6,23,.92);border:2px solid rgba(56,189,248,.65);' +
      'border-radius:8px;padding:9px 14px;opacity:0;transform:translateY(6px);' +
      'transition:opacity .18s,transform .18s;box-shadow:0 6px 24px rgba(2,6,23,.6)}' +
      '.tag.on{opacity:1;transform:none}' +
      '.scroll{position:fixed;right:18px;width:52px;height:52px;margin-top:-26px;border-radius:50%;' +
      'display:grid;place-items:center;font:700 26px/1 system-ui;color:#0f172a;background:#38bdf8;' +
      'box-shadow:0 0 26px rgba(56,189,248,.95);animation:fade .75s ease-out forwards}' +
      // A rail down the right edge, so a scroll reads as travel over a distance rather
      // than as a lone arrow blinking in a corner.
      '.rail{position:fixed;right:32px;top:0;bottom:0;width:4px;border-radius:2px;' +
      'background:linear-gradient(rgba(56,189,248,0),rgba(56,189,248,.65),rgba(56,189,248,0));' +
      'animation:fade .75s ease-out forwards}' +
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

    var ripple = function (touch) {
      var r = document.createElement('div');
      r.className = touch ? 'ring touch' : 'ring';
      r.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      root.appendChild(r);
      setTimeout(function () { r.remove(); }, 660);
      cur.classList.add('down');
      setTimeout(function () { cur.classList.remove('down'); }, 180);
    };

    var label = function (el) {
      var name = (el && el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name')))
        || (el && el.textContent ? el.textContent.trim().slice(0, 40) : '');
      return name ? ' · ' + name : '';
    };

    addEventListener('pointermove', move, true);
    addEventListener('mousemove', move, true);
    // Touch moves the pointer without a preceding move event, so a tap would otherwise
    // ripple wherever the mouse was last seen — often off-screen.
    addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0];
      if (t) move(t);
    }, true);

    addEventListener('pointerdown', function (e) {
      move(e);
      var touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      ripple(touch);
      say((touch ? 'tap' : 'click') + label(e.target));
    }, true);

    // The scroll indicator is drawn from whichever event arrives — a wheel scroll and a
    // a programmatic scrollIntoView are both movement a watcher needs to see, and only
    // the first is a wheel event. A scroll event fires for both, so it carries the rail;
    // handler adds the arrow that shows a *deliberate* scroll and its direction.
    var lastY = 0, scrollTimer;
    var showScroll = function (down) {
      var s = document.createElement('div');
      s.className = 'scroll';
      s.style.top = (down ? innerHeight - 80 : 80) + 'px';
      s.textContent = down ? '↓' : '↑';
      var rail = document.createElement('div');
      rail.className = 'rail';
      root.appendChild(rail);
      root.appendChild(s);
      setTimeout(function () { s.remove(); rail.remove(); }, 780);
    };

    addEventListener('wheel', function (e) {
      var down = e.deltaY >= 0;
      showScroll(down);
      say('scroll ' + (down ? 'down' : 'up'));
    }, true);

    addEventListener('scroll', function () {
      // Coalesced: a smooth scroll fires this every frame, and one indicator per frame is
      // a strobe rather than a signal.
      if (scrollTimer) return;
      var down = scrollY >= lastY;
      lastY = scrollY;
      scrollTimer = setTimeout(function () { scrollTimer = null; }, 400);
      showScroll(down);
    }, true);

    addEventListener('keydown', function (e) {
      var k = e.key;
      say('type · ' + (k.length === 1 ? k : k.toLowerCase()));
    }, true);
  });
})();
`;
