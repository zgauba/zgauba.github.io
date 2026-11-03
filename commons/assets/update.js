/* Auto-update (ported from the Halloween site's proven pattern). Every 2 minutes,
   and whenever the tab comes back into view, fingerprint what this page is made of:
   the page's HTML (by content — Cloudflare sends no ETag for it) + the ETag of each
   same-origin script/stylesheet (vendor files are versioned by filename, skipped).
   A changed fingerprint = a new deploy:
   - nothing in progress → reload, so residents always run the current version;
   - mid-form, or on a screen marked [data-no-autoreload] (the pin map) → a tappable
     "new version ready" banner instead; never yank someone out of what they're doing.
   Static-host requests only (Cloudflare Pages) — never the database. */
(function(){
  var INTERVAL = window.JC_UPDATE_MS || 120000;
  var base = null, checking = false, ready = false;

  function hash(t){ var h = 5381; for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return h; }

  function assets(){
    var urls = [];
    Array.prototype.forEach.call(document.querySelectorAll("script[src], link[rel=stylesheet][href]"), function(n){
      var u = new URL(n.getAttribute("src") || n.getAttribute("href"), location.href);
      if (u.origin === location.origin && u.pathname.indexOf("/vendor/") === -1) urls.push(u.pathname);
    });
    return urls;
  }

  function fingerprint(){
    var parts = [fetch(location.pathname, { cache: "no-store" })
      .then(function(r){ return r.ok ? r.text() : ""; })
      .then(function(t){ return "html:" + hash(t); })];
    assets().forEach(function(u){
      parts.push(fetch(u, { method: "HEAD", cache: "no-store" }).then(function(r){
        return u + ":" + (r.headers.get("etag") || r.headers.get("last-modified") || r.status);
      }));
    });
    return Promise.all(parts).then(function(a){ return a.join("|"); });
  }

  function busy(){
    if (document.querySelector("[data-no-autoreload]")) return true;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    return Array.prototype.some.call(document.querySelectorAll("input, textarea"), function(i){
      return i.type !== "hidden" && i.type !== "button" && i.value && i.value !== i.defaultValue;
    });
  }

  function banner(){
    if (document.getElementById("jcUpdate")) return;
    var b = document.createElement("button");
    b.id = "jcUpdate";
    b.type = "button";
    b.textContent = typeof jcT === "function" ? jcT("update_ready") : "A new version is ready. Tap to refresh.";
    b.style.cssText = "position:fixed;inset-inline:12px;top:12px;z-index:2000;padding:12px 14px;border-radius:12px;" +
      "border:1px solid var(--jc-accent);background:var(--jc-surface);color:var(--jc-ink);font:inherit;font-weight:700;cursor:pointer";
    b.addEventListener("click", function(){ location.reload(); });
    document.body.appendChild(b);
  }

  function apply(){ if (!ready) return; if (busy()) banner(); else location.reload(); }

  function check(){
    if (checking || document.hidden || ready) { if (ready) apply(); return; }
    checking = true;
    fingerprint().then(function(fp){
      if (base === null) { base = fp; return; }
      if (fp !== base) { ready = true; apply(); }
    }).catch(function(){ /* offline or host hiccup — try again next round */ })
      .then(function(){ checking = false; });
  }

  setTimeout(check, Math.min(5000, INTERVAL));
  setInterval(check, INTERVAL);
  document.addEventListener("visibilitychange", function(){ if (!document.hidden) check(); });
})();
