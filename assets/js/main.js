/* Yeamin's Workbench — page behaviour: theme, copy buttons, table of contents, filters. */
(function () {
  'use strict';

  var root = document.documentElement;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  /* ---------- theme toggle ---------- */
  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store('theme', next);
    });
  });

  /* ---------- copy to clipboard ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  function flash(btn, ok) {
    var label = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', label);
    btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    btn.classList.toggle('is-copied', ok);
    clearTimeout(btn._t);
    btn._t = setTimeout(function () {
      btn.textContent = label;
      btn.classList.remove('is-copied');
    }, 1600);
  }

  // Add a copy button to every code block
  document.querySelectorAll('div.highlighter-rouge').forEach(function (block) {
    var code = block.querySelector('pre code') || block.querySelector('pre');
    if (!code || block.querySelector(':scope > .copy-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    btn.addEventListener('click', function () {
      copyText(code.innerText.replace(/\n$/, '')).then(
        function () { flash(btn, true); },
        function () { flash(btn, false); }
      );
    });
    block.appendChild(btn);
  });

  // Cheatsheet buttons carry their command in data-copy
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyText(btn.getAttribute('data-copy')).then(
        function () { flash(btn, true); },
        function () { flash(btn, false); }
      );
    });
  });

  /* ---------- table of contents ---------- */
  var toc = document.querySelector('[data-toc]');
  if (toc) {
    var list = toc.querySelector('[data-toc-list]');
    var body = document.querySelector('[data-steps]');
    var heads = body ? body.querySelectorAll(':scope > h2, :scope > h3') : [];
    var links = [];
    var step = 0;

    heads.forEach(function (h) {
      if (!h.id) h.id = h.textContent.trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      if (h.tagName === 'H3') {
        li.className = 'toc-sub';
        a.textContent = h.textContent;
      } else {
        if (!h.classList.contains('no-step')) {
          step += 1;
          var n = document.createElement('span');
          n.className = 'toc-num';
          n.textContent = step + '.';
          a.appendChild(n);
        }
        a.appendChild(document.createTextNode(h.textContent));
      }
      li.appendChild(a);
      list.appendChild(li);
      links.push({ head: h, link: a });
    });

    if (links.length < 2) {
      toc.hidden = true;
    } else {
      // Collapse on small screens so the content comes first
      if (window.matchMedia('(max-width: 1039px)').matches) toc.open = false;

      // Highlight the section you're reading: the last heading above the top third of the screen
      var active = null;
      var ticking = false;
      var update = function () {
        ticking = false;
        var best = links[0].link;
        links.forEach(function (item) {
          if (item.head.getBoundingClientRect().top < window.innerHeight * 0.35) best = item.link;
        });
        if (active === best) return;
        if (active) active.removeAttribute('aria-current');
        active = best;
        active.setAttribute('aria-current', 'true');
      };
      window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
      }, { passive: true });
      update();
    }
  }

  /* ---------- tag filter on list pages ---------- */
  var filter = document.querySelector('[data-tag-filter]');
  var filterList = document.querySelector('[data-filter-list]');
  if (filter && filterList) {
    var chips = filter.querySelectorAll('[data-tag]');
    var empty = document.querySelector('[data-filter-empty]');

    var apply = function (tag, push) {
      tag = (tag || '').toLowerCase();
      var shown = 0;
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-tag') === tag)); });
      filterList.querySelectorAll('.entry').forEach(function (el) {
        var tags = (el.getAttribute('data-tags') || '').split(' ');
        var show = !tag || tags.indexOf(tag) !== -1;
        el.hidden = !show;
        if (show) shown += 1;
      });
      if (empty) empty.hidden = shown > 0;
      if (push) {
        var url = new URL(window.location.href);
        if (tag) url.searchParams.set('tag', tag); else url.searchParams.delete('tag');
        history.replaceState(null, '', url);
      }
    };

    chips.forEach(function (c) {
      c.addEventListener('click', function () { apply(c.getAttribute('data-tag'), true); });
    });
    var clear = document.querySelector('[data-filter-clear]');
    if (clear) clear.addEventListener('click', function () { apply('', true); });

    var initial = new URLSearchParams(window.location.search).get('tag');
    if (initial) apply(initial, false);
  }

  /* ---------- cheatsheet filter ---------- */
  var sheetInput = document.querySelector('[data-sheet-filter]');
  if (sheetInput) {
    var sections = document.querySelectorAll('[data-sheet-section]');
    var sheetEmpty = document.querySelector('[data-sheet-empty]');
    sheetInput.addEventListener('input', function () {
      var terms = sheetInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      var total = 0;
      sections.forEach(function (sec) {
        var count = 0;
        sec.querySelectorAll('[data-cmd-row]').forEach(function (row) {
          var text = row.textContent.toLowerCase();
          var show = terms.every(function (t) { return text.indexOf(t) !== -1; });
          row.hidden = !show;
          if (show) count += 1;
        });
        sec.hidden = count === 0;
        total += count;
      });
      if (sheetEmpty) sheetEmpty.hidden = total > 0;
    });
  }
})();
