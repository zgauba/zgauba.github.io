-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- RM-a — Renamable modules (plan docs/plans/RM-renamable-modules.md; Zee approved Q1–Q5 2026-11-10).
--
-- Every module keeps its fixed key (events, bookings, pets, community; `directory` joins in its own migration).
-- A community admin may give it a NAME (short: bar, tabs, Settings — EN + AR together, or neither) and a TITLE
-- (brand: page heading, hub card — each language optional; the client falls back to the name). Nothing set =
-- the built-in labels, so nothing changes on screen until someone renames.
--
-- 1. Storage: its OWN column jc_communities.module_labels — never inside `modules`, which is switched
--    out-of-band (flag UPDATEs on `modules` must never wipe names; plan premortem 2b).
--    Shape: { "<key>": { "name": {"en","ar"}, "title": {"en"?, "ar"?} } }.
-- 2. jc_config_get (anon) returns it as 'labels' — public by design, like `brand`; short capped text only.
--    Body change only; signature unchanged; the key is additive (all 6 client callers read named keys).
-- 3. jc_admin_module_label_set — community admins only. Text cleaned (jc_clean_line); name EN ≤ 14 / AR ≤ 18 (the built-in AR Pets label is 17), title ≤ 40;
--    all four blank = reset that module to the built-in labels. Character allow-lists (BAD_CHARS); a built-in
--    module name or fixed app label is RESERVED_NAME; another module's custom name is NAME_TAKEN (case- and
--    space-insensitive). Row-locked read-modify-write; each call replaces the module's whole entry.
--    Logged 'module_label_set' {module, reset, ref = 8-char md5} — never the text itself.
-- 4. Seed: Jubail's Pets title "Pets of Jubail" moves from the platform strings into Jubail's own row
--    (the client's built-in pets title becomes the generic "Pets" in RM-b). AR is the reviewed 2026-11-03 string.
--
-- +1 authenticated fn: jc_admin_module_label_set. Replaced (signature unchanged): jc_config_get (last defined in
-- 20261103120000_s1_identity_homes.sql; this body = the live body pulled with pg_get_functiondef 2026-11-10).
--
-- Rollback (pre-launch), in this order: (1) drop function jc_admin_module_label_set(text, text, text, text, text);
-- (2) re-create jc_config_get from this file's body without the 'labels' key; (3) alter table jc_communities
-- drop column module_labels; (4) delete from supabase_migrations.schema_migrations where version = '20261110120000'.
-- The RM-b client tolerates a missing 'labels' key (falls back to the built-in strings).

-- ---------- 1. column ----------
alter table public.jc_communities
  add column module_labels jsonb not null default '{}'::jsonb
  constraint jc_communities_module_labels_check
    check (jsonb_typeof(module_labels) = 'object' and octet_length(module_labels::text) <= 4096);  -- security L3

-- ---------- 2. jc_config_get: + 'labels' (live body otherwise unchanged) ----------
create or replace function public.jc_config_get(p_community text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar,
    'map', jsonb_build_object('lat', c.map_lat, 'lng', c.map_lng, 'zoom', c.map_zoom),
    'tz', c.tz,
    'villages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', v.key, 'en', v.name_en, 'ar', v.name_ar, 'status', v.status,
               'delivery', v.delivery_label, 'parent', v.parent_key, 'glyph', v.glyph,
               'etymology_en', v.etymology_en, 'etymology_ar', v.etymology_ar)
             order by v.sort, v.key)
        from jc_villages v where v.community_id = c.id), '[]'::jsonb),
    'links', c.links, 'brand', c.brand, 'modules', c.modules, 'broadcast', c.broadcast,
    'labels', c.module_labels)                                                                   -- RM
  from jc_communities c where c.id = p_community;
$$;

