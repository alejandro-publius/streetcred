// The interactive map, shared by the homepage and the corner page.
//
// Progressive enhancement, strictly: the server renders a static map image
// first, and this file upgrades it in place only after Leaflet and its first
// tiles actually arrive. Any failure at any point leaves the static image
// exactly as served, so a visitor with JavaScript off, a CDN block, or a flaky
// connection loses interactivity and nothing else.
//
// Leaflet with Carto raster tiles, not the Google Maps JS SDK, because the SDK
// requires putting an API key in client HTML and this product's zero-keys
// property is load-bearing. Street View photographs elsewhere on the page keep
// their Google attribution; the map tiles carry their own.
//
// Three layers, in the order a reader should trust them:
//   audited  solid pins, one per corner somebody actually audited
//   scored   hollow rings, the sweep tier, "scored, audit pending"
//   heat     every nonzero crossing in the census as a small dim dot, canvas
//            renderer, visible only past zoom 13 so the citywide view stays
//            a map rather than a rash
(function () {
  "use strict";

  var LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  var LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  var TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  var TILE_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  // The grade palette, identical to the chips and the board.
  var GRADE = { A: "#788c5d", B: "#a3b088", C: "#6a9bcc", D: "#e89a5f", F: "#F07E26" };
  var GRADE_BY_INDEX = ["A", "B", "C", "D", "F"];

  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load(src, isCss) {
    return new Promise(function (resolve, reject) {
      var el;
      if (isCss) {
        el = document.createElement("link");
        el.rel = "stylesheet";
        el.href = src;
      } else {
        el = document.createElement("script");
        el.src = src;
        el.defer = true;
      }
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }

  var libPromise = null;
  function lib() {
    if (!libPromise) libPromise = Promise.all([load(LEAFLET_CSS, true), load(LEAFLET_JS)]);
    return libPromise;
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }

  // The percentile sentence travels with the grade everywhere, including here.
  function popupHtml(c) {
    var g = esc(c.grade || "");
    var chip = '<span class="lpop-g" style="background:' + (GRADE[c.grade] || "#8a867c") + '">' + g + "</span>";
    var sentence =
      typeof c.index === "number"
        ? "<br><span class='lpop-s'>More reported harm than " + c.index + "% of San Francisco intersections.</span>"
        : "";
    var state = c.audited === false ? "<br><span class='lpop-s'>Scored from city records, audit pending.</span>" : "";
    return (
      "<div class='lpop'>" + chip + " <b>" + esc(c.name) + "</b>" + sentence + state +
      "<br><a href='/c/" + esc(c.slug) + "'>View this corner</a></div>"
    );
  }

  // opts: {center:[lat,lon], zoom, audited:[], scored:[], heatUrl, focus:{lat,lon,name},
  //        onReady(map), interactiveCaption(el->update attribution text)}
  function mount(container, opts) {
    return lib().then(function () {
      var L = window.L;
      var map = L.map(container, {
        center: opts.center,
        zoom: opts.zoom,
        scrollWheelZoom: false, // a page scroll must never become a zoom trap
        zoomAnimation: !REDUCED,
        fadeAnimation: !REDUCED,
        markerZoomAnimation: !REDUCED,
      });
      L.tileLayer(TILES, { attribution: TILE_ATTRIB, maxZoom: 19 }).addTo(map);

      // audited: solid grade-colored pins
      (opts.audited || []).forEach(function (c) {
        L.circleMarker([c.lat, c.lon], {
          radius: 8,
          color: "#faf9f5",
          weight: 1.5,
          fillColor: GRADE[c.grade] || "#8a867c",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(popupHtml(c));
      });

      // scored: smaller hollow rings, audit pending
      (opts.scored || []).forEach(function (c) {
        L.circleMarker([c.lat, c.lon], {
          radius: 5,
          color: GRADE[c.grade] || "#8a867c",
          weight: 2,
          fillColor: "#faf9f5",
          fillOpacity: 0.85,
        })
          .addTo(map)
          .bindPopup(popupHtml(Object.assign({ audited: false }, c)));
      });

      // heat: every nonzero crossing, canvas renderer, only past zoom 13.
      // Not clickable on purpose: a dot is context, not a destination.
      if (opts.heatUrl) {
        var heatLayer = null;
        var heatLoaded = false;
        var maybeHeat = function () {
          var want = map.getZoom() >= 13;
          if (want && !heatLoaded) {
            heatLoaded = true;
            fetch(opts.heatUrl)
              .then(function (r) { return r.json(); })
              .then(function (dots) {
                var canvas = L.canvas({ padding: 0.3 });
                var group = [];
                dots.forEach(function (d) {
                  group.push(
                    L.circleMarker([d[0], d[1]], {
                      renderer: canvas,
                      radius: 2,
                      stroke: false,
                      fillColor: GRADE[GRADE_BY_INDEX[d[2]]] || "#8a867c",
                      fillOpacity: 0.35,
                      interactive: false,
                    }),
                  );
                });
                heatLayer = L.layerGroup(group);
                if (map.getZoom() >= 13) heatLayer.addTo(map);
              })
              .catch(function () { heatLoaded = false; });
          } else if (heatLayer) {
            if (want && !map.hasLayer(heatLayer)) heatLayer.addTo(map);
            if (!want && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
          }
        };
        map.on("zoomend", maybeHeat);
        maybeHeat();
      }

      if (opts.focus) {
        L.circleMarker([opts.focus.lat, opts.focus.lon], {
          radius: 10,
          color: "#141B2D",
          weight: 2,
          fillColor: "#F07E26",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip(esc(opts.focus.name), { permanent: false });
      }

      // Tap anywhere: name the nearest real crossing, spend nothing. The first
      // tap is a read (one keyless lookup against the city's intersection
      // table); only tapping the popup's link resolves the corner, through the
      // same guards as typing its name. Map browsing must never bill anyone.
      if (opts.tapAnywhere) {
        map.on("click", function (e) {
          var at = e.latlng;
          fetch("/api/nearest?lat=" + at.lat.toFixed(6) + "&lon=" + at.lng.toFixed(6))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              var html;
              if (d.ok) {
                html =
                  "<div class='lpop'><b>" + esc(d.name) + "</b>" +
                  "<br><span class='lpop-s'>" + d.distanceM + "m from your tap.</span>" +
                  "<br><a href='#' data-q='" + esc(d.query) + "' class='lpop-go'>View this corner</a></div>";
              } else {
                html = "<div class='lpop'><span class='lpop-s'>No crossing within 120m of that tap.</span></div>";
              }
              var pop = window.L.popup().setLatLng(at).setContent(html).openOn(map);
              var go = pop.getElement() && pop.getElement().querySelector(".lpop-go");
              if (go) {
                go.addEventListener("click", function (ev) {
                  ev.preventDefault();
                  go.textContent = "Resolving";
                  fetch("/api/resolve?q=" + encodeURIComponent(go.getAttribute("data-q")))
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                      if (res.ok && res.slug) location.href = "/c/" + res.slug;
                      else go.textContent = res.error || "Could not resolve this corner";
                    })
                    .catch(function () { go.textContent = "Could not resolve this corner"; });
                });
              }
            })
            .catch(function () {});
        });
      }

      if (opts.onReady) opts.onReady(map, L);
      return map;
    });
  }

  // Upgrade a server-rendered static map in place. The static content is only
  // removed AFTER the first tile layer signals load, so a tile CDN failure
  // leaves the image standing.
  function upgrade(staticEl, opts) {
    // The static image is what gives the container its height, so its height
    // has to be pinned BEFORE the image is removed or the map collapses to
    // zero pixels the moment it takes over. Found the hard way: the DOM dump
    // showed a mounted map with 123 marker paths and the screenshot showed
    // nothing at all, because nothing was the container's height.
    var h = staticEl.offsetHeight;
    if (h > 0) staticEl.style.height = h + "px";

    var shell = document.createElement("div");
    shell.className = "leafshell";
    shell.style.position = "absolute";
    shell.style.inset = "0";
    shell.style.opacity = "0";
    staticEl.style.position = "relative";
    staticEl.appendChild(shell);

    return mount(shell, opts)
      .then(function (map) {
        return new Promise(function (resolve) {
          var done = false;
          var reveal = function () {
            if (done) return;
            done = true;
            shell.style.opacity = "1";
            // Drop the static image and pins now that tiles are on screen.
            Array.prototype.slice.call(staticEl.children).forEach(function (ch) {
              if (ch !== shell) ch.remove();
            });
            map.invalidateSize();
            resolve(map);
          };
          map.eachLayer(function (l) {
            if (l instanceof window.L.TileLayer) l.once("load", reveal);
          });
          // Belt and braces: if the tile load event never fires (cached tiles
          // can beat the listener), reveal after a short grace period.
          setTimeout(reveal, 2500);
        });
      })
      .catch(function (e) {
        shell.remove();
        return null; // static map stays; that is the design, not a failure
      });
  }

  // Mount lazily, when the static map is near the viewport.
  function whenNear(el, fn) {
    if (!("IntersectionObserver" in window)) return fn();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          io.disconnect();
          fn();
        }
      });
    }, { rootMargin: "400px" });
    io.observe(el);
  }

  window.StreetMap = { mount: mount, upgrade: upgrade, whenNear: whenNear, GRADE: GRADE, REDUCED: REDUCED };
})();
