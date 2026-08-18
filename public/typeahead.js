// The corner typeahead. Attaches to the header's find input on every page.
//
// One KV-backed fetch per keystroke after a 150ms debounce, nothing else: the
// suggestions come from the pre-built index of all 7,926 crossings, so typing
// never touches DataSF and never spends anything. Selecting an audited or
// scored corner navigates straight to its page, which already exists.
// Selecting an unindexed crossing submits it through the existing find flow,
// so it passes the same resolver guards as typing it by hand.
//
// ARIA combobox per the APG pattern: the input owns the listbox, arrow keys
// move an active descendant, Enter selects, Escape closes and restores.
(function () {
  "use strict";
  var input = document.getElementById("q");
  var form = document.getElementById("find");
  if (!input || !form || !window.fetch) return;

  var GRADE = { A: "#788c5d", B: "#a3b088", C: "#6a9bcc", D: "#e89a5f", F: "#F07E26" };

  var box = document.createElement("ul");
  box.className = "ta";
  box.id = "ta-list";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  form.appendChild(box);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", "ta-list");

  var items = [];
  var active = -1;
  var timer = null;
  var lastQ = "";

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }

  // Bold the typed words where they match, and nowhere else.
  function mark(name, q) {
    var words = q.toLowerCase().split(/\s+/).filter(function (w) { return w && w !== "and" && w !== "at"; });
    var out = esc(name);
    words.sort(function (a, b) { return b.length - a.length; }).forEach(function (w) {
      var re = new RegExp("(^|[^a-z0-9])(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
      out = out.replace(re, "$1<b>$2</b>");
    });
    return out;
  }

  function close() {
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function render(q) {
    if (!items.length) {
      box.innerHTML = '<li class="ta-empty" role="option" aria-disabled="true">No crossing by that name in the city index.</li>';
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
      return;
    }
    box.innerHTML = items
      .map(function (it, i) {
        // 3 audited and 2 enriched carry a filled grade chip; 1 scored carries
        // a grade dot, which is every other corner in the city; 0 has no grade
        // to show and gets nothing rather than an invented one.
        var badge = "";
        if (it.tier >= 2 && it.grade) {
          badge = '<span class="ta-g" style="background:' + (GRADE[it.grade] || "#8a867c") + '">' + esc(it.grade) + "</span>";
        } else if (it.tier === 1 && it.grade) {
          badge = '<span class="ta-dot" style="border-color:' + (GRADE[it.grade] || "#8a867c") + '" title="graded against the citywide census, audit pending"></span>';
        }
        return (
          '<li id="ta-' + i + '" role="option" data-i="' + i + '"' + (i === active ? ' aria-selected="true" class="on"' : "") + ">" +
          '<span class="ta-n">' + mark(it.name, q) + "</span>" + badge + "</li>"
        );
      })
      .join("");
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function choose(i) {
    var it = items[i];
    if (!it) return;
    close();
    if (it.tier >= 1) {
      // The page exists. Go straight there; nothing to resolve, nothing spent.
      location.href = "/c/" + it.slug;
    } else {
      // Unindexed crossing: submit through the existing find flow so it passes
      // the same resolver guards as a hand-typed query.
      input.value = it.name;
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  }

  input.addEventListener("input", function () {
    var q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { close(); return; }
    timer = setTimeout(function () {
      lastQ = q;
      fetch("/api/suggest?q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (q !== lastQ) return; // a newer keystroke owns the box now
          items = (d && d.items) || [];
          active = -1;
          render(q);
        })
        .catch(function () { close(); });
    }, 150);
  });

  input.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      active = e.key === "ArrowDown" ? (active + 1) % items.length : (active - 1 + items.length) % items.length;
      render(input.value.trim());
      input.setAttribute("aria-activedescendant", "ta-" + active);
    } else if (e.key === "Enter") {
      if (active >= 0) { e.preventDefault(); choose(active); }
      else close(); // plain Enter falls through to the normal find submit
    } else if (e.key === "Escape") {
      close();
    }
  });

  box.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); choose(Number(li.getAttribute("data-i"))); }
  });

  document.addEventListener("click", function (e) {
    if (!form.contains(e.target)) close();
  });
})();
