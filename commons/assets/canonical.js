/* One canonical app: the same commons/ folder is served by GitHub Pages
   (zgauba.github.io/commons/…) and by Cloudflare Pages (commons.ae/…). The
   github.io copy forwards to commons.ae, keeping the path, query and fragment.
   Loaded first in <head> so nothing renders before the jump. Sessions don't carry
   across hosts (separate localStorage) — fine before launch, nobody has one. */
function jcCanonicalUrl(host, path, search, hash){
  if (host !== "zgauba.github.io") return null;
  var rest = String(path || "/").replace(/^\/commons(?=\/|$)/, "");
  return "https://commons.ae" + (rest || "/") + (search || "") + (hash || "");
}
(function(){
  var to = jcCanonicalUrl(location.hostname, location.pathname, location.search, location.hash);
  if (to) location.replace(to);
})();
