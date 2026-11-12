/* Events page — UC-C1 browse & sign up, UC-C2 archive stats (wireframe v4.1 bands
   05 + 07). Views: list · detail (tabs: Map · List · My home) · stats.
   ?id=<event uuid>[&tab=map|list|mine] → detail (archived events → stats);
   ?id=…&view=stats → stats.
   CONTRACT (plan premortem #1): jc_event_signup REPLACES the home's payload + note,
   so the form always sends the full set, prefilled from `mine`.
   The event uses the HOME's pin — there is no per-event pin to set here. A home with
   no pin is sent to the pin screen and straight back to this tab (T5.2 plan Q4).
   Event-day live controls (giant switch, supply, crowd reports) are T5.2 PR 5.
   One-place events (kind "venue", T5.2 PR 4b): the map shows the place, residents see HOW
   MANY households are coming (never which — the server sends no entries), no List tab,
   no home pin needed to sign up, and "full" / your spot number. */

var params = new URLSearchParams(location.search);
var EVENT_ID = params.get("id");
if (EVENT_ID && !/^[0-9a-f-]{36}$/i.test(EVENT_ID)) EVENT_ID = null;
var TABS = ["map", "list", "mine"];

var state = null, cfg = null, current = null, map = null;
var full = jcMapFull(function(){ return map; }, fitMap);   /* the map, bigger (assets/map.js); fitMap is hoisted */
var data = null;          /* last jc_event_get */
var tab = TABS.indexOf(params.get("tab")) >= 0 ? params.get("tab") : "map";
var editing = false;      /* My home tab: the sign-up form is open */

/* ---------- helpers ---------- */
function isVenue(ev){ return !!ev && ev.kind === "venue"; }
function tabsFor(ev){ return isVenue(ev) ? ["map", "mine"] : TABS; }
function placeName(ev){ return ar() && ev.venue_name_ar ? ev.venue_name_ar : (ev.venue_name_en || ""); }
/* "12 households coming · 8 places left" / "Full" — counts only, never which homes */
function comingLine(n, ev, full){
  if (full) return jcT("ev_full");
  var line = jcFmt(n === 1 ? "ev_coming_1" : "ev_coming", { n: n });
  if (ev.capacity != null && ev.places_left != null) line += " · " + jcFmt(ev.places_left === 1 ? "ev_left_1" : "ev_left", { k: ev.places_left });
  return line;
}
function msgBox(){ return '<p class="msg" id="msg" role="alert"></p>'; }
function showErr(code){ var m = el("msg"); if (!m) return; m.className = "msg err"; m.textContent = jcErrText({ code: code }); }
function showOk(text){ var m = el("msg"); if (!m) return; m.className = "msg ok"; m.textContent = text; }
function on(id, fn){ var n = el(id); if (n) n.addEventListener("click", fn); }
function busy(id, onoff){
  var b = el(id);
  if (!b) return;
  if (onoff) { b.dataset.label = b.textContent; b.textContent = jcT("working"); b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
}
function ar(){ return jcLang() === "ar"; }
function title(ev){ return ar() && ev.title_ar ? ev.title_ar : ev.title_en; }
function desc(ev){ return ar() && ev.description_ar ? ev.description_ar : (ev.description_en || ""); }
function myHome(){ return state && state.me && state.me.home; }
function myLabel(){ return jcHomeLabel(myHome()); }
function fmtDate(iso){
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(ar() ? "ar-AE-u-nu-latn" : "en-GB",
    { day: "numeric", month: "short", timeZone: (cfg && cfg.tz) || "Asia/Dubai" });
}
/* "non_food" → "Non food"; a schema may carry per-language labels:
   {label_en, label_ar, labels_en: {value: label}, labels_ar: {…}} */
function human(s){ s = String(s).replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
function fieldLabel(key, spec){ return (spec && (spec["label_" + jcLang()] || spec.label_en)) || human(key); }
function valueLabel(spec, v){
  if (typeof v === "boolean") return jcT(v ? "ev_yes" : "ev_no");
  if (spec && spec.type === "bool" && (v === "true" || v === "false")) return jcT(v === "true" ? "ev_yes" : "ev_no");  /* stats keys are strings */
  /* per choice: this language, else English, else the stored value (PR #27 review: a
     partly translated question must not drop the English wording of the rest) */
  return (spec && (jcOwn(spec["labels_" + jcLang()], v) || jcOwn(spec.labels_en, v))) || human(v);
}
/* Usable coordinates only (T5.1 review): anything else is "not on the map yet". */
function hasPos(e){ return !!e && Number.isFinite(e.lat) && Number.isFinite(e.lng); }
function eventUrl(t){ return "../events/?id=" + encodeURIComponent(data.event.id) + "&tab=" + t; }
/* the pin screen, coming back to this event's My home tab when the pin is saved */
function pinUrl4Me(){ return "../home/?view=pin&next=" + encodeURIComponent(eventUrl("mine")); }
function goPin(){ location.href = pinUrl4Me(); }
/* The community's WhatsApp group (config links.whatsapp). Config is admin data, but a
   link must still be a real WhatsApp address — never javascript:/data:/elsewhere. */
function whatsappUrl(){
  var u = cfg && cfg.links && cfg.links.whatsapp;
  return (typeof u === "string" && /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/[A-Za-z0-9_\/+-]+$/.test(u)) ? u : null;
}

/* ---------- looks + pins (T5.2 PR 5a) ----------
   Look = a preset the app knows (colours in tokens.css, a mark here); anything else is plain.
   Pins (Halloween parity): FILL = availability (look colour · dark with a red ? = neighbors say
   they're out · grey = done), RING = the question marked "ring", ICON = the question marked "glyph";
   a choice listed in allergy_friendly gets the teal icon; a ring choice listed in ring_split ("both
   gates") draws half in each of the first two other choices' colours (Halloween parity, 5a.1).
   Colour never carries meaning alone: done shows ✕, reported shows ?, and the key under the map
   names every ring and icon. */
var LOOK_MARKS = { halloween: "🎃", haq_al_laila: "🌙", gathering: "🤝", market: "🛍️", yard_sale: "🏷️",
                   holiday_lights: "✨" };                                       /* R2b-2 */
/* treat nights say "out of treats"; everything else says "done" (Halloween copy rule) */
var TREAT_LOOKS = { halloween: true, haq_al_laila: true };
function outKey(ev, kind){ return TREAT_LOOKS[lookOf(ev)] === true ? "ev_out_treats" : kind; }
function lookOf(ev){ return ev && jcOwn(LOOK_MARKS, ev.look) ? ev.look : null; }
function setLook(look){
  if (look) document.documentElement.setAttribute("data-look", look);
  else document.documentElement.removeAttribute("data-look");
}
/* the questions that drive the ring and the icon: {key, spec} or null */
function pinField(ev, which){
  var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
  var keys = Object.keys(fields);
  for (var i = 0; i < keys.length; i++) {
    var f = fields[keys[i]];
    if (f && f.type === "enum" && f.pin === which) return { key: keys[i], spec: f };
  }
  return null;
}
function allergyFriendly(spec, v){
  return !!spec && Array.isArray(spec.allergy_friendly) && spec.allergy_friendly.indexOf(v) >= 0;
}
/* emoji counted as people see them (🛋️ is one, 🍬🎃 two) */
function glyphCount(g){
  if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter().segment(g)).length;
  return Array.from(g).length;
}
/* the icon for one answer — organizer-typed, so escaped; two or more emoji shrink to fit the pin
   (Halloween's 🍬🎃, review M1) */
function glyphHtml(spec, v){
  var g = spec && jcOwn(spec.glyphs, v);
  return g ? '<span class="gl' + (allergyFriendly(spec, v) ? ' teal' : '') + (glyphCount(g) > 1 ? ' multi' : '') + '">' + esc(g) + '</span>' : '';
}
/* "done" | "reported" | null — what the server says about this home tonight */
function pinState(e){ return e.live_state === "done" ? "done" : e.reported_out ? "reported" : null; }
/* the ring for one answer: ' r<n>' (one colour) or ' rs' plus a split border-color, from the first
   two choices that aren't themselves split. Indexes only — nothing typed reaches the HTML. */
function ringOf(spec, v){
  var vals = (spec && spec.values) || [], i = vals.indexOf(v);
  if (i < 0) return { cls: "", style: "" };
  var split = Array.isArray(spec.ring_split) ? spec.ring_split : [];
  if (split.indexOf(v) >= 0) {
    var others = vals.filter(function(x){ return split.indexOf(x) < 0; });
    if (others.length >= 2) {
      var a = "var(--jc-ring-" + (vals.indexOf(others[0]) % 6) + ")", b = "var(--jc-ring-" + (vals.indexOf(others[1]) % 6) + ")";
      return { cls: " rs", style: ' style="border-color:' + a + ' ' + b + ' ' + b + ' ' + a + '"' };
    }
  }
  return { cls: " r" + (i % 6), style: "" };
}
function ringClass(f, e){ return f ? ringOf(f.spec, e.payload && e.payload[f.key]) : { cls: "", style: "" }; }
function pinIcon(e){
  var ev = data.event, st = pinState(e), gf = pinField(ev, "glyph");
  var inner = st === "done" ? "✕" : st === "reported" ? "?" : gf ? glyphHtml(gf.spec, e.payload && e.payload[gf.key]) : "";
  var size = 32, ring = ringClass(pinField(ev, "ring"), e);
  return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
    html: '<div class="pin' + (st ? " " + st : "") + ring.cls + '"' + ring.style + '>' + inner + '</div>' });
}
/* the map key, one row each: icons · gates (rings) · tonight's states — wraps, never scrolls
   sideways (5a.1: the gate chips sat off-screen) */
