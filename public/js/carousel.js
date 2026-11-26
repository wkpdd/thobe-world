/* The home carousel: native swipe (scroll-snap), arrows, dots, autoplay that
   pauses on touch, hover, focus, a hidden tab or « reduce motion ». RTL-aware. */
(function () {
  'use strict';
  var root = document.querySelector('[data-carousel]');
  if (!root) return;
  var track = root.querySelector('[data-track]');
  var slides = Array.prototype.slice.call(track.children);
  var dots = Array.prototype.slice.call(root.querySelectorAll('[data-dots] button'));
  if (slides.length < 2) return;
  var rtl = getComputedStyle(root).direction === 'rtl';
  var index = 0;

  function go(i) {
    index = (i + slides.length) % slides.length;
    // Positions relative to the first slide: negative in RTL, as scrollLeft is.
    track.scrollTo({ left: slides[index].offsetLeft - slides[0].offsetLeft, behavior: 'smooth' });
  }
  function current() {
    var w = track.clientWidth || 1;
    return Math.min(slides.length - 1, Math.round(Math.abs(track.scrollLeft) / w));
  }
  var raf = 0;
  track.addEventListener('scroll', function () {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      index = current();
      dots.forEach(function (d, i) { d.setAttribute('aria-current', String(i === index)); });
    });
  }, { passive: true });

  root.querySelector('[data-prev]').addEventListener('click', function () { go(index - 1); restart(); });
  root.querySelector('[data-next]').addEventListener('click', function () { go(index + 1); restart(); });
  dots.forEach(function (d, i) { d.addEventListener('click', function () { go(i); restart(); }); });
  track.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { go(index + (rtl ? 1 : -1)); restart(); }
    if (e.key === 'ArrowRight') { go(index + (rtl ? -1 : 1)); restart(); }
  });

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timer = 0;
  var paused = false;
  function restart() {
    clearInterval(timer);
    if (reduce) return;
    timer = setInterval(function () { if (!paused && !document.hidden) go(index + 1); }, 6000);
  }
  ['pointerenter', 'focusin', 'touchstart'].forEach(function (ev) { root.addEventListener(ev, function () { paused = true; }, { passive: true }); });
  ['pointerleave', 'focusout'].forEach(function (ev) { root.addEventListener(ev, function () { paused = false; }); });
  root.addEventListener('touchend', function () { setTimeout(function () { paused = false; }, 4000); }, { passive: true });
  restart();
})();
