/*
 * "Fill from ClubMode" — runs on TopDog's Enter Score page (ScoreCardEntry.asp)
 * as a bookmarklet, in the captain's own logged-in browser.
 *
 * It fills the card from a ClubMode payload and STOPS. It never presses Submit:
 * posting to the league is the captain's call, after checking the card.
 *
 * The payload arrives in the #clubmode= fragment of the link ClubMode opened,
 * or is pasted (ClubMode also copies it) when a TopDog login ate the fragment.
 * Payload shape: FillPayload in src/lib/captain/topdog.ts.
 *
 * Only block comments in here: a bookmarklet pasted into a phone's bookmark
 * editor can lose its line breaks, and a line comment would swallow the rest.
 */
(function () {
  var PANEL_ID = 'clubmode-fill-panel';
  var RED = '3px solid #e11d48';
  var AMBER = '3px solid #f59e0b';
  var GREEN = '2px solid #16a34a';

  if (!/scorecardentry\.asp/i.test(location.pathname)) {
    alert('Open the TopDog "Enter Score" page for the match first (ClubMode\'s "Enter on TopDog" button takes you there), then tap Fill from ClubMode.');
    return;
  }
  var form = document.querySelector('form[action*="ScoreCardEntry" i]') || document.forms[0];
  if (!form || !form.elements.namedItem('defltcode_0')) {
    /* TopDog serves no blank card for a match that is already posted. */
    if (/action=insert/i.test(location.search)) {
      if (confirm('TopDog has no blank score card for this match, so it looks like the scores are already posted.\n\nOpen the posted card so you can correct it? (Tap Fill from ClubMode again once it loads.)')) {
        location.href = location.href.replace(/action=insert/i, 'action=update');
      }
      return;
    }
    alert('This TopDog page has no score card on it to fill.');
    return;
  }

  function decode(code) {
    code = String(code || '').trim().replace(/^.*#clubmode=/, '').replace(/-/g, '+').replace(/_/g, '/');
    while (code.length % 4) code += '=';
    var bin = atob(code);
    var bytes = [];
    for (var i = 0; i < bin.length; i++) bytes.push('%' + ('0' + bin.charCodeAt(i).toString(16)).slice(-2));
    return JSON.parse(decodeURIComponent(bytes.join('')));
  }

  var payload = null;
  var m = location.hash.match(/clubmode=([A-Za-z0-9_-]+)/);
  try {
    if (m) payload = decode(m[1]);
  } catch (e) { payload = null; }
  if (!payload) {
    var pasted = prompt('Paste the fill code from ClubMode (the "Enter on TopDog" button copied it):');
    if (!pasted) return;
    try { payload = decode(pasted); } catch (e) {
      alert('That is not a ClubMode fill code. Go back to the match in ClubMode and press "Enter on TopDog" again.');
      return;
    }
  }
  if (!payload || payload.v !== 1 || !payload.lines) {
    alert('That fill code is from a different version of ClubMode. Press "Enter on TopDog" again.');
    return;
  }

  var here = form.elements.namedItem('s');
  if (here && String(here.value) !== String(payload.s)) {
    alert('This TopDog page is a different match from the one ClubMode sent (' + (payload.opponent || 'match ' + payload.s) + ', ' + payload.date + '). Nothing was filled.');
    return;
  }

  function el(name) { return form.elements.namedItem(name); }
  function fire(node) {
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function mark(node, style) { if (node) { node.style.outline = style; node.style.outlineOffset = '1px'; } }
  function letters(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''); }

  /* "Mains,Nicole (3.500 )[Line=1WD]" -> { last: "mains", first: "nicole" } */
  function optionName(text) {
    var t = String(text || '').replace(/\(.*$/, '').replace(/\[.*$/, '');
    var i = t.indexOf(',');
    if (i < 0) return null;
    return { last: letters(t.slice(0, i)), first: letters(t.slice(i + 1).trim().split(/\s+/)[0]) };
  }

  /*
   * ClubMode keeps the name people go by ("Nikki Mains", "Jen Acker Parks");
   * TopDog keeps the registered one ("Mains,Nicole", "Acker,Jen"). Match on the
   * surname first — any run of words after the first name — and only use the
   * first name to split two players who share a surname. Anything short of
   * exactly one candidate is left blank and flagged, never guessed.
   *
   * Opponent names come off a handwritten card, so they may also be
   * "Smith, Jane" or one word: a lone surname, or failing that a lone first name
   * (flagged for checking).
   */
  function findPlayer(select, fullName) {
    var raw = String(fullName || '').trim();
    var comma = raw.indexOf(',');
    if (comma > 0) raw = raw.slice(comma + 1).trim() + ' ' + raw.slice(0, comma).trim();
    var words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) return { status: 'none' };
    if (words.length === 1) return findByOneWord(select, letters(words[0]));
    var first = letters(words[0]);
    var rest = words.slice(1).map(letters);
    var surnames = {};
    for (var a = 0; a < rest.length; a++) {
      var joined = '';
      for (var b = a; b < rest.length; b++) { joined += rest[b]; surnames[joined] = true; }
    }
    var byLast = [];
    for (var k = 0; k < select.options.length; k++) {
      var o = select.options[k];
      if (!o.value || o.value === '-1') continue;
      var n = optionName(o.text);
      if (n && surnames[n.last]) byLast.push({ option: o, name: n });
    }
    if (byLast.length === 1) {
      var only = byLast[0];
      return { status: only.name.first.charAt(0) === first.charAt(0) ? 'ok' : 'check', option: only.option };
    }
    if (byLast.length > 1) {
      var byFirst = byLast.filter(function (c) {
        return c.name.first.indexOf(first) === 0 || first.indexOf(c.name.first) === 0;
      });
      if (byFirst.length === 1) return { status: 'ok', option: byFirst[0].option };
      return { status: 'ambiguous' };
    }
    return { status: 'none' };
  }

  function findByOneWord(select, word) {
    var byLast = [];
    var byFirst = [];
    for (var k = 0; k < select.options.length; k++) {
      var o = select.options[k];
      if (!o.value || o.value === '-1') continue;
      var n = optionName(o.text);
      if (!n) continue;
      if (n.last === word) byLast.push(o);
      if (n.first === word) byFirst.push(o);
    }
    if (byLast.length === 1) return { status: 'ok', option: byLast[0] };
    if (byLast.length > 1) return { status: 'ambiguous' };
    if (byFirst.length === 1) return { status: 'check', option: byFirst[0] };
    if (byFirst.length > 1) return { status: 'ambiguous' };
    return { status: 'none' };
  }

  function setSelect(select, value) {
    if (!select) return false;
    select.value = value;
    fire(select);
    return select.value === value;
  }

  /* Blocks on the card, in order, typed by whether they carry a second player. */
  var blocks = [];
  for (var i = 0; el('defltcode_' + i); i++) {
    blocks.push({ index: i, type: el('hid2_' + i) ? 'D' : 'S' });
  }
  /* Clear old marks from an earlier run. */
  Array.prototype.forEach.call(form.querySelectorAll('select, input'), function (n) { n.style.outline = ''; });

  var ours = payload.side === 'H' ? { p: 'hid', set: 'wSet', radio: 'H' } : { p: 'vid', set: 'vSet', radio: 'V' };
  var theirs = payload.side === 'H' ? { p: 'vid', set: 'vSet', radio: 'V' } : { p: 'hid', set: 'wSet', radio: 'H' };

  var issues = [];
  var toPick = [];
  var unnamedCourts = [];
  var firstFlag = null;
  var filled = 0;

  var date = el('matchdate');
  if (date && payload.date) { date.value = payload.date; fire(date); }

  ['S', 'D'].forEach(function (type) {
    var lines = payload.lines.filter(function (l) { return l.type === type; });
    var slots = blocks.filter(function (b) { return b.type === type; });
    if (lines.length !== slots.length) {
      issues.push('ClubMode has ' + lines.length + ' ' + (type === 'S' ? 'singles' : 'doubles') + ' court(s) but this card has ' + slots.length + '. Filled the first ' + Math.min(lines.length, slots.length) + ' in order.');
    }
    for (var n = 0; n < Math.min(lines.length, slots.length); n++) {
      var line = lines[n];
      var i = slots[n].index;
      var label = '#' + (i + 1) + ' (ClubMode ' + (type === 'S' ? 'singles' : 'doubles') + ' ' + line.court + ')';
      var perSide = type === 'D' ? 2 : 1;

      /* Status first: TopDog's changeStatus() clears the winner when it changes. */
      setSelect(el('defltcode_' + i), line.status);

      for (var slot = 1; slot <= perSide; slot++) {
        var mine = el(ours.p + slot + '_' + i);
        var name = line.us === 'default' ? null : line.us[slot - 1];
        if (!mine) {
          /* no select for this slot on the card */
        } else if (line.us === 'default') {
          setSelect(mine, '-1');
        } else if (!name) {
          mine.value = ''; fire(mine); mark(mine, RED);
          issues.push(label + ': no player saved in ClubMode for this slot.');
          firstFlag = firstFlag || mine;
        } else {
          var hit = findPlayer(mine, name);
          if (hit.option) {
            setSelect(mine, hit.option.value);
            if (hit.status === 'check') {
              mark(mine, AMBER);
              issues.push(label + ': matched ' + name + ' to "' + hit.option.text.replace(/\s*\(.*$/, '') + '" by surname only. Check it.');
              firstFlag = firstFlag || mine;
            } else {
              mark(mine, GREEN);
            }
          } else {
            mine.value = ''; fire(mine); mark(mine, RED);
            issues.push(label + ': could not find ' + name + ' on TopDog\'s roster' + (hit.status === 'ambiguous' ? ' (more than one possible match)' : '') + '. Pick the player by hand.');
            firstFlag = firstFlag || mine;
          }
        }

        var other = el(theirs.p + slot + '_' + i);
        if (!other) continue;
        var theirName = Array.isArray(line.them) ? line.them[slot - 1] : null;
        if (line.them === 'default') {
          setSelect(other, '-1');
        } else if (theirName) {
          var got = findPlayer(other, theirName);
          if (got.option) {
            setSelect(other, got.option.value);
            if (got.status === 'check') {
              mark(other, AMBER);
              issues.push(label + ': read "' + theirName + '" off the scorecard as "' + got.option.text.replace(/\s*\(.*$/, '') + '". Check it.');
              firstFlag = firstFlag || other;
            } else {
              mark(other, GREEN);
            }
          } else {
            other.value = ''; fire(other); mark(other, AMBER);
            issues.push(label + ': "' + theirName + '" from the scorecard ' + (got.status === 'ambiguous' ? 'matches more than one player' : 'is not') + ' on the ' + (payload.opponent || 'other team') + ' TopDog roster. Pick the player by hand.');
            toPick.push(other);
          }
        } else if (!other.value || other.value === '-1') {
          if (other.value === '-1') { other.value = ''; fire(other); }
          mark(other, AMBER);
          toPick.push(other);
          if (unnamedCourts.indexOf(line.court) < 0) unnamedCourts.push(line.court);
        }
      }

      for (var s = 1; s <= 3; s++) {
        var set = line.sets[s - 1];
        var a = el(ours.set + s + '_' + i);
        var b = el(theirs.set + s + '_' + i);
        if (a) { a.value = set ? String(set[0]) : ''; fire(a); }
        if (b) { b.value = set ? String(set[1]) : ''; fire(b); }
      }

      var want = line.winner === 'us' ? ours.radio : line.winner === 'them' ? theirs.radio : null;
      var radios = form.querySelectorAll('input[type="radio"][name="winner_' + i + '"]');
      var picked = false;
      Array.prototype.forEach.call(radios, function (r) {
        if (want && r.value === want) { r.checked = true; picked = true; fire(r); }
      });
      if (!picked) {
        issues.push(label + ': no winner saved in ClubMode. Pick the winner.');
        if (radios[0]) { mark(radios[0].closest('td') || radios[0], RED); firstFlag = firstFlag || radios[0]; }
      }
      filled++;
    }
  });

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();
  var panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('style', 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;background:#001820;color:#fff;font:14px/1.45 system-ui,sans-serif;padding:16px 18px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.45);border:1px solid #D3FB52');
  function add(tag, text, style) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (style) node.setAttribute('style', style);
    panel.appendChild(node);
    return node;
  }
  add('div', 'ClubMode filled ' + filled + ' court' + (filled === 1 ? '' : 's'), 'font-weight:700;font-size:16px;color:#D3FB52;margin-bottom:6px');
  if (toPick.length) {
    add('div', 'Your turn: pick ' + (payload.opponent || 'the other team') + '\'s players in the ' + toPick.length + ' amber box' + (toPick.length === 1 ? '' : 'es') + '.' +
      (unnamedCourts.length ? ' No opponent names are saved in ClubMode for court' + (unnamedCourts.length === 1 ? ' ' : 's ') + unnamedCourts.join(', ') + '.' : ''), 'margin-bottom:6px');
  }
  if (issues.length) {
    var list = add('ul', '', 'margin:6px 0;padding-left:18px;color:#fecaca');
    issues.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      list.appendChild(li);
    });
  }
  add('div', 'Nothing has been submitted. Check every court against the paper card, then press Submit yourself.', 'margin-top:6px;color:rgba(255,255,255,.7)');
  var close = add('button', 'Close', 'margin-top:10px;background:#D3FB52;color:#001820;border:0;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer');
  close.type = 'button';
  close.onclick = function () { panel.remove(); };
  document.body.appendChild(panel);

  var focus = firstFlag || toPick[0];
  if (focus && focus.scrollIntoView) focus.scrollIntoView({ block: 'center' });
})();
