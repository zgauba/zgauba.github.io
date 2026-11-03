/* Jubail Commons — strings dictionary (EN/AR).
   Every user-visible string lives here; markup never hardcodes copy.
   Arabic: native-speaker review approved 2026-11-03 (sheet "Jubail Commons —
   Arabic review"). Style: singular address (احجز، سجّل), Western digits —
   both match jubailisland.ae. Any new or changed AR string needs review again;
   privacy_line is NOT reviewed (rewritten with the privacy policy — T6, KG7).
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
    module_bookings: "Courts",
    module_bookings_desc: "Book community courts and facilities.",
    module_pets: "Pets of Jubail",
    module_pets_desc: "The neighborhood pet directory.",
    /* nouns in the nav, verbs on the buttons (ratified 2026-11-02) */
    cta_events: "Sign your home up",
    cta_bookings: "Book a court",
    cta_pets: "Add a pet",
    coming_soon: "Coming soon",
    archive_halloween: "Halloween 2026",
    archive_halloween_desc: "Where it all started — the trick-or-treat map.",
    archive_open: "Open the map",
    privacy_line: "Zero-PII by default: no names, emails or phone numbers unless a feature asks, per-feature and opt-in.",
    error_config: "Couldn't load community settings — showing defaults. Try again shortly.",
    footer_credit: "Made by your neighbor in Ain Al Maha",
    /* nav (T5) */
    nav_home: "Commons",
    nav_my_home: "My Home",
    nav_community: "The Community",
    nav_admin: "Admin"
  },
  ar: {
    dir: "rtl",
    lang: "ar",
    /* "Commons" is the cross-community product name: transliterated, not
       translated; word order follows the village names (مرفأ الجبيل). */
    brand: "كومنز الجبيل",
    tagline: "فعاليات المجتمع والحجوزات والمزيد — من الجيران، للجيران.",
    toggle_label: "EN",
    module_events: "الفعاليات",
    module_events_desc: "احتفالات المجتمع على الخريطة — سجّل منزلك وأدِر مشاركتك بنفسك.",
    module_bookings: "الملاعب",
    module_bookings_desc: "احجز ملاعب ومرافق المجتمع.",
    module_pets: "حيوانات الجبيل الأليفة",
    module_pets_desc: "دليل حيوانات الحي الأليفة.",
    cta_events: "سجّل منزلك",
    cta_bookings: "احجز ملعباً",
    cta_pets: "أضف حيوانك الأليف",
    coming_soon: "قريباً",
    archive_halloween: "هالوين 2026",
    archive_halloween_desc: "من هنا كانت البداية — خريطة الحلوى.",
    archive_open: "افتح الخريطة",
    privacy_line: "الخصوصية أولاً: لا نحفظ أسماء أو أرقام هواتف أو بريداً إلكترونياً إلا بموافقتكم ولكل ميزة على حدة.",
    error_config: "تعذّر تحميل إعدادات المجتمع — نعرض الإعدادات الافتراضية. حاول مرة أخرى بعد قليل.",
    footer_credit: "من جارك في عين المها",
    nav_home: "الرئيسية",
    nav_my_home: "منزلي",
    nav_community: "المجتمع",
    nav_admin: "الإدارة"
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
