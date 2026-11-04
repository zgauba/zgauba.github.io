/* Shared map bits for every Commons page that draws a Leaflet map (home pin, events map,
   organizer venue pin). Load after leaflet.js, before the page script. */

var jcTiles = {
  sat: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
         opts: { maxNativeZoom: 19, maxZoom: 20, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" } },
  street: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            /* OSM blocks tile requests with no Referer (403 "Access blocked"). The page is
               no-referrer (tokens in URLs), so this layer alone sends the bare origin. */
            opts: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors", referrerPolicy: "strict-origin" } }
};

/* "24.5301, 54.4312", "24.5301° N, 54.4312° E", or a Google Maps URL with @lat,lng or
   ?q=lat,lng → [lat, lng]; null if it isn't a plausible coordinate pair. */
function jcParseLatLng(raw){
  raw = String(raw || "");
  var m = raw.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) ||               /* …/@lat,lng… or ?q=lat,lng */
          raw.match(/(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[NS]?\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/i);
  if (!m) return null;
  var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  return [lat, lng];
}
