// Runs before first paint. Replays the CSS variables the last-picked theme saved,
// so there is no flash of the default theme. No token table lives here; lib/themes.ts owns it.
(function () {
  try {
    var raw = localStorage.getItem("modeltalk:theme-vars");
    if (!raw) return;
    var v = JSON.parse(raw);
    var r = document.documentElement;
    for (var k in v.vars) r.style.setProperty(k, v.vars[k]);
    if (v.scheme) r.style.colorScheme = v.scheme;
    if (v.id) r.dataset.theme = v.id;
  } catch (e) {}
})();
