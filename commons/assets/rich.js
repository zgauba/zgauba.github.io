/* Event description formatting (Zee, 2026-11-05) — a deliberately tiny subset, stored as plain
   text, never as HTML:  "## " heading line · **bold** · __underline__ · "- " bullets · "1. " numbers.
   jcRich ESCAPES EVERYTHING FIRST, then turns only those markers into tags it writes itself, so
   organizer-typed text can never become markup. Plain old descriptions render as before.
   jcRichToolbar wires the editor buttons (they insert the markers) + a live preview.
   Load after api.js (esc, jcT). */

function jcRich(src){
  var lines = esc(String(src == null ? "" : src)).split(/\r?\n/);
  var out = [], para = [], list = null;
  function inline(t){
    return t.replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/__(?=\S)(.+?)__/g, "<u>$1</u>");
  }
  function flushPara(){ if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } }
  function flushList(){
    if (!list) return;
    out.push("<" + list.tag + ">" + list.items.map(function(i){ return "<li>" + inline(i) + "</li>"; }).join("") + "</" + list.tag + ">");
    list = null;
  }
  function item(tag, text){
    flushPara();
    if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
    list.items.push(text);
  }
  lines.forEach(function(l){
    var m;
    if (/^\s*$/.test(l)) { flushPara(); flushList(); return; }
    if ((m = l.match(/^\s*##\s+(.*)$/))) { flushPara(); flushList(); out.push("<h3>" + inline(m[1]) + "</h3>"); return; }
    if ((m = l.match(/^\s*[-•*]\s+(.*)$/))) return item("ul", m[1]);
    if ((m = l.match(/^\s*[0-9٠-٩]+[.)]\s+(.*)$/))) return item("ol", m[1]);
    flushList(); para.push(l);
  });
  flushPara(); flushList();
  return out.join("");
}

/* The five buttons over a description box. They only add / remove the markers, so the stored
   text stays plain; the preview under the box shows what residents will see. */
function jcRichToolbar(textarea, preview){
  var bar = document.createElement("div");
  bar.className = "richbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", jcT("rich_toolbar"));
  [["h", "H"], ["b", "B"], ["u", "U"], ["ul", "•"], ["ol", "1."]].forEach(function(b){
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "mini rich-" + b[0]; btn.textContent = b[1];
    btn.setAttribute("aria-label", jcT("rich_" + b[0]));
    btn.addEventListener("mousedown", function(e){ e.preventDefault(); });   /* keep the selection */
    btn.addEventListener("click", function(){ apply(b[0]); });
    bar.appendChild(btn);
  });
  textarea.parentNode.insertBefore(bar, textarea);

  function draw(){
    var html = jcRich(textarea.value);
    preview.innerHTML = html;            /* jcRich output: escaped text + our own tags only */
    preview.hidden = !textarea.value.trim();
  }
  function changed(start, end){
    textarea.focus();
    textarea.setSelectionRange(start, end);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function wrap(mark){
    var v = textarea.value, s = textarea.selectionStart, e = textarea.selectionEnd;
    var sel = v.slice(s, e);
    if (sel.length > 2 * mark.length && sel.indexOf(mark) === 0 && sel.slice(-mark.length) === mark) {
      textarea.value = v.slice(0, s) + sel.slice(mark.length, -mark.length) + v.slice(e);   /* toggle off */
      return changed(s, e - 2 * mark.length);
    }
    textarea.value = v.slice(0, s) + mark + sel + mark + v.slice(e);
    changed(s + mark.length, e + mark.length);
  }
  function lines(fn){
    var v = textarea.value, s = textarea.selectionStart, e = textarea.selectionEnd;
    var from = v.lastIndexOf("\n", s - 1) + 1;
    var to = v.indexOf("\n", e); if (to < 0) to = v.length;
    var block = v.slice(from, to).split("\n").map(fn).join("\n");
    textarea.value = v.slice(0, from) + block + v.slice(to);
    changed(from, from + block.length);
  }
  function apply(kind){
    if (kind === "b") return wrap("**");
    if (kind === "u") return wrap("__");
    if (kind === "h") return lines(function(l){ return /^##\s/.test(l) ? l.replace(/^##\s+/, "") : "## " + l; });
    if (kind === "ul") return lines(function(l){ return /^-\s/.test(l) ? l.replace(/^-\s+/, "") : "- " + l.replace(/^\d+[.)]\s+/, ""); });
    var n = 0;
    if (kind === "ol") return lines(function(l){ return /^\d+[.)]\s/.test(l) ? l.replace(/^\d+[.)]\s+/, "") : (++n) + ". " + l.replace(/^-\s+/, ""); });
  }
  textarea.addEventListener("input", draw);
  draw();
}