function legendHtml(ev){
  var icons = [], rings = [], states = [], supply = [], gf = pinField(ev, "glyph"), rf = pinField(ev, "ring"), feats = ev.features || {};
  if (gf) (gf.spec.values || []).forEach(function(v){
    var g = glyphHtml(gf.spec, v);
    if (g) icons.push('<span class="chip">' + g + ' ' + esc(valueLabel(gf.spec, v)) + '</span>');
  });
  if (rf) (rf.spec.values || []).forEach(function(v){
    var r = ringOf(rf.spec, v);
    rings.push('<span class="chip"><i class="ringdot' + r.cls + '"' + r.style + '></i>' + esc(valueLabel(rf.spec, v)) + '</span>');
  });
  if (feats.giant_switch) states.push('<span class="chip"><i class="ringdot st done">✕</i>' + esc(jcT(outKey(ev, "ev_legend_done"))) + '</span>');
  if (feats.crowd_reports) states.push('<span class="chip"><i class="ringdot st reported">?</i>' + esc(jcT("ev_legend_reported")) + '</span>');
  if (feats.supply === true) SUPPLY.forEach(function(n){
    supply.push('<span class="chip">' + gaugeHtml(n) + esc(jcT("ev_supply_" + n)) + '</span>');
  });
  /* a heading per row: the question itself for icons / gates (the organizer's wording) */
  var rows = [[gf ? fieldLabel(gf.key, gf.spec) : "", icons], [rf ? fieldLabel(rf.key, rf.spec) : "", rings],
              [jcT("ev_legend_states"), states], [jcT("ev_legend_supply"), supply]]
    .filter(function(r){ return r[1].length; });
  return rows.length ? '<div class="legend">' + rows.map(function(r){
    return '<h3>' + esc(r[0]) + '</h3><div class="row">' + r[1].join("") + '</div>';
  }).join("") + '</div>' : '';
}
/* "Map Labels": the key in a popup window instead of under the map (Zee: "looks very messy") */
function openLabels(){
  var d = el("labels");
  if (!d) return;
  d.innerHTML = '<div class="sheethead"><h2>' + esc(jcT("ev_labels")) + '</h2>' +
    '<button type="button" class="lang" id="labelsClose">' + esc(jcT("ev_labels_close")) + '</button></div>' + legendHtml(data.event);
  on("labelsClose", function(){ closeLabels(d); });
  if (d.showModal) d.showModal(); else d.setAttribute("open", "");
}
/* older browsers without <dialog>: it was opened with [open], so close the same way (review F1) */
function closeLabels(d){ if (d.close) d.close(); else d.removeAttribute("open"); }

function show(name){
  /* state first: map.remove() fires popupclose, which must not draw onto a dying map (review R1) */
  var old = map;
  map = null; homeLayer = null; popupOpen = false; pendingRepaint = false; mineShown = null;
  full.reset();   /* any redraw: the map is back in the page */
  jcMapRemove(old);
  current = name;
  setLook(name === "list" ? null : lookOf(data && data.event));
  jcBack(name === "list" ? null : "./", "ev_back");   /* back to the events list, in the top bar */
  jcHelp(name === "detail" ? "event" : "events");
  document.body.classList.remove("evfit");
  var refocus = jcFocusKeep();
  VIEWS[name]();
  refocus();
}

/* "2 Dec · Sign-ups open · 37 homes in" — redrawn on each event-day refresh */
function headSub(ev, entries){
  var count = isVenue(ev) ? comingLine(ev.households_in || 0, ev, ev.places_left === 0)
                          : jcFmt("ev_homes_in", { n: entries.length });
  return [fmtDate(ev.starts_at), jcT(ended(ev) ? "ev_ended" : ev.coming_soon ? "ev_soon" : ev.signups_open ? "ev_open" : "ev_closed"),
          ev.coming_soon ? null : count].filter(Boolean).join(" · ");
}

