/* Yeamin's Workbench — site search. Runs entirely in the browser from search.json. */
(function () {
  'use strict';

  var meta = document.querySelector('meta[name="search-index"]');
  var indexUrl = meta ? meta.content : 'search.json';
  var index = null;
  var loading = null;

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(indexUrl)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          index = data.map(function (d) {
            d._title = (d.title || '').toLowerCase();
            d._tags = (d.tags || '').toLowerCase();
            d._text = (d.text || '').toLowerCase();
            return d;
          });
          return index;
        })
        .catch(function () { loading = null; return []; });
    }
    return loading;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function highlight(text, terms) {
    var out = escapeHtml(text);
    terms.forEach(function (t) {
      if (t.length < 2) return;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }
  function snippet(text, terms) {
    if (!text) return '';
    var lower = text.toLowerCase();
    var pos = -1;
    terms.some(function (t) { pos = lower.indexOf(t); return pos !== -1; });
    var start = Math.max(0, pos - 50);
    var s = text.slice(start, start + 150);
    return (start > 0 ? '…' : '') + s + (start + 150 < text.length ? '…' : '');
  }

  function search(q) {
    var terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var results = [];
    index.forEach(function (d) {
      var score = 0;
      var all = terms.every(function (t) {
        var hit = false;
        if (d._title.indexOf(t) !== -1) { score += d._title.indexOf(t) === 0 ? 12 : 8; hit = true; }
        if (d._tags.indexOf(t) !== -1) { score += 4; hit = true; }
        if (d._text.indexOf(t) !== -1) { score += 1; hit = true; }
        return hit;
      });
      if (all) {
        if (d.type === 'Tutorial' || d.type === 'Cheatsheet') score += 1;
        results.push({ doc: d, score: score });
      }
    });
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 10).map(function (r) { return r.doc; });
  }

  function bind(box) {
    var input = box.querySelector('[data-search-input]');
    var out = box.querySelector('[data-search-results]');
    var selected = -1;

    function render(q) {
      if (!q.trim()) { out.innerHTML = ''; selected = -1; return; }
      load().then(function () {
        var terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
        var hits = search(q);
        selected = -1;
        if (!hits.length) {
          out.innerHTML = '<li class="sr-empty">Nothing matches “' + escapeHtml(q.trim()) + '”. Try a single word, like a tool name.</li>';
          return;
        }
        out.innerHTML = hits.map(function (d) {
          var isCmd = d.type === 'Command';
          var sub = isCmd ? (d.text + ' (' + d.sheet + ')') : snippet(d.text, terms);
          return '<li><a href="' + escapeHtml(d.url) + '">' +
            '<span class="sr-type">' + d.type + '</span>' +
            '<span class="sr-title' + (isCmd ? ' is-cmd' : '') + '">' + highlight(d.title, terms) + '</span>' +
            (sub ? '<span class="sr-text">' + highlight(sub, terms) + '</span>' : '') +
            '</a></li>';
        }).join('');
      });
    }

    function move(delta) {
      var items = out.querySelectorAll('a');
      if (!items.length) return;
      if (selected >= 0) items[selected].removeAttribute('aria-selected');
      selected = (selected + delta + items.length) % items.length;
      items[selected].setAttribute('aria-selected', 'true');
      items[selected].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', load, { once: true });
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        var items = out.querySelectorAll('a');
        var target = items[selected >= 0 ? selected : 0];
        if (target) { e.preventDefault(); window.location.href = target.href; }
      } else if (e.key === 'Escape' && !box.closest('dialog')) {
        input.value = ''; render('');
      }
    });
    // close inline results when clicking elsewhere
    document.addEventListener('click', function (e) {
      if (!box.contains(e.target) && !box.closest('dialog')) out.innerHTML = '';
    });
  }

  document.querySelectorAll('[data-search]').forEach(bind);

  /* ---------- dialog + keyboard shortcut ---------- */
  var dialog = document.getElementById('search-dialog');
  var heroInput = document.querySelector('.search-box--hero [data-search-input]');

  function openSearch() {
    if (heroInput && heroInput.getBoundingClientRect().bottom > 0) {
      heroInput.focus();
      return;
    }
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    var input = dialog.querySelector('[data-search-input]');
    input.focus();
    input.select();
  }

  document.querySelectorAll('[data-open-search]').forEach(function (b) {
    b.addEventListener('click', openSearch);
  });
  if (dialog) {
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  }
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      openSearch();
    }
  });
})();