-- ---------- 3. jc_admin_module_label_set ----------
-- Contract: each call REPLACES the module's whole entry (name and title) — the editor always sends all four
-- fields; a null name with a title keeps the title only (database review L3, pinned by s22 L11).
-- Character allow-lists (security M1): jc_clean_line already strips bidi controls and zero-widths, but not
-- every invisible (U+2060–2064, U+3164, NBSP, variation selectors, tags…). Names: letters, digits, space and
-- & ' / . - (Latin incl. accented; Arabic letters without tashkeel / tatweel); titles add , : ! ? ( ) and,
-- for the AR title, Latin too (brand names) plus ، ؟. Anything else → BAD_CHARS.
-- Reserved names (security M2): a name may not be another module's BUILT-IN name or a fixed app label
-- (Commons, My Home, Organizer Tools, Sign In…), EN or AR, compared lower-cased without spaces → RESERVED_NAME.
-- Another module's custom name → NAME_TAKEN.
create function public.jc_admin_module_label_set(p_module text, p_name_en text, p_name_ar text,
                                                 p_title_en text, p_title_ar text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  c_lat  constant text := 'A-Za-z0-9À-ÖØ-öø-ɏ';
  c_ara  constant text := 'ء-غف-ي0-9٠-٩';
  c_builtin constant jsonb := '{"events": ["Events", "الفعاليات"], "bookings": ["Courts", "الملاعب"],
    "pets": ["Pets", "الحيوانات الأليفة"], "community": ["The Community", "Community", "المجتمع"]}';
  c_fixed constant text[] := array['Commons', 'Home', 'My Home', 'Admin', 'Organizer', 'Organizer Tools', 'Sign In',
    'Account', 'Settings', 'Help', 'Back', 'كومنز', 'الرئيسية', 'منزلي', 'الإدارة', 'التنظيم', 'أدوات المنظمين',
    'تسجيل الدخول', 'حسابي', 'الإعدادات', 'مساعدة', 'رجوع'];
  v_comm text;
  v_ne text := regexp_replace(jc_clean_line(p_name_en), ' {2,}', ' ', 'g');
  v_na text := regexp_replace(jc_clean_line(p_name_ar), ' {2,}', ' ', 'g');
  v_te text := regexp_replace(jc_clean_line(p_title_en), ' {2,}', ' ', 'g');
  v_ta text := regexp_replace(jc_clean_line(p_title_ar), ' {2,}', ' ', 'g');
  v_reserved text[];
  v_labels jsonb; v_entry jsonb;
begin
  v_comm := jc_assert_admin('community');
  if p_module is null or p_module not in ('events', 'bookings', 'pets', 'community') then
    raise exception 'BAD_MODULE';
  end if;
  if (v_ne is null) <> (v_na is null) then raise exception 'NAME_BOTH'; end if;
  if coalesce(char_length(v_ne), 0) > 14 or coalesce(char_length(v_na), 0) > 18
     or coalesce(char_length(v_te), 0) > 40 or coalesce(char_length(v_ta), 0) > 40 then
    raise exception 'TOO_LONG';
  end if;
  if v_ne !~ ('^[' || c_lat || '][' || c_lat || ' &''/.-]*$')
     or v_na !~ ('^[' || c_ara || '][' || c_ara || ' &''/.-]*$')
     or v_te !~ ('^[' || c_lat || '][' || c_lat || ' &''/.,:!?()-]*$')
     or v_ta !~ ('^[' || c_ara || c_lat || '][' || c_ara || c_lat || ' &''/.,:!?()،؟-]*$') then
    raise exception 'BAD_CHARS';
  end if;

  if v_ne is not null then
    select array_agg(lower(replace(x, ' ', ''))) into v_reserved
      from (select unnest(c_fixed) as x
            union all
            select jsonb_array_elements_text(b.value) from jsonb_each(c_builtin) b where b.key <> p_module) r;
    if lower(replace(v_ne, ' ', '')) = any(v_reserved) or lower(replace(v_na, ' ', '')) = any(v_reserved) then
      raise exception 'RESERVED_NAME';
    end if;
  end if;

  -- the lock must stay BEFORE the NAME_TAKEN read (two admins naming two modules alike serialize here)
  select module_labels into v_labels from jc_communities where id = v_comm for update;

  if v_ne is not null and exists (
       select 1 from jsonb_each(v_labels) e
        where e.key <> p_module
          and (lower(replace(e.value #>> '{name,en}', ' ', '')) = lower(replace(v_ne, ' ', ''))
               or replace(e.value #>> '{name,ar}', ' ', '') = replace(v_na, ' ', ''))) then
    raise exception 'NAME_TAKEN';
  end if;

  v_entry := jsonb_strip_nulls(jsonb_build_object(
    'name',  case when v_ne is not null then jsonb_build_object('en', v_ne, 'ar', v_na) end,
    'title', case when v_te is not null or v_ta is not null
                  then jsonb_strip_nulls(jsonb_build_object('en', v_te, 'ar', v_ta)) end));

  if v_entry = '{}'::jsonb then v_labels := v_labels - p_module;          -- reset to the built-in labels
  else v_labels := jsonb_set(v_labels, array[p_module], v_entry); end if;

  update jc_communities set module_labels = v_labels where id = v_comm;
  -- never the text; a short fingerprint makes a change traceable (security L2, as pets_group_set)
  perform jc_admin_log_add(v_comm, 'module_label_set',
    jsonb_strip_nulls(jsonb_build_object('module', p_module, 'reset', v_entry = '{}'::jsonb,
                       'ref', case when v_entry <> '{}'::jsonb then left(md5(v_entry::text), 8) end)));
  return v_labels;
end;
$$;

-- ---------- 4. seed: Jubail's Pets title (was platform copy) ----------
update public.jc_communities
   set module_labels = jsonb_set(module_labels, '{pets}',
         '{"title": {"en": "Pets of Jubail", "ar": "حيوانات الجبيل الأليفة"}}'::jsonb)
 where id = 'jubail';

-- ---------- 5. grants ----------
revoke execute on function public.jc_admin_module_label_set(text, text, text, text, text) from public, anon;
grant execute on function public.jc_admin_module_label_set(text, text, text, text, text) to authenticated;
