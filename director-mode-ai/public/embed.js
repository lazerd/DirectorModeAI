/*
 * ClubMode embed helper — sizes ClubMode iframes on a club's own website.
 *
 *   <iframe src="https://clubmode.ai/c/your-club/programs?embed=1" data-clubmode-embed ...></iframe>
 *   <script src="https://clubmode.ai/embed.js" async></script>
 *
 * The embedded page posts its content height ({type: 'clubmode:resize'}); this
 * sets the matching iframe to that height, so the club's page scrolls as one
 * page instead of a box with its own scrollbar.
 *
 * Plain ES5 with no dependencies, because it runs inside whatever website
 * builder the club uses (Wild Apricot, Squarespace, WordPress) next to code we
 * have never seen. Safe to include more than once on a page.
 */
(function () {
  if (window.__clubmodeEmbed) return;
  window.__clubmodeEmbed = true;

  /*
   * Trust exactly the host this script was loaded from. Anything else posting
   * a resize message is somebody else's frame, and not ours to size.
   */
  var script = document.currentScript;
  var HOME = script && script.src ? new URL(script.src, window.location.href).origin : null;
  // Some site builders re-insert pasted scripts in ways that lose
  // currentScript; then fall back to frames the snippet marked as ours.
  function trusted(origin, frame) {
    if (HOME) return origin === HOME;
    return !!frame && frame.hasAttribute('data-clubmode-embed');
  }

  function originOf(src) {
    try {
      return new URL(src, window.location.href).origin;
    } catch (e) {
      return null;
    }
  }

  function frames() {
    return document.querySelectorAll('iframe');
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'clubmode:resize' || typeof data.height !== 'number') return;
    var list = frames();
    for (var i = 0; i < list.length; i++) {
      var frame = list[i];
      if (frame.contentWindow !== event.source) continue;
      // Only a ClubMode page may resize a frame, and only its own frame.
      if (!trusted(event.origin, frame) || originOf(frame.src) !== event.origin) return;
      var h = Math.max(120, Math.min(Math.ceil(data.height), 100000));
      frame.style.height = h + 'px';
      frame.style.minHeight = '0';
      frame.setAttribute('scrolling', 'no');
      return;
    }
  });

  /*
   * After a click inside the frame loads a new page (a class, then the sign-up
   * form), the visitor may be scrolled far below the top of it. Bring the top
   * of the frame back into view, the way a normal page load would.
   */
  function watch(frame) {
    if (frame.__clubmodeWatched) return;
    frame.__clubmodeWatched = true;
    var loads = 0;
    frame.addEventListener('load', function () {
      loads += 1;
      if (loads < 2) return;
      var top = frame.getBoundingClientRect().top;
      if (top < 0) window.scrollBy({ top: top - 16, behavior: 'smooth' });
    });
  }

  function scan() {
    var list = frames();
    for (var i = 0; i < list.length; i++) {
      var o = originOf(list[i].src);
      if (o && trusted(o, list[i])) watch(list[i]);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  if (window.MutationObserver) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
