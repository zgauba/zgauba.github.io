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
