/* Jubail Commons — strings dictionary (EN/AR).
   Every user-visible string lives here; markup never hardcodes copy.
   Arabic entries are drafts PENDING NATIVE-SPEAKER REVIEW (flagged "ar_draft"
   until a reviewer clears them — see backlog).
   Gotcha (learned Oct 2026): never place "·" directly after Arabic-Indic
   digits — it reads like ٠ (zero). Use "،" or parentheses in AR strings. */

var JC_STRINGS = {
  en: {
    dir: "ltr",
    lang: "en",
    brand: "Jubail Commons",
    tagline: "Community celebrations, bookings and more — by neighbors, for neighbors.",
    toggle_label: "عربي",
    module_events: "Events",
    module_events_desc: "Community celebrations, mapped. Sign your home up and manage your own listing.",
    module_bookings: "Court bookings",
    module_bookings_desc: "Book community courts and facilities.",
    module_pets: "Pets of Jubail",
    module_pets_desc: "The neighborhood pet directory.",
    coming_soon: "Coming soon",
    archive_halloween: "Halloween 2026",
    archive_halloween_desc: "Where it all started — the trick-or-treat map.",
    archive_open: "Open the map",
    privacy_line: "Zero-PII by default: no names, emails or phone numbers unless a feature asks, per-feature and opt-in.",
    error_config: "Couldn't load community settings — showing defaults. Pull to refresh or try again shortly.",
    footer_credit: "Made by your neighbor in Ain Al Maha"
  },
  ar: {
    dir: "rtl",
    lang: "ar",
    ar_draft: true,
    brand: "Jubail Commons",
    tagline: "فعاليات المجتمع والحجوزات والمزيد — من الجيران، للجيران.",
    toggle_label: "EN",
    module_events: "الفعاليات",
    module_events_desc: "احتفالات المجتمع على الخريطة — سجّلوا منزلكم وأديروا مشاركتكم بأنفسكم.",
    module_bookings: "حجز الملاعب",
    module_bookings_desc: "احجزوا ملاعب ومرافق المجتمع.",
    module_pets: "حيوانات الجبيل",
    module_pets_desc: "دليل حيوانات الحي الأليفة.",
    coming_soon: "قريباً",
    archive_halloween: "هالوين ٢٠٢٦",
    archive_halloween_desc: "حيث بدأ كل شيء — خريطة الحلوى.",
    archive_open: "افتحوا الخريطة",
    privacy_line: "الخصوصية أولاً: لا نحفظ أسماء أو أرقام هواتف أو بريداً إلكترونياً إلا بموافقتكم ولكل ميزة على حدة.",
    error_config: "تعذّر تحميل إعدادات المجتمع — نعرض الإعدادات الافتراضية. حاولوا مرة أخرى بعد قليل.",
    footer_credit: "من جاركم في عين المها"
  }
};

function jcLang(){
  try { return localStorage.getItem("jc_lang") || "en"; } catch(e){ return "en"; }
}
function jcT(key){
  var pack = JC_STRINGS[jcLang()] || JC_STRINGS.en;
  return pack[key] != null ? pack[key] : (JC_STRINGS.en[key] != null ? JC_STRINGS.en[key] : key);
}
function jcSetLang(lang){
  try { localStorage.setItem("jc_lang", lang); } catch(e){}
  var pack = JC_STRINGS[lang] || JC_STRINGS.en;
  document.documentElement.setAttribute("dir", pack.dir);
  document.documentElement.setAttribute("lang", pack.lang);
}
