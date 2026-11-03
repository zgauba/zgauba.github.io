-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- Arabic names from the native-speaker review (approved 2026-11-03). Data only.
-- Village spellings are the official ones from jubailisland.ae (note ند, not نادي).
-- "Commons" is transliterated, not translated (cross-community product name).
-- Rollback: set name_ar = null on the same rows (the landing falls back to English).

update public.jc_communities set name_ar = 'كومنز الجبيل' where id = 'jubail';

update public.jc_villages v set name_ar = x.ar
  from (values
    ('ain-al-maha',      'عين المها'),
    ('bada-al-jubail',   'بدع الجبيل'),
    ('marfaa-al-jubail', 'مرفأ الجبيل'),
    ('marsa-al-jubail',  'مرسى الجبيل'),
    ('nad-al-dhabi',     'ند الظبي'),
    ('rimas',            'ريماس'),
    ('seef-al-jubail',   'سيف الجبيل'),
    ('souk-al-jubail',   'سوق الجبيل')
  ) as x(key, ar)
 where v.community_id = 'jubail' and v.key = x.key;
