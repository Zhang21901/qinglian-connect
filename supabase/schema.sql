create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', school text not null default '', role_title text not null default '',
  focus text not null default '', bio text not null default '', experiences text not null default '',
  skills text[] not null default '{}', collaboration_roles text[] not null default '{}',
  collaboration_note text not null default '', weekly_hours text not null default '', availability text[] not null default '{}',
  contact text not null default '', contact_visibility text not null default 'hidden' check (contact_visibility in ('public','hidden')),
  is_admin boolean not null default false, is_onboarded boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  max_uses integer not null default 20 check (max_uses > 0), used_count integer not null default 0 check (used_count >= 0),
  active boolean not null default true, expires_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.collaboration_intents (
  id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100), description text not null check (char_length(description) between 10 and 1000),
  needed_roles text[] not null default '{}', status text not null default 'open' check (status in ('open','closed')), created_at timestamptz not null default now()
);

create table if not exists public.ai_match_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null default (now() at time zone 'Asia/Shanghai')::date,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_date)
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'name', '')); return new; end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.ensure_profile() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Authentication required';
  end if;
  insert into public.profiles (id, display_name)
  values (auth.uid(), coalesce(auth.jwt()->'user_metadata'->>'name', ''))
  on conflict (id) do nothing;
  return (select to_jsonb(p) from public.profiles p where p.id = auth.uid());
end;
$$;
grant execute on function public.ensure_profile() to authenticated;

create or replace function public.is_onboarded() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_onboarded)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_admin and is_onboarded)
$$;

alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.collaboration_intents enable row level security;
alter table public.ai_match_usage enable row level security;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.collaboration_intents to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
create policy "profiles: read own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles: update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "intents: members read" on public.collaboration_intents for select to authenticated using (public.is_onboarded());
create policy "intents: members create" on public.collaboration_intents for insert to authenticated with check (author_id = auth.uid() and public.is_onboarded());
create policy "intents: authors update" on public.collaboration_intents for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "intents: authors delete" on public.collaboration_intents for delete to authenticated using (author_id = auth.uid());
create policy "invitations: admins manage" on public.invitations for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.complete_profile(p_invite_code text, p_data jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_first boolean; v_invite public.invitations%rowtype;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select not exists(select 1 from public.profiles where is_onboarded) into v_first;
  if not v_first then
    select * into v_invite from public.invitations where upper(code) = upper(trim(coalesce(p_invite_code,''))) and active and used_count < max_uses and (expires_at is null or expires_at > now()) for update;
    if not found then raise exception '邀请码无效或已失效'; end if;
    update public.invitations set used_count = used_count + 1 where id = v_invite.id;
  end if;
  update public.profiles set
    display_name = left(coalesce(p_data->>'display_name',''),50), school = left(coalesce(p_data->>'school',''),100), role_title = left(coalesce(p_data->>'role_title',''),100),
    focus = left(coalesce(p_data->>'focus',''),160), bio = left(coalesce(p_data->>'bio',''),1200), experiences = left(coalesce(p_data->>'experiences',''),2000),
    skills = array(select left(value,40) from jsonb_array_elements_text(coalesce(p_data->'skills','[]'::jsonb)) value limit 12),
    collaboration_roles = array(select left(value,40) from jsonb_array_elements_text(coalesce(p_data->'collaboration_roles','[]'::jsonb)) value limit 8),
    collaboration_note = left(coalesce(p_data->>'collaboration_note',''),1200), weekly_hours = left(coalesce(p_data->>'weekly_hours',''),40),
    availability = array(select left(value,40) from jsonb_array_elements_text(coalesce(p_data->'availability','[]'::jsonb)) value limit 8),
    contact = left(coalesce(p_data->>'contact',''),120), contact_visibility = case when p_data->>'contact_visibility' = 'public' then 'public' else 'hidden' end,
    is_onboarded = true, is_admin = case when v_first then true else is_admin end, updated_at = now()
  where id = auth.uid();
  return (select to_jsonb(p) - 'contact' from public.profiles p where p.id = auth.uid());
end;
$$;

create or replace function public.search_members(p_query text default '', p_tag text default '')
returns table (id uuid, display_name text, school text, role_title text, focus text, bio text, skills text[], collaboration_roles text[], weekly_hours text, availability text[], contact text, contact_visible boolean)
language sql stable security definer set search_path = public as $$
  select p.id,p.display_name,p.school,p.role_title,p.focus,p.bio,p.skills,p.collaboration_roles,p.weekly_hours,p.availability,
    case when p.contact_visibility = 'public' then p.contact else '' end, p.contact_visibility = 'public'
  from public.profiles p
  where public.is_onboarded() and p.is_onboarded and p.id <> auth.uid()
    and (coalesce(trim(p_query),'') = '' or concat_ws(' ',p.display_name,p.school,p.role_title,p.focus,p.bio,p.experiences,array_to_string(p.skills,' '),array_to_string(p.collaboration_roles,' '),p.collaboration_note,p.weekly_hours,array_to_string(p.availability,' ')) ilike '%' || trim(p_query) || '%')
    and (coalesce(trim(p_tag),'') = '' or p_tag = any(p.skills) or p_tag = any(p.collaboration_roles) or p_tag = any(p.availability))
  order by p.updated_at desc;
$$;

create or replace function public.ai_match_candidates()
returns table (id uuid, display_name text, school text, role_title text, focus text, bio text, experiences text, skills text[], collaboration_roles text[], weekly_hours text, availability text[])
language sql stable security definer set search_path = public as $$
  select p.id,p.display_name,p.school,p.role_title,p.focus,p.bio,p.experiences,p.skills,p.collaboration_roles,p.weekly_hours,p.availability
  from public.profiles p
  where public.is_onboarded() and p.is_onboarded and p.id <> auth.uid()
  order by p.updated_at desc
  limit 200
$$;

create or replace function public.ai_match_intent_candidates()
returns table (id uuid, title text, description text, needed_roles text[], created_at timestamptz, author_name text, author_school text, author_role_title text)
language sql stable security definer set search_path = public as $$
  select i.id,i.title,i.description,i.needed_roles,i.created_at,p.display_name,p.school,p.role_title
  from public.collaboration_intents i
  join public.profiles p on p.id = i.author_id
  where public.is_onboarded() and i.status = 'open' and p.is_onboarded
  order by i.created_at desc
  limit 100
$$;

create or replace function public.consume_ai_match_quota(p_user_id uuid, p_daily_limit integer default 15)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and is_onboarded) then
    raise exception '请先完成资料';
  end if;
  insert into public.ai_match_usage (user_id, usage_date, request_count)
  values (p_user_id, (now() at time zone 'Asia/Shanghai')::date, 1)
  on conflict (user_id, usage_date) do update
    set request_count = public.ai_match_usage.request_count + 1
    where public.ai_match_usage.request_count < greatest(1, least(p_daily_limit, 100))
  returning request_count into v_count;
  if v_count is null then
    raise exception '今日 AI 匹配次数已用完';
  end if;
  return greatest(0, least(p_daily_limit, 100) - v_count);
