-- TARGET PROJECT: JubailCommons (qrpxfssdeeuzmsmlbtbu) — NEVER SignalPost.
-- R5c-2 — remove a pet's photo (Zee 2026-11-12: "yes" to adding Remove; security review R5c M2: a photo uploaded by
-- mistake — a person in it — could only be replaced, never taken down).
--
-- jc_pet_photo_remove(p_pet): who may manage the pet (jc_pet_manage: the household for an owned pet, a Pets admin for a
-- stray) clears photo_path and retires the current ledger row. The SELECT policy (pet_photo_can_read) only lets members
-- read the CURRENT path, so no new view can read it once this commits (signed URLs already issued live ≤ 1 h, and a
-- phone may have it cached); jc-photo-purge deletes the retired object within a day (03:35 UTC run).
-- A takedown wins (security review L2): an in-flight upload by anyone in the household is cancelled too — pending
-- columns cleared, its ledger row retired (as jc_pet_retire does) — so a stale upload can't put a photo straight back;
-- that uploader's commit then gets NO_PENDING_PHOTO. NO_PHOTO when there is no current photo (nothing changes).
--
-- DOWN: drop function public.jc_pet_photo_remove(uuid);  (photos removed meanwhile stay removed — the files are purged)

create function public.jc_pet_photo_remove(p_pet uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_comm text; v_home uuid; p public.jc_pets%rowtype;
begin
  select o_user, o_community, o_home into v_user, v_comm, v_home from jc_me();
  perform jc_module_on(v_comm, 'pets');
  p := jc_pet_manage(p_pet);
  if p.photo_path is null then raise exception 'NO_PHOTO'; end if;
  update jc_pet_photos set state = 'retired', retired_at = now() where pet_id = p.id and state in ('current', 'pending');
  update jc_pets set photo_path = null, pending_photo_path = null, pending_photo_by = null, pending_photo_at = null,
                     updated_at = now(), updated_by = v_user
   where id = p.id;
  return jc_pet_card(p.id, v_home);
end;
$$;

revoke execute on function public.jc_pet_photo_remove(uuid) from public, anon;
grant execute on function public.jc_pet_photo_remove(uuid) to authenticated;