/* ---------- views ---------- */
var VIEWS = {
  list: function(){
    el("view").innerHTML = '<h1 dir="auto">' + esc(jcModTitle("events")) + '</h1><p class="sub">' + esc(jcT("ev_sub")) + '</p>' +
      msgBox() + '<div id="lists"><p class="sub">' + esc(jcT("working")) + '</p></div>';
    rpc("jc_events_list").then(function(evs){
      /* upcoming: soonest first (undated last); past: most recent first (server order) */
      function when(e){ return e.starts_at ? Date.parse(e.starts_at) : Infinity; }
      var live = evs.filter(function(e){ return e.status === "live" && !ended(e); })
                    .sort(function(a, b){ return when(a) - when(b); });
      /* R2a (D2): ended-but-not-yet-closed events lead Past (most recent end first) */
      var past = evs.filter(ended).sort(function(a, b){ return Date.parse(b.ends_effective) - Date.parse(a.ends_effective); })
                    .concat(evs.filter(function(e){ return e.status === "archived"; }));
      /* Admin badge: organizers (events / community scope) on every event; event admins
         (T5.2 PR A/B) only on the events they run */
      var scopes = (state.me && state.me.admin_scopes) || [];
      var organizer = scopes.indexOf("events") >= 0 || scopes.indexOf("community") >= 0;
      var runs = (state.me && state.me.admin_events) || [];
      /* live: View + Sign up (only while sign-ups are open and this home isn't in);
         no status pill — the button says it. Past: the whole card opens the numbers. */
      function row(e){
        var url = "?id=" + encodeURIComponent(e.id);
        var soon = e.coming_soon && e.status !== "archived" && !ended(e);  /* T5.4: the badge says it; no count yet */
        var line = [fmtDate(e.starts_at), soon ? null : isVenue(e)
          /* households_in = every "in" household, as the event page counts (homes_in skips hidden ones) */
          ? (e.status === "archived" ? jcFmt("ev_came", { n: e.homes_in || 0 })
             : comingLine(e.households_in != null ? e.households_in : (e.homes_in || 0), {}, e.full))
          : jcFmt("ev_homes_in", { n: e.homes_in || 0 })];
        if (isVenue(e) && placeName(e)) line.splice(1, 0, jcFmt("ev_at", { v: placeName(e) }));
        if (e.status === "archived") line.push(jcT("ev_see_numbers"));
        else if (ended(e)) line.push(jcT("ev_ended"));
        else if (!soon && !e.signups_open) line.push(jcT("ev_closed"));
        if (e.my_status === "in") line.push(jcT("ev_mine"));
        var info = (soon ? '<span class="soon">' + esc(jcT("coming_soon")) + '</span>' : '') +
          '<b>' + (lookOf(e) ? '<span class="mark" aria-hidden="true">' + LOOK_MARKS[lookOf(e)] + '</span> ' : '') + esc(title(e)) +
          '</b><small>' + esc(line.filter(Boolean).join(" · ")) + '</small>';
        /* the card wears its event's look (tokens.css [data-look]) */
        var lk = lookOf(e) ? ' data-look="' + lookOf(e) + '"' : '';
        if (e.status === "archived") {
          return '<li data-event="' + esc(e.slug) + '"><a class="evcard"' + lk + ' href="' + url + '"><span>' + info + '</span></a></li>';
        }
        return '<li class="evcard"' + lk + ' data-event="' + esc(e.slug) + '">' +
          '<div class="evtop"><span>' + info + '</span>' +
            (organizer || runs.indexOf(e.id) >= 0 ? '<a class="badge" href="../admin/?event=' + encodeURIComponent(e.id) + '">' + esc(jcT("ev_admin")) + '</a>' : '') +
          '</div>' +
          '<div class="evacts"><a class="btn ghost" href="' + url + '">' + esc(jcT("ev_view")) + '</a>' +
            (openNow(e) && e.my_status !== "in" && !e.full
              ? '<a class="btn" href="' + url + '&amp;tab=mine">' + esc(jcT("ev_signup_cta")) + '</a>' : '') +
          '</div></li>';
      }
      el("lists").innerHTML =
        (live.length ? '<ul class="evlist">' + live.map(row).join("") + '</ul>'
                     : '<p class="sub">' + esc(jcT("ev_none")) + '</p>') +
        (past.length ? '<h2 class="group">' + esc(jcT("ev_past")) + '</h2><ul class="evlist">' + past.map(row).join("") + '</ul>' : '');
    }, function(e){
      el("lists").innerHTML = "";
      showErr(e.code);
    });
  },

  /* Halloween-site layout: the event header, then tabs. My home holds everything about
     MY home's sign-up — no map there: the event uses the home's pin. */
  detail: function(){
    var ev = data.event, entries = data.entries || [];
    var tabs = tabsFor(ev);
    if (tabs.indexOf(tab) < 0) tab = "map";   /* ?tab=list on a one-place event */
    var look = lookOf(ev);
    /* Admin: community admins / organizers, and this event's own admins (Zee, 2026-11-06) — on the title's line,
       at its end, so it never pushes the title and the map down (Zee, 2026-11-07) */
    var sc = (state.me && state.me.admin_scopes) || [];
    var canAdmin = sc.indexOf("community") >= 0 || sc.indexOf("events") >= 0 ||
                   ((state.me && state.me.admin_events) || []).indexOf(ev.id) >= 0;
    el("view").innerHTML =
      '<div class="evhead">' +
        /* the look's mark; Haq al Laila leads with its Arabic tagline in both languages */
        (look === "haq_al_laila" ? '<p class="tagline" lang="ar" dir="rtl">' + esc(jcT("look_tagline_haq_al_laila")) + '</p>' : '') +
        '<div class="evtitle"><h1>' + (look ? '<span class="mark" aria-hidden="true">' + LOOK_MARKS[look] + '</span> ' : '') + esc(title(ev)) + '</h1>' +
        (canAdmin ? '<a class="lang adminbtn" id="evAdmin" href="../admin/?event=' + encodeURIComponent(ev.id) + '">' + esc(jcT("ev_admin")) + '</a>' : '') +
        '</div>' +
        '<p class="sub" id="evsub">' + esc(headSub(ev, entries)) + '</p>' +
        /* two lines, then "More" — the map stays above the fold (Zee, 2026-11-04) */
        /* formatted with the editor's markers — jcRich escapes everything first (rich.js) */
        (desc(ev) ? '<div class="desc rich" id="desc" dir="auto">' + jcRich(desc(ev)) + '</div>' +
          '<button type="button" class="more" id="descMore" hidden>' + esc(jcT("ev_more")) + '</button>' : '') +
        safetyHtml(ev) + '</div>' +
      /* my own entry: "Sign Up" until this home is in, then "My Sign-Up" (Zee, 2026-11-05) */
      jcTabsHtml("tab-", tabs, tab, function(t){
        return jcT(t !== "mine" ? "ev_tab_" + t : (data.mine && data.mine.status === "in" ? "ev_tab_mine" : "ev_tab_signup"));
      }, title(ev), "body") +
      '<div id="banner"></div>' +                                   /* event day (5b) */
      '<p class="upd" id="upd" aria-live="polite" hidden></p>' +
      msgBox() +
      '<div ' + jcTabPanel("tab-", tab, "body") + '></div>';
    paintDay();
    jcTabsWire("tab-", tabs, function(t){
      tab = t; editing = false;
      try { history.replaceState(null, "", "?id=" + encodeURIComponent(ev.id) + "&tab=" + t); } catch(e){}
      show("detail");
    });
    wireDesc();
    if (tab === "map") renderMap(entries);
    else if (tab === "list") renderList(entries, "");
    else if (editing) renderForm();
    else renderMine();
  },

  stats: function(){
    var ev = data.event, st = data.stats || {};
    var byVillage = st.by_village || {}, byType = st.by_type || {};
    var venue = isVenue(ev);                /* one place: totals only — the server keeps no village split */
    var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
    function bars(obj, labelOf){
      var keys = Object.keys(obj).sort(function(a, b){ return obj[b] - obj[a]; });
      var max = Math.max.apply(null, keys.map(function(k){ return obj[k]; }).concat([1]));
      return '<div class="bars">' + keys.map(function(k){
        return '<div class="bar"><span>' + esc(labelOf(k)) + '</span><i style="width:' + Math.round(100 * obj[k] / max) + '%"></i><em>' +
          esc(obj[k]) + '</em></div>';
      }).join("") + '</div>';
    }
    var html = '<h1>' + esc(title(ev)) + '</h1><p class="sub">' + esc(jcT("st_title")) +
        (ev.status === "archived" && ev.ends_at ? ' · ' + esc(fmtDate(ev.ends_at)) : '') + '</p>' + msgBox() +
      (venue
        ? '<div class="big"><div><b>' + esc(st.homes || 0) + '</b><span>' + esc(jcT("st_households")) + '</span></div></div>' +
          (placeName(ev) ? '<p class="help">' + esc(jcFmt("ev_at", { v: placeName(ev) })) + '</p>' : '')
        : '<div class="big"><div><b>' + esc(st.homes || 0) + '</b><span>' + esc(jcT("st_homes")) + '</span></div>' +
            '<div><b>' + esc(Object.keys(byVillage).length) + '</b><span>' + esc(jcT("st_villages")) + '</span></div>' +
            '<div><b>' + esc(st.done || 0) + '</b><span>' + esc(jcT("st_done")) + '</span></div></div>' +
          '<h2 class="group">' + esc(jcT("st_by_village")) + '</h2>' + bars(byVillage, function(k){ return jcVillageName(cfg, k); })) +
      (Object.keys(byType).length ? '<h2 class="group">' + esc(jcT("st_by_type")) + '</h2>' +
        bars(byType, function(k){ return jcT("type_" + k); }) : '');
    Object.keys(st.payload || {}).forEach(function(k){
      html += '<h2 class="group">' + esc(fieldLabel(k, fields[k])) + '</h2>' +
        bars(st.payload[k], function(v){ return valueLabel(fields[k], v); });
    });
    if (st.legacy) html += '<p class="help">' + esc(jcT("st_baseline")) + '</p>';
    el("view").innerHTML = html;
  }
};