end;
$$;
revoke all on function public.consume_ai_match_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_match_quota(uuid, integer) to service_role;

create or replace function public.refund_ai_match_quota(p_user_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.ai_match_usage
  set request_count = greatest(0, request_count - 1)
  where user_id = p_user_id
    and usage_date = (now() at time zone 'Asia/Shanghai')::date
    and request_count > 0
$$;
revoke all on function public.refund_ai_match_quota(uuid) from public, anon, authenticated;
grant execute on function public.refund_ai_match_quota(uuid) to service_role;

create or replace function public.list_collaboration_intents()
returns table (id uuid, author_id uuid, title text, description text, needed_roles text[], status text, created_at timestamptz, author_name text, author_school text, author_role_title text)
language sql stable security definer set search_path = public as $$
  select i.id,i.author_id,i.title,i.description,i.needed_roles,i.status,i.created_at,
    p.display_name,p.school,p.role_title
  from public.collaboration_intents i
  join public.profiles p on p.id = i.author_id
  where public.is_onboarded() and p.is_onboarded
  order by i.created_at desc
$$;

create or replace function public.create_invitation(p_max_uses integer default 20, p_expires_at timestamptz default null) returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception '仅管理员可创建邀请码'; end if;
  loop
    v_code := 'JOIN-' || upper(substring(md5(random()::text || clock_timestamp()::text || auth.uid()::text) from 1 for 8));
    exit when not exists (select 1 from public.invitations where code = v_code);
  end loop;
  insert into public.invitations(code,max_uses,expires_at,created_by) values (v_code,greatest(1,least(p_max_uses,200)),p_expires_at,auth.uid());
  return v_code;
end;
$$;

create or replace function public.admin_stats() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('members',(select count(*) from public.profiles where is_onboarded),'profile_completion',(select coalesce(round(avg(case when bio <> '' and array_length(skills,1) > 0 then 100 else 45 end)),0) from public.profiles where is_onboarded),'open_intents',(select count(*) from public.collaboration_intents where status='open'),'invites',(select count(*) from public.invitations where active)) where public.is_admin()
$$;

drop policy if exists "profiles: update own" on public.profiles;
create or replace function public.update_profile(p_data jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_onboarded() then raise exception '请先完成资料'; end if;
  update public.profiles set
    display_name = left(coalesce(p_data->>'display_name',''),50), school = left(coalesce(p_data->>'school',''),100), role_title = left(coalesce(p_data->>'role_title',''),100),
    focus = left(coalesce(p_data->>'focus',''),160), bio = left(coalesce(p_data->>'bio',''),1200), experiences = left(coalesce(p_data->>'experiences',''),2000),
    skills = array(select left(value,40) from jsonb_array_elements_text(coalesce(p_data->'skills','[]'::jsonb)) value limit 12),
    collaboration_roles = array(select left(value,40) from jsonb_array_elements_text(coalesce(p_data->'collaboration_roles','[]'::jsonb)) value limit 8),
    collaboration_note = left(coalesce(p_data->>'collaboration_note',''),1200), weekly_hours = left(coalesce(p_data->>'weekly_hours',''),40),
    availability = array(select left(value,40) from jsonb_array_elements_text(coalesce(p_data->'availability','[]'::jsonb)) value limit 8),
    contact = left(coalesce(p_data->>'contact',''),120), contact_visibility = case when p_data->>'contact_visibility' = 'public' then 'public' else 'hidden' end,
    updated_at = now()
  where id = auth.uid();
end;
$$;
