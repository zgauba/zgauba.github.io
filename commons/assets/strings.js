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
    nav_admin: "Admin",
    /* platform entry, signed out (T5.0a, wireframe band 01) */
    platform_brand: "Commons",
    platform_lede: "Neighborhood software, run by neighbors.",
    choose_community: "Choose your community",
    community_signin: "Sign in",
    community_join: "Join",
    your_community: "Your community isn't here? Commons is run by neighbors.",
    your_community_link: "Talk to us",
    /* account + join (T5.0a) */
    nav_sign_in: "Sign in",
    nav_account: "Account",
    nav_finish_join: "Finish joining",
    acct_email: "Email",
    acct_password: "Password",
    acct_password_new: "Password (8+ characters)",
    acct_signin_title: "Sign in",
    acct_signin_btn: "Sign in",
    acct_forgot: "Forgot your password?",
    acct_join_prompt: "New here? Join with the community code",
    acct_have_account: "Already joined? Sign in",
    acct_signed_in_as: "Signed in as",
    acct_continue: "Continue to Commons",
    acct_sign_out: "Sign out",
    acct_no_home: "Next step: claim your home. That screen arrives with the next update.",
    acct_back: "Back",
    join_title: "Join your community",
    join_code_label: "Community code",
    join_code_help: "Residents get the code in the community WhatsApp group.",
    join_continue: "Continue",
    join_community: "Community:",
    join_account_title: "Create your account",
    join_create_btn: "Create account",
    join_privacy: "What we keep: your email (for sign-in and password reset) and what you choose to share. First-party only — no ads, no trackers, no third parties. You can delete your account at any time.",
    forgot_title: "Reset your password",
    forgot_btn: "Send reset link",
    forgot_sent: "If that email has an account, a reset link is on its way. Check your inbox and spam folder, and open the link in this browser.",
    recover_title: "Choose a new password",
    recover_btn: "Save password",
    recover_done: "Password updated.",
    working: "One moment…",
    err_BAD_CODE: "That code didn't work. Check it in the WhatsApp group and try again.",
    err_CODE_MISSING: "Enter the community code first.",
    err_RATE_LIMITED: "Too many attempts. Try again later.",
    err_ALREADY_MEMBER_ELSEWHERE: "This account already belongs to another community.",
    err_EMAIL_TAKEN: "That email already has an account. Sign in instead.",
    err_BAD_LOGIN: "Email or password is incorrect.",
    err_WEAK_PASSWORD: "Choose a longer password (at least 8 characters).",
    err_BAD_EMAIL: "Enter a valid email address.",
    err_AUTH_LIMIT: "Too many tries from this network. Wait a few minutes and try again.",
    err_CONFIRM_REQUIRED: "Check your email to confirm your account, then sign in.",
    err_LINK_EXPIRED: "That reset link has expired, was already used, or was opened in a different browser. Request a new one here and open it in this browser.",
    err_SAME_PASSWORD: "That's your current password. Choose a different one.",
    err_NETWORK: "Couldn't reach Commons. Check your connection and try again.",
    err_UNKNOWN: "Something went wrong. Try again in a moment."
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
    nav_admin: "الإدارة",
    /* platform entry + account + join (T5.0a) — DRAFT, not yet native-reviewed:
       batch into the review sheet before T6 */
    platform_brand: "كومنز",
    platform_lede: "برمجيات الحي، يديرها الجيران.",
    choose_community: "اختر مجتمعك",
    community_signin: "تسجيل الدخول",
    community_join: "انضم",
    your_community: "مجتمعك غير موجود هنا؟ كومنز يديره الجيران.",
    your_community_link: "تواصل معنا",
    nav_sign_in: "تسجيل الدخول",
    nav_account: "حسابي",
    nav_finish_join: "أكمل الانضمام",
    acct_email: "البريد الإلكتروني",
    acct_password: "كلمة المرور",
    acct_password_new: "كلمة المرور (8 أحرف على الأقل)",
    acct_signin_title: "تسجيل الدخول",
    acct_signin_btn: "سجّل الدخول",
    acct_forgot: "نسيت كلمة المرور؟",
    acct_join_prompt: "جديد هنا؟ انضم برمز المجتمع",
    acct_have_account: "انضممت من قبل؟ سجّل الدخول",
    acct_signed_in_as: "مسجّل الدخول باسم",
    acct_continue: "تابع إلى كومنز",
    acct_sign_out: "سجّل الخروج",
    acct_no_home: "الخطوة التالية: سجّل منزلك. تصل هذه الشاشة مع التحديث القادم.",
    acct_back: "رجوع",
    join_title: "انضم إلى مجتمعك",
    join_code_label: "رمز المجتمع",
    join_code_help: "يحصل السكان على الرمز في مجموعة واتساب الخاصة بالمجتمع.",
    join_continue: "متابعة",
    join_community: "المجتمع:",
    join_account_title: "أنشئ حسابك",
    join_create_btn: "أنشئ الحساب",
    join_privacy: "ما نحتفظ به: بريدك الإلكتروني (لتسجيل الدخول واستعادة كلمة المرور) وما تختار مشاركته فقط. بياناتك لدينا وحدنا — لا إعلانات ولا أدوات تتبّع ولا أطراف ثالثة. يمكنك حذف حسابك في أي وقت.",
    forgot_title: "استعادة كلمة المرور",
    forgot_btn: "أرسل رابط الاستعادة",
    forgot_sent: "إذا كان لهذا البريد حساب، فرابط الاستعادة في طريقه إليك. تحقّق من صندوق الوارد ومجلد الرسائل غير المرغوب فيها، وافتح الرابط في هذا المتصفح.",
    recover_title: "اختر كلمة مرور جديدة",
    recover_btn: "احفظ كلمة المرور",
    recover_done: "تم تحديث كلمة المرور.",
    working: "لحظة من فضلك…",
    err_BAD_CODE: "الرمز غير صحيح. تحقّق منه في مجموعة واتساب وحاول مرة أخرى.",
    err_CODE_MISSING: "أدخل رمز المجتمع أولاً.",
    err_RATE_LIMITED: "محاولات كثيرة. حاول مرة أخرى لاحقاً.",
    err_ALREADY_MEMBER_ELSEWHERE: "هذا الحساب مسجّل في مجتمع آخر.",
    err_EMAIL_TAKEN: "لهذا البريد حساب بالفعل. سجّل الدخول بدلاً من ذلك.",
    err_BAD_LOGIN: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    err_WEAK_PASSWORD: "اختر كلمة مرور أطول (8 أحرف على الأقل).",
    err_BAD_EMAIL: "أدخل بريداً إلكترونياً صحيحاً.",
    err_AUTH_LIMIT: "محاولات كثيرة من هذه الشبكة. انتظر بضع دقائق ثم حاول مرة أخرى.",
    err_CONFIRM_REQUIRED: "تحقّق من بريدك لتأكيد حسابك، ثم سجّل الدخول.",
    err_LINK_EXPIRED: "انتهت صلاحية رابط الاستعادة، أو استُخدم من قبل، أو فُتح في متصفح آخر. اطلب رابطاً جديداً من هنا وافتحه في هذا المتصفح.",
    err_SAME_PASSWORD: "هذه كلمة مرورك الحالية. اختر كلمة مرور مختلفة.",
    err_NETWORK: "تعذّر الوصول إلى كومنز. تحقّق من اتصالك وحاول مرة أخرى.",
    err_UNKNOWN: "حدث خطأ ما. حاول مرة أخرى بعد قليل."
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