/* ---------- My home tab: my sign-up, or the form ---------- */
function renderMine(){
  var ev = data.event, mine = data.mine, h = myHome();
  var isIn = mine && mine.status === "in";
  var html = "";
  /* the organizers' note to MY home (Halloween parity: "your pin looks misplaced…") */
  if (mine && mine.org_note) {
    html += '<div class="orgnote" role="note"><b>' + esc(jcT("ev_org_note")) + '</b><p>' + esc(mine.org_note) + '</p></div>';
  }
  /* R2b-1: an organizer removed this sign-up (when, never who); signing up again clears it */
  if (h && mine && !isIn && mine.org_withdrawn_at) {
    html += '<p class="status orgline" role="note">' + esc(jcT("ev_org_removed")) + '</p>';
  }
  if (!h) {
    html += '<p class="help">' + esc(jcT("ev_no_home")) + '</p><a class="btn" href="../home/">' + esc(jcT("ev_claim")) + '</a>';
  } else if (isIn) {
    html += liveHtml();                          /* event day: the switch + supply, first */
    /* R2b-1: an organizer changed the switch, supply or pin; the household's own tap clears it */
    if (mine.org_adjusted_at && fmtStamp(mine.org_adjusted_at)) {
      /* the time in its own direction (U+2068 … U+2069 isolate): Latin digits + AM/PM never reorder inside Arabic */
      html += '<p class="status orgline" role="note">' +
        esc(jcFmt("ev_org_adjusted", { t: "⁨" + fmtStamp(mine.org_adjusted_at) + "⁩" })) + '</p>';
    }
    var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
    var rows = Object.keys(fields).filter(function(k){ return mine.payload && mine.payload[k] !== undefined; }).map(function(k){
      var v = mine.payload[k];
      return '<li><span>' + esc(fieldLabel(k, fields[k])) + '</span><b>' +
        esc(fields[k].type === "text" ? String(v) : valueLabel(fields[k], v)) + '</b></li>';
    });
    html += '<p class="status ok">' + esc(jcFmt(isVenue(ev) ? "ev_venue_in" : "ev_signed_up", { h: myLabel() })) + '</p>' +
      (isVenue(ev) && ev.spots
        ? '<p class="spot">' + (mine.spot ? esc(jcFmt("ev_your_spot", { s: mine.spot })) : esc(jcT("ev_spot_pending"))) + '</p>' : '') +
      (rows.length ? '<ul class="answers">' + rows.join("") + '</ul>' : '') +
      (mine.note ? '<p class="mynote">' + esc(mine.note) + '</p>' : '') +
      /* R2a (U1): an organizer hid this sign-up — say so (homes can't be hidden any more, HH 2026-11-11) */
      (!isVenue(ev) && mine.hidden ? '<p class="help notshown" role="note">' + esc(jcT("ev_not_shown")) + '</p>' : '') +
      (isVenue(ev) ? '' : pinLine(h)) +
      (openNow(ev) ? '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_update_btn", { h: myLabel() })) + '</button>' : '') +
      (ended(ev) ? '<p class="help">' + esc(jcT("ev_ended_help")) + '</p>'
                 : '<button class="btn ghost" type="button" id="withdraw">' + esc(jcFmt("ev_withdraw", { h: myLabel() })) + '</button>');
  } else if (ended(ev)) {
    html += '<p class="help">' + esc(jcT("ev_ended_help")) + '</p>';
  } else if (!ev.signups_open) {
    html += '<p class="help">' + esc(jcT(ev.coming_soon ? "ev_soon_help" : "err_SIGNUPS_CLOSED")) + '</p>';
  } else if (isVenue(ev) && ev.places_left === 0) {
    html += '<p class="help">' + esc(jcT("err_FULL")) + '</p>';
  } else if (isVenue(ev)) {
    /* one place: the venue is the pin — the home's own pin isn't needed */
    html += '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_signup_btn", { h: myLabel() })) + '</button>';
  } else if (!hasPos(h)) {
    /* no pin → the pin screen, then straight back here (never a refusal) */
    html += '<p class="help">' + esc(jcFmt("ev_pin_first", { h: myLabel() })) + '</p>' +
      '<a class="btn" id="toPin" href="' + esc(pinUrl4Me()) + '">' + esc(jcT("ev_pin_first_btn")) + '</a>';
  } else {
    html += pinLine(h) +
      '<button class="btn" type="button" id="toSignup">' + esc(jcFmt("ev_signup_btn", { h: myLabel() })) + '</button>';
  }
  var wa = whatsappUrl();
  if (wa) html += '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(wa) + '">' + esc(jcT("ev_whatsapp")) + '</a>';
  el("body").innerHTML = '<div class="cta" id="cta">' + html + '</div>';
  mineShown = mineKey();
  wireLive();
  on("toSignup", function(){
    if (!isVenue(ev) && !hasPos(myHome())) return goPin();
    editing = true; show("detail");
  });
  on("withdraw", function(){
    if (!window.confirm(jcFmt("ev_withdraw_confirm", { h: myLabel() }))) return;
    busy("withdraw", true);
    gen++;                                   /* a refresh already on its way is now stale (review R4) */
    rpc("jc_entry_withdraw", { p_event: ev.id }).then(function(d){
      data = d; show("detail"); showOk(jcFmt("ev_withdrawn", { h: myLabel() }));
    }, function(e){ busy("withdraw", false); showErr(e.code); });
  });
}

/* "📍 Villa 12's pin is on the map — Change": the home's pin, edited on My Home */
function pinLine(h){
  return hasPos(h)
    ? '<p class="help pinline">' + esc(jcFmt("ev_pin_line", { h: myLabel() })) + ' <a href="' + esc(pinUrl4Me()) + '">' + esc(jcT("ev_pin_change")) + '</a></p>'
    : '<p class="help pinline">' + esc(jcT("ev_no_pin_nudge")) + ' <a href="' + esc(pinUrl4Me()) + '">' + esc(jcT("ev_pin_it")) + '</a></p>';
}

function renderForm(){
  var ev = data.event, mine = data.mine || {};
  var prev = mine.status === "in" ? (mine.payload || {}) : {};
  var fields = (ev.payload_schema && ev.payload_schema.fields) || {};
  var chosen = {};
  Object.keys(prev).forEach(function(k){ chosen[k] = prev[k]; });
  var html = '<h2 class="formtitle">' + esc(jcFmt(mine.status === "in" ? "ev_update_btn" : "ev_signup_btn", { h: myLabel() })) + '</h2>' +
    '<form class="panel" id="form" novalidate>';
  Object.keys(fields).forEach(function(k){
    var spec = fields[k] || {};
    var lab = '<legend>' + esc(fieldLabel(k, spec)) + (spec.required ? ' <span class="req">(' + esc(jcT("ev_required")) + ')</span>' : '') + '</legend>';
    if (spec.type === "enum" || spec.type === "bool") {
      var vals = spec.type === "bool" ? [true, false] : (spec.values || []);
      html += '<fieldset class="field">' + lab + '<div class="opts">' + vals.map(function(v){
        return '<button type="button" data-field="' + esc(k) + '" data-value="' + esc(JSON.stringify(v)) + '" aria-pressed="' +
          (chosen[k] === v) + '">' + esc(valueLabel(spec, v)) + '</button>';
      }).join("") + '</div></fieldset>';
    } else {
      html += '<label class="field">' + esc(fieldLabel(k, spec)) +
        (spec.required ? ' <span class="req">(' + esc(jcT("ev_required")) + ')</span>' : '') +
        '<input type="text" data-text="' + esc(k) + '" maxlength="' + esc(spec.max || 200) + '"></label>';
    }
  });
  html += '<label class="field">' + esc(jcT("ev_note")) + '<textarea id="note" maxlength="280"></textarea></label>' +
    '<p class="help">' + esc(jcT("ev_note_help")) + '</p>' +
    '<button class="btn" id="go" type="submit">' + esc(jcT("ev_save")) + '</button>' +
    '<button class="btn ghost" id="cancel" type="button">' + esc(jcT("ev_cancel")) + '</button></form>';
  el("body").innerHTML = html;
  /* no selectors built from schema keys (T5.1 review): match on dataset values instead */
  var texts = Array.prototype.slice.call(document.querySelectorAll("#form [data-text]"));
  var opts = Array.prototype.slice.call(document.querySelectorAll("#form [data-field]"));
  texts.forEach(function(i){
    i.value = i.defaultValue = prev[i.dataset.text] != null ? String(prev[i.dataset.text]) : "";
  });
  el("note").value = el("note").defaultValue = mine.status === "in" ? (mine.note || "") : "";
  opts.forEach(function(b){
    b.addEventListener("click", function(){
      var k = b.dataset.field;
      chosen[k] = JSON.parse(b.dataset.value);
      opts.forEach(function(x){ if (x.dataset.field === k) x.setAttribute("aria-pressed", String(x === b)); });
    });
  });
  on("cancel", function(){ editing = false; show("detail"); });
  el("form").addEventListener("submit", function(ev2){
    ev2.preventDefault();
    /* the FULL payload — every answer + the note — never a partial update */
    var payload = {}, missing = false;
    Object.keys(fields).forEach(function(k){
      var spec = fields[k] || {};
      if (spec.type === "text") {
        var input = texts.filter(function(i){ return i.dataset.text === k; })[0];
        var t = input ? input.value.trim() : "";
        if (t) payload[k] = t;
      } else if (chosen[k] !== undefined) {
        payload[k] = chosen[k];
      }
      if (spec.required && payload[k] === undefined) missing = true;
    });
    if (missing) return showErr("PAYLOAD_INCOMPLETE");
    var note = el("note").value.trim();
    if (note) payload.note = note;
    busy("go", true);
    gen++;
    rpc("jc_event_signup", { p_event: ev.id, p_payload: payload }).then(function(d){
      data = d; editing = false; show("detail"); showOk(jcFmt(isVenue(d.event) ? "ev_venue_in" : "ev_signed_up", { h: myLabel() }));
    }, function(e){
      if (e.code === "NO_PIN") return goPin();   /* server safety net (T5.2 PR 3): same redirect */
      if (e.code === "FULL") {                   /* the last place went meanwhile: show the new count */
        return rpc("jc_event_get", { p_event: ev.id }).then(function(d){
          data = d; editing = false; show("detail"); showErr("FULL");
        }, function(){ editing = false; show("detail"); showErr("FULL"); });   /* never back into the same form (review) */
      }
      busy("go", false); showErr(e.code);
    });
  });
}

/* ---------- event day (T5.2 PR 5b) ----------
   From 2 h before the start until the end: the household's two-sided switch + supply levels,
   neighbors' "they're out" reports, and a refresh every 2 minutes while the page is in view.
   Undated events never get an event day; a start with no end runs 6 h. */
var LEAD_MS = 2 * 3600e3, NO_END_MS = 6 * 3600e3;
var REFRESH_MS = window.JC_REFRESH_MS || 120000;   /* JC_REFRESH_MS: tests only */
var lastAt = null, stale = false;   /* when `data` last came from the server; the last refresh failed */
var acting = false, gen = 0;        /* an event-day action in flight; bumps so an older refresh is dropped */
var reported = {};
var staleAfterReport = false;                  /* entries this device reported — memory only (the server dedups too) */

function eventDay(ev){
  if (!ev || ev.status !== "live" || isVenue(ev) || !ev.starts_at) return false;
  /* R2a: the server's end (ends_effective) wins — one rule for "event day" and "ended"; NO_END_MS is the fallback */
  var s = Date.parse(ev.starts_at), e = ev.ends_effective ? Date.parse(ev.ends_effective)
        : ev.ends_at ? Date.parse(ev.ends_at) : s + NO_END_MS, now = Date.now();
  return now >= s - LEAD_MS && now <= e;
}
/* R2a (D2): an event past its end takes no sign-ups or withdrawals; it shows under Past until it closes */
/* the server says so; between refreshes the server's end time decides (the page may stay open past it) */
function ended(ev){
  return !!(ev && ev.status === "live" && (ev.ended === true || (ev.ends_effective && Date.parse(ev.ends_effective) < Date.now())));
}
function openNow(ev){ return !!(ev && ev.signups_open && !ended(ev)); }
function feat(ev, k){ return !!(ev && ev.features && ev.features[k] === true); }
/* treat nights say "Handing Out / Out of Treats"; other events "Open / Done" (key + "_treats") */
function treatKey(ev, k){ return TREAT_LOOKS[lookOf(ev)] === true ? k + "_treats" : k; }
var SUPPLY = [3, 2, 1, 0];          /* Plenty · Some left · Running low · Almost out (server: 0–3) */
/* "▮▮▮▯ Supply: Some left" — a four-bar gauge, like a phone battery (Zee, 2026-11-05) */
function gaugeHtml(level){
  return '<span class="gauge" aria-hidden="true">' + [0, 1, 2, 3].map(function(i){
    return '<i' + (i <= level ? ' class="on"' : '') + '></i>';
  }).join("") + '</span>';
}
function supplyLine(e){
  if (!feat(data.event, "supply") || pinState(e) || SUPPLY.indexOf(e.supply_level) < 0) return "";
  return '<div class="supply">' + gaugeHtml(e.supply_level) + esc(jcFmt("ev_supply_line", { s: jcT("ev_supply_" + e.supply_level) })) + '</div>';
}
function fmtTime(d){
  return d.toLocaleTimeString(ar() ? "ar-AE-u-nu-latn" : "en-US",
    { hour: "numeric", minute: "2-digit", timeZone: (cfg && cfg.tz) || "Asia/Dubai" });
}
/* "7:42 PM" today, "4 Nov 7:42 PM" another day; "" for anything unreadable */
function fmtStamp(iso){
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return (fmtDate(iso) === fmtDate(new Date().toISOString()) ? "" : fmtDate(iso) + " ") + fmtTime(d);
}

/* My Sign-Up: "Right now, Villa 12 is… [Handing Out | ✕ Out of Treats]" and the four supply
   levels — every choice visible, the current one filled; never a button that cycles (Zee). */
function liveHtml(){
  var ev = data.event, mine = data.mine;
  var sw = feat(ev, "giant_switch"), sup = feat(ev, "supply");
  if (!eventDay(ev) || !mine || mine.status !== "in" || (!sw && !sup)) return "";
  var done = mine.live_state === "done", look = lookOf(ev);
  var html = '<div class="live" id="live">';
  if (sw) {
    html += '<p class="liveq">' + esc(jcFmt("ev_live_q", { h: myLabel() })) + '</p>' +
      '<div class="tog" role="group" aria-label="' + esc(jcFmt("ev_live_q", { h: myLabel() })) + '">' +
        '<button type="button" data-live="active" aria-pressed="' + !done + '">' +
          (look ? '<span aria-hidden="true">' + LOOK_MARKS[look] + '</span> ' : '') + esc(jcT(treatKey(ev, "ev_live_on"))) + '</button>' +
        '<button type="button" data-live="done" aria-pressed="' + done + '"><span aria-hidden="true">✕</span> ' +
          esc(jcT(treatKey(ev, "ev_live_off"))) + '</button></div>';
  }
  if (sup && !done) {
    html += '<p class="liveq">' + esc(jcT("ev_supply_q")) + '</p>' +
      '<div class="seg4" role="group" aria-label="' + esc(jcT("ev_supply_q")) + '">' + SUPPLY.map(function(n){
        return '<button type="button" data-supply="' + n + '" aria-pressed="' + (mine.supply_level === n) + '">' +
          esc(jcT("ev_supply_" + n)) + '</button>';
      }).join("") + '</div>' +
      (SUPPLY.indexOf(mine.supply_level) >= 0 ? '<p class="liveq">' + esc(jcT("ev_supply_clear_hint")) + '</p>' : '');
  }
  return html + '</div>';
}
function wireLive(){
  Array.prototype.forEach.call(document.querySelectorAll("#live [data-live]"), function(b){
    b.addEventListener("click", function(){
      if (b.getAttribute("aria-pressed") === "true") return;
      act("jc_entry_live_set", { p_event: data.event.id, p_state: b.dataset.live, p_supply: null });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#live [data-supply]"), function(b){
    b.addEventListener("click", function(){
      /* R2b-1: the level that's already on, tapped again, clears it ("I tapped Plenty by mistake" — Zee) */
      if (b.getAttribute("aria-pressed") === "true") return act("jc_entry_supply_clear", { p_event: data.event.id });
      act("jc_entry_live_set", { p_event: data.event.id, p_state: null, p_supply: Number(b.dataset.supply) });
    });
  });
}

/* The household's private banner after the first neighbor report (3+ put ? on the map).
   On every tab — the household is probably looking at the map. Not limited to the event-day
   window: a report can only exist while the event is live with reports on. */
function bannerHtml(){
  var ev = data.event, mine = data.mine;
  if (!mine || mine.status !== "in" || ev.status !== "live" || !feat(ev, "crowd_reports") ||
      mine.live_state === "done" || !(mine.reports_open > 0)) return "";
  return '<div class="alert" role="alert"><b>' + esc(jcFmt(treatKey(ev, "ev_banner"), { h: myLabel() })) + '</b>' +
    '<div class="alertacts"><button type="button" class="btn" id="notOut">' + esc(jcT(treatKey(ev, "ev_not_out"))) + '</button>' +
    (feat(ev, "giant_switch") ? '<button type="button" class="btn ghost" id="yesOut">' + esc(jcT(treatKey(ev, "ev_yes_out"))) + '</button>' : '') +
    '</div></div>';
}
/* banner + "Updated 7:42 PM"; returns true when either changed (the map needs refitting) */
var dayShown = false;               /* was the event-day window open at the last paint */
var endedShown = false;             /* R2a: had the event ended at the last paint */
function paintDay(){
  var b = el("banner"), u = el("upd"), changed = false;
  if (b) {
    var html = bannerHtml();
    if (b.innerHTML !== html) {             /* untouched otherwise: role=alert re-announces on change */
      b.innerHTML = html; changed = true;
      on("notOut", function(){
        act("jc_entry_reports_clear", { p_event: data.event.id }, jcT("ev_not_out_ok"));
      });
      on("yesOut", function(){
        act("jc_entry_live_set", { p_event: data.event.id, p_state: "done", p_supply: null });
      });
    }
  }
  dayShown = eventDay(data.event);
  endedShown = ended(data.event);
  if (u) {
    var show = dayShown && !!lastAt;
    var text = show ? jcFmt(stale ? "ev_updated_stale" : "ev_updated", { t: fmtTime(lastAt) }) : "";
    if (u.hidden !== !show || u.textContent !== text) changed = true;   /* the line can wrap: refit the map (R6) */
    u.hidden = !show;
    u.classList.toggle("stale", stale);
    u.textContent = text;
  }
  return changed;
}

/* One event-day write at a time; the reply is the whole event (jc_event_get), drawn in place. */
function act(name, args, okText){
  if (acting) return;
  acting = true; gen++;
  refocus = focusSel();
  Array.prototype.forEach.call(document.querySelectorAll("#live button, #banner button"), function(x){ x.disabled = true; });
  rpc(name, args).then(function(d){
    data = d; lastAt = new Date(); stale = false;
    repaint();
    if (okText) showOk(okText);
  }, function(e){
    Array.prototype.forEach.call(document.querySelectorAll("#live button, #banner button"), function(x){ x.disabled = false; });
    showErr(e.code);
  }).finally(function(){ acting = false; });   /* finally: a throw while drawing never leaves it stuck (review R2) */
}

/* A neighbor's popup: "They're Out of Treats" → one report (asks first). A text link in the same row
   as Directions / Google Maps, same weight — a big button there got hit by mistake (Zee, 2026-11-05). */
function canReport(e){
  var ev = data.event;
  return !e.mine && eventDay(ev) && feat(ev, "crowd_reports") && e.live_state !== "done";
}
function reportLink(e){
  if (!canReport(e) || reported[e.id]) return "";
  return '<button type="button" class="rep" data-report="' + esc(e.id) + '">' + esc(jcT(treatKey(data.event, "ev_report"))) + '</button>';
}
function reportedLine(e){
  return canReport(e) && reported[e.id] ? '<div class="pinstate">' + esc(jcT("ev_reported_thanks")) + '</div>' : '';
}
function report(e, popup, btn){
  if (acting || !window.confirm(jcFmt(treatKey(data.event, "ev_report_confirm"), { h: jcHomeLabel(e) }))) return;
  acting = true; btn.disabled = true;
  rpc("jc_entry_report", { p_entry: e.id }).then(function(){
    reported[e.id] = true;
    popup.setContent(popupHtml(e));
    showOk(jcFmt("ev_reported_ok", { h: jcHomeLabel(e) }));
  }, function(err){
    btn.disabled = false;
    showErr(err.code);
    if (err.code === "ALREADY_DONE" || err.code === "NOT_FOUND") staleAfterReport = true;   /* the pin was out of date (R5) */
  }).finally(function(){
    acting = false;
    if (staleAfterReport) { staleAfterReport = false; refresh(); }
  });
}

/* Redraw what the server changed without rebuilding the page: the map keeps its zoom and an open
   popup (redrawn when it closes), the list keeps its search, a half-filled form is never touched. */
var homeLayer = null, popupOpen = false, pendingRepaint = false;
function repaint(){
  if (current !== "detail" || !data) return;
  if (data.event.status !== "live") return show(data.event.status === "archived" ? "stats" : "detail");
  var s = el("evsub");
  if (s) s.textContent = headSub(data.event, data.entries || []);
  var moved = paintDay();
  if (tab === "map") {
    if (popupOpen) pendingRepaint = true; else drawHomes(data.entries || []);
    if (moved) fitSoon();
  } else if (tab === "list") {
    var q = el("q");
    if (q && document.activeElement === q) return;   /* typing a search: next round */
    var y = window.scrollY;
    renderList(data.entries || [], q ? q.value : "");
    window.scrollTo(0, y);
  } else if (!editing && mineKey() !== mineShown) {
    /* only when something on this tab changed; keep focus on the switch / level just tapped (R3) */
    var sel = refocus || focusSel();
    renderMine();
    var nf = sel && (document.querySelector("#live " + sel) || document.querySelector("#live [data-live]"));
    if (nf) nf.focus();
  }
  refocus = null;
}
/* the switch side / level that has focus — noted before act() disables it (disabling drops focus) */
var refocus = null;
function focusSel(){
  var f = document.activeElement;
  return f && f.dataset && (f.dataset.live ? '[data-live="' + f.dataset.live + '"]'
    : f.dataset.supply ? '[data-supply="' + f.dataset.supply + '"]' : null);
}
var mineShown = null;
function mineKey(){
  return JSON.stringify([data.mine, data.event.features, data.event.signups_open, ended(data.event), eventDay(data.event)]);
}

function refreshDue(){
  return !!EVENT_ID && current === "detail" && !editing && !document.hidden && eventDay(data && data.event);
}
var refreshing = false;
function refresh(){
  if (refreshing || acting || !refreshDue()) return;
  refreshing = true;
  var g = gen;
  rpc("jc_event_get", { p_event: EVENT_ID }).then(function(d){
    if (g !== gen || !refreshDue()) return;   /* an action answered meanwhile, or the form opened */
    data = d; lastAt = new Date(); stale = false;
    repaint();
  }, function(){
    stale = true;                             /* keep what's on screen; say how old it is */
    if (paintDay()) fitSoon();
  }).finally(function(){ refreshing = false; });
}
/* every ~2 minutes, ±10 % so a street of phones doesn't hit the database in the same second; the
   window opening or closing while the page sits open redraws once (controls appear / go — R7) */
function tick(){
  /* R2a (D2): so does the end passing — a venue / undated-day event has no event-day window to close */
  if (current === "detail" && data && !editing
      && (eventDay(data.event) !== dayShown || ended(data.event) !== endedShown)) repaint();
  refresh();
  setTimeout(tick, REFRESH_MS * (0.9 + 0.2 * Math.random()));
}
setTimeout(tick, REFRESH_MS * (0.9 + 0.2 * Math.random()));
document.addEventListener("visibilitychange", function(){
  /* back in view: at most once every 15 s (switching apps quickly) */
  if (!document.hidden && (!lastAt || Date.now() - lastAt.getTime() > 15000)) refresh();
});

/* ---------- map + list (Halloween-site parity, plan audit 2026-11-03) ---------- */
var layer = "sat";
var listSort = "number";   /* number | distance */
/* The visitor's own position — held in memory only, never sent or stored. Used for
   "≈ 120 m from you" and sort-by-distance, exactly as the Halloween site did. */
var userPos = null;

function locate(done){
  jcLocate(function(lat, lng){ userPos = L.latLng(lat, lng); done(); },
    function(code){ full.set(false); showErr(code); });   /* the message sits above the map: leave full screen to show it (courts review, parity) */
}
function dist(e){ return userPos && hasPos(e) ? userPos.distanceTo(L.latLng(e.lat, e.lng)) : null; }
function fmtDist(m){ return m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km"; }
/* house-number order: building, then the number's digits numerically (9 before 10), then the rest */
function byNumber(a, b){
  var ba = String(a.building || ""), bb = String(b.building || "");
  if (ba !== bb) return ba.localeCompare(bb, "en", { numeric: true });
  return String(a.number).localeCompare(String(b.number), "en", { numeric: true, sensitivity: "base" });
}
function directionsUrl(e){
  return jcDirectionsUrl(e.lat, e.lng);
}
function pinUrl(e){ return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(e.lat + "," + e.lng); }
function answers(e){
  var bits = [];
  Object.keys(e.payload || {}).forEach(function(k){
    var spec = ((data.event.payload_schema || {}).fields || {})[k];
    if (spec && spec.type !== "text") bits.push(valueLabel(spec, e.payload[k]));
  });
  return bits;
}
/* "Done for the night" / "Neighbors say they're out" — or nothing */
function stateLine(e){
  var st = pinState(e);
  return st ? '<div class="pinstate ' + st + '">' + esc(jcT(st === "done" ? outKey(data.event, "ev_pin_done") : "ev_pin_reported")) + '</div>'
            : supplyLine(e);
}
/* Popup = HTML, so EVERYTHING resident-typed is escaped (numbers, buildings, notes). */
function popupHtml(e){
  var d = dist(e), gf = pinField(data.event, "glyph");
  return '<div class="pop"><b>' + (gf ? glyphHtml(gf.spec, e.payload && e.payload[gf.key]) + ' ' : '') + esc(jcHomeLabel(e)) + '</b>' +
    '<div class="meta">' + esc(jcVillageName(cfg, e.village)) + '</div>' + stateLine(e) +
    (answers(e).length ? '<div>' + esc(answers(e).join(" · ")) + '</div>' : '') +
    (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') +
    (d !== null ? '<div class="meta">' + esc(jcFmt("ev_dist_from_you", { d: fmtDist(d) })) + '</div>' : '') +
    '<div class="popacts"><a target="_blank" rel="noopener" href="' + esc(directionsUrl(e)) + '">' + esc(jcT("ev_directions")) + '</a>' +
    '<a target="_blank" rel="noopener" href="' + esc(pinUrl(e)) + '">' + esc(jcT("ev_view_pin")) + '</a>' +
    reportLink(e) + '</div>' + reportedLine(e) + '</div>';
}

/* R2b-2: the event's safety box — the community's security line (a tel: link) and the lost-child meeting point.
   Only when the organizer switched it on and filled something in; never on a closed event. The number is linked
   only if it passes the server's rule, so a bad stored value is plain text, never a link. */
function safetyHtml(ev){
  var sf = ev.safety, on = ev.features && ev.features.safety === true;
  if (!on || !sf || typeof sf !== "object" || ev.status === "archived") return "";
  var phone = jcOwn(sf, "phone"), mine = jcOwn(sf, ar() ? "meeting_ar" : "meeting_en");
  var meet = mine || jcOwn(sf, ar() ? "meeting_en" : "meeting_ar");
  var meetLang = mine ? "" : ' lang="' + (ar() ? "en" : "ar") + '"';         /* the other language's text (review) */
  if (!phone && !meet) return "";
  return '<div class="safety" id="safety" role="note" aria-label="' + esc(jcT("ev_safety")) + '">' +
    (phone ? '<p><span aria-hidden="true">🛡️</span> ' + esc(jcT("ev_safety_call")) + ': ' +
      (typeof jcSafetyPhoneOk === "function" && jcSafetyPhoneOk(phone) ? '<a href="tel:' + phone.replace(/[^0-9+]/g, "") + '" dir="ltr">' + esc(phone) + '</a>'
                              : '<bdi dir="ltr">' + esc(phone) + '</bdi>') + '</p>' : '') +
    (meet ? '<p><span aria-hidden="true">📍</span> ' + esc(jcT("ev_safety_meet")) + ': <b dir="auto"' + meetLang + '>' + esc(meet) + '</b></p>' : '') +
    '</div>';
}

/* "More" only when the description is actually cut off; it stays open across tab switches */
var descOpen = false;
function wireDesc(){
  var d = el("desc"), b = el("descMore");
  if (!d || !b) return;
  d.classList.toggle("open", descOpen);
  b.textContent = jcT(descOpen ? "ev_less" : "ev_more");
  b.onclick = function(){ descOpen = !descOpen; wireDesc(); fitMap(); };
  measureDesc();
}
/* re-measured when fonts arrive or the width changes, so cut-off text always gets More (review) */
function measureDesc(){
  var d = el("desc"), b = el("descMore");
  if (d && b) b.hidden = !descOpen && d.scrollHeight <= d.clientHeight + 1;
}

/* The map fills what's left of the screen between the tabs and the tab bar, so it's all
   visible without scrolling (Zee, 2026-11-04). Never below 260px; recomputed on resize,
   rotation and Safari's toolbar growing / shrinking. */
function fitMap(){
  var m = el("map");
  if (!m) return;
  if (full.on) { if (map) map.invalidateSize(); return; }   /* full screen: CSS sizes it */
  /* innerHeight follows Safari's toolbar; visualViewport would also shrink on pinch-zoom (review) */
  var vh = window.innerHeight;
  var bar = el("tabbar") ? el("tabbar").getBoundingClientRect().height : 0;
  var ah = el("mapAfter") ? el("mapAfter").getBoundingClientRect().height : 0;   /* the key, venue line… (may be empty) */
  var after = ah ? ah + 8 : 0;
  var top = m.getBoundingClientRect().top + window.scrollY;
  var want = Math.floor(vh - top - bar - after - 12);
  var h = Math.max(260, want);
  /* too tall to fit (a long header + a three-row key on a small phone): let the page scroll, with
     room under the key for the tab bar, instead of hiding the key behind it (5a.1) */
  document.body.classList.toggle("evfit", want >= 260);
  if (Math.abs(m.offsetHeight - h) < 2) return;
  m.style.height = h + "px";
  if (map) map.invalidateSize();
}

var fitTimer = null;
function fitSoon(){ clearTimeout(fitTimer); fitTimer = setTimeout(function(){ measureDesc(); fitMap(); }, 120); }
window.addEventListener("resize", fitSoon);
window.addEventListener("orientationchange", fitSoon);

function renderMap(entries){
  var ev = data.event, venue = isVenue(ev);
  /* one place: the venue is the only pin (the server sends no homes for it) */
  if (venue) {
    var spot = { venue: true, lat: ev.venue_lat, lng: ev.venue_lng };
    entries = hasPos(spot) ? [spot] : [];   /* both coordinates, or no pin (review) */
  }
  var unpinned = venue ? 0 : entries.filter(function(e){ return !hasPos(e); }).length;
  full.reset();   /* a redrawn map starts in the page */
  el("body").innerHTML =
    /* top right, one row: Map Labels · Street; Find Me bottom right (Zee, 2026-11-06) */
    jcMapHtml("map", layer, { before: venue || !legendHtml(ev) ? '' :
      '<button type="button" class="lang" id="labelsBtn" aria-haspopup="dialog">' + esc(jcT("ev_labels")) + '</button>' }) +
    '<dialog class="sheet" id="labels" aria-label="' + esc(jcT("ev_labels")) + '"></dialog>' +
    '<div id="mapAfter">' +
    (unpinned ? '<p class="help" style="margin-top:8px">' + esc(unpinned) + ' · ' + esc(jcT("ev_unpinned")) +
      ' — <a href="#" id="seeList">' + esc(jcT("ev_list")) + '</a></p>' : '') +
    (venue && !entries.length && ev.coming_soon ? '<p class="help venueline">📍 ' + esc(jcT("ev_place_tba")) + '</p>' :
     venue ? '<p class="help venueline" dir="auto">📍 <b>' + esc(placeName(ev) || jcT("ev_the_place")) + '</b>' +
      (entries.length ? ' — <a target="_blank" rel="noopener" href="' + esc(directionsUrl(entries[0])) + '">' + esc(jcT("ev_directions")) + '</a>' : '') +
      '</p>' : '') + '</div>';
  on("seeList", function(e){ e.preventDefault(); el("tab-list").click(); });
  on("labelsBtn", openLabels);
  on("fullBtn", function(){ full.set(!full.on); });
  var m0 = document.querySelector(".evmapwrap");
  var dl = el("labels");   /* a tap on the dimmed backdrop closes it */
  if (dl) dl.addEventListener("click", function(e2){
    if (e2.target !== dl) return;
    var r = dl.getBoundingClientRect();     /* the window's own padding also reports the dialog: outside only (F2) */
    if (e2.clientX < r.left || e2.clientX > r.right || e2.clientY < r.top || e2.clientY > r.bottom) closeLabels(dl);
  });
  document.body.classList.add("evfit");     /* the map screen doesn't scroll: no spare padding under it */
  fitMap();                                 /* before Leaflet measures the box… */
  requestAnimationFrame(fitSoon);           /* …and again once the page has settled (fonts, header) */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);
  var c = (cfg && cfg.map) || {};
  map = L.map("map", { zoomControl: true }).setView([c.lat || 24.53, c.lng || 54.43], c.zoom || 14);
  jcMapLayers(map, "layerBtn", layer, function(l){ layer = l; });
  var col = jcMapColors(), accent = col.accent, ink = col.ink;
  var pts = [], me = null;
  entries.forEach(function(e){ if (hasPos(e)) pts.push([e.lat, e.lng]); });
  if (venue && pts.length) {
    L.circleMarker(pts[0], { radius: 12, weight: 3, color: ink, fillColor: accent, fillOpacity: .9 })
      /* Leaflet sets string tooltip content as HTML: the organizer-typed name is escaped (review: XSS) */
      .addTo(map).bindTooltip('<span dir="auto">' + esc(placeName(ev) || jcT("ev_the_place")) + '</span>',
                              { permanent: true, direction: "top", offset: [0, -12] });
  } else if (!venue) {
    drawHomes(entries);
  }
  /* a neighbor's "They're Out" button lives in the popup; a refresh waits for the popup to close */
  map.on("popupopen", function(pe){
    popupOpen = true;
    m0.classList.add("popopen");            /* Street / Map Labels / Find Me step aside while a popup is open */
    var node = pe.popup.getElement(), b = node && node.querySelector("[data-report]");
    var e = b && (data.entries || []).filter(function(x){ return x.id === b.dataset.report; })[0];
    if (e) b.addEventListener("click", function(){ report(e, pe.popup, b); });
  });
  map.on("popupclose", function(){
    popupOpen = false;
    m0.classList.remove("popopen");
    if (pendingRepaint) { pendingRepaint = false; drawHomes(data.entries || []); }
  });
  on("locateBtn", function(){
    locate(function(){
      if (!map) return;
      me = jcMeDot(map, userPos, me);
      map.setView(userPos, Math.max(map.getZoom(), 17));
    });
  });
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 18 });
  else if (pts.length === 1) map.setView(pts[0], 18);
}


/* the homes' pins, in their own layer so a refresh redraws them without moving the map */
function drawHomes(entries){
  if (!map) return;
  if (homeLayer) homeLayer.clearLayers(); else homeLayer = L.layerGroup().addTo(map);
  entries.forEach(function(e){
    if (!hasPos(e)) return;
    /* your own home on top of its neighbours */
    L.marker([e.lat, e.lng], { icon: pinIcon(e), zIndexOffset: e.mine ? 1000 : 0, keyboard: true, title: jcHomeLabel(e) })
      .addTo(homeLayer).bindPopup(function(){ return popupHtml(e); }, JC_POPUP);   /* rebuilt on open: distance stays current */
  });
}

function renderList(entries, q){
  el("body").innerHTML =
    '<label class="field"><input type="text" id="q" placeholder="' + esc(jcT("ev_search")) + '" autocomplete="off"></label>' +
    '<div class="seg2" role="group">' +
      '<button type="button" id="sortNum" aria-pressed="' + (listSort === "number") + '">' + esc(jcT("ev_sort_number")) + '</button>' +
      '<button type="button" id="sortDist" aria-pressed="' + (listSort === "distance") + '">' + esc(jcT("ev_sort_distance")) + '</button></div>' +
    '<div id="groups"></div>';
  var input = el("q");
  input.value = input.defaultValue = q || "";
  on("sortNum", function(){ listSort = "number"; renderList(entries, input.value); });
  on("sortDist", function(){ locate(function(){ listSort = "distance"; renderList(entries, input.value); }); });
  function draw(){
    var needle = input.value.trim().toLowerCase();
    var groups = {};
    entries.forEach(function(e){
      var label = jcHomeLabel(e);
      if (needle && label.toLowerCase().indexOf(needle) === -1 && String(e.number).toLowerCase().indexOf(needle) === -1) return;
      (groups[e.village] = groups[e.village] || []).push(e);
    });
    var byDist = listSort === "distance" && userPos;
    function nearest(v){ return Math.min.apply(null, groups[v].map(function(e){ var d = dist(e); return d === null ? Infinity : d; })); }
    var villages = Object.keys(groups).sort(function(a, b){
      return byDist ? nearest(a) - nearest(b) : jcVillageName(cfg, a).localeCompare(jcVillageName(cfg, b));
    });
    el("groups").innerHTML = villages.map(function(v){
      var list = groups[v].slice().sort(byDist
        ? function(a, b){ var da = dist(a), db = dist(b); return (da === null ? Infinity : da) - (db === null ? Infinity : db); }
        : byNumber);
      return '<h2 class="group">' + esc(jcVillageName(cfg, v)) + ' · ' + esc(list.length) + '</h2><ul class="entries">' + list.map(function(e){
        var bits = answers(e);
        if (!hasPos(e)) bits.push(jcT("ev_unpinned"));
        var d = dist(e);
        var gf = pinField(data.event, "glyph");
        return '<li class="' + (e.mine ? "mine" : "") + '"><b>' + (gf ? glyphHtml(gf.spec, e.payload && e.payload[gf.key]) + ' ' : '') + esc(jcHomeLabel(e)) + '</b>' +
          (e.mine ? ' <span class="meta">· ' + esc(jcT("ev_mine")) + '</span>' : '') +
          (d !== null ? ' <span class="meta">· ' + esc(fmtDist(d)) + '</span>' : '') +
          (bits.length ? '<div class="meta">' + esc(bits.join(" · ")) + '</div>' : '') + stateLine(e) +
          (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') +
          (hasPos(e) ? '<div class="popacts"><a target="_blank" rel="noopener" href="' + esc(directionsUrl(e)) + '">' +
            esc(jcT("ev_directions")) + '</a></div>' : '') + '</li>';
      }).join("") + '</ul>';
    }).join("");
  }
  input.addEventListener("input", draw);
  draw();
}

function loadEvent(){
  el("view").innerHTML = '<p class="sub">' + esc(jcT("working")) + '</p>' + msgBox();
  return rpc("jc_event_get", { p_event: EVENT_ID }).then(function(d){
    data = d; lastAt = new Date();
    var wantStats = params.get("view") === "stats" || d.event.status === "archived";
    jcHit(wantStats ? "stats" : "events");
    show(wantStats ? "stats" : "detail");
  }, function(e){
    jcBack("./", "ev_back");
    el("view").innerHTML = msgBox();
    showErr(e.code);
  });
}

/* ---------- boot ---------- */
function paint(){
  var name = jcCommunityName(cfg, state && state.me && state.me.community);
  el("homeLink").textContent = name;
  el("langBtn").textContent = jcT("toggle_label");
  document.title = jcModTitle("events") + " — " + name;
  if (state && state.status === "member") jcTabBar("../", "events", cfg);
}

el("langBtn").addEventListener("click", function(){
  jcSetLang(ar() ? "en" : "ar");
  paint();
  if (editing) return;                     /* don't throw away a half-filled form */
  if (current) show(current);
});

jcSetLang(jcLang());
paint();
jcState().then(function(s){
  state = s;
  if (s.status === "signed_out") { location.replace("../account/?next=" + encodeURIComponent("../events/")); return; }
  if (s.status === "not_member") { location.replace("../account/?view=join&next=" + encodeURIComponent("../events/")); return; }
  return jcAnon("jc_config_get", { p_community: s.me.community }).catch(function(){ return null; }).then(function(c){
    cfg = c;
    paint();
    if (EVENT_ID) return loadEvent();
    jcHit("events");
    show("list");
  });
}, function(e){
  el("view").innerHTML = msgBox();
  showErr(e.code || "UNKNOWN");
});
