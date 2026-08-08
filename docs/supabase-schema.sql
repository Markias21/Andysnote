-- ═══════════════════════════════════════════════════════════════════════════
--  AndysLetter — Supabase 스키마
-- ═══════════════════════════════════════════════════════════════════════════
--
--  이 파일은 AndysLetter가 쓰는 Postgres 구조 전부다. Supabase 대시보드의
--  SQL Editor에 통째로 붙여넣고 한 번 실행하면 된다. 여러 번 실행해도 안전하도록
--  전부 if not exists / or replace 로 작성했다.
--
--  ⚠️ 비밀번호는 이 파일에 절대 넣지 않는다.
--     관리자 계정은 Supabase 대시보드(Authentication → Users → Add user)에서
--     직접 만들고, 비밀번호도 거기서만 입력한다. 이 파일에는 "그 계정을 관리자로
--     지정한다"는 UPDATE 한 줄만 있다 (맨 아래 §6 참고).
--
--  설계의 두 가지 핵심:
--
--  1) 남의 프로필은 아무도 직접 조회할 수 없다.
--     우편번호로 이름을 돌려주는 API를 열면 00000~99999를 전부 훑어서 가입자
--     명단을 통째로 수집할 수 있다. 그래서 발송 전 검증은 "그 우편번호가 존재하는가"
--     라는 boolean 하나만 돌려준다 (letter_postcode_exists).
--
--  2) letters / letter_users 에는 INSERT·UPDATE 정책이 아예 없다.
--     쓰기는 전부 security definer 함수(RPC)를 거친다. 그래야 "승인된 사용자인가",
--     "우편번호가 실존하는가", "발송 한도를 넘지 않았는가", "is_admin을 스스로
--     켜려는 건 아닌가" 를 서버에서 강제할 수 있다. 클라이언트가 뭘 보내든
--     이 규칙은 우회되지 않는다.
--
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- §1. 테이블
-- ───────────────────────────────────────────────────────────────────────────

-- 프로필: 우편번호 + 표시 이름 + 가입 승인 상태.
-- status 는 관리자 승인제를 위한 것이다. 가입 직후엔 'pending' 이고, 관리자가
-- 승인해야 'approved' 가 되며, 그 전까지는 편지를 보내지도 받지도 못한다.
create table if not exists letter_users (
  id           uuid primary key references auth.users(id) on delete cascade,
  postcode     char(5) not null unique check (postcode ~ '^[0-9]{5}$'),
  display_name text    not null check (char_length(trim(display_name)) between 1 and 30),
  status       text    not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);

-- 편지. 한 행이 한 통이고, 보낸이와 받는이가 같은 행을 공유한다.
-- archived_by_* 는 "내보내기 = 진짜 이동"을 구현하는 장치다. 한쪽이 Drive로
-- 옮기면 그쪽 플래그만 켜져 그 사람 편지함에서만 사라지고, 양쪽 다 켜지면
-- letter_archive() 가 행을 실제로 지운다 (무료 용량이 그때 비워진다).
create table if not exists letters (
  id                    uuid primary key default gen_random_uuid(),
  sender_id             uuid not null references auth.users(id) on delete cascade,
  sender_postcode       char(5) not null,
  sender_name           text not null,   -- 겉면에 적히는 보낸이 (기본값=프로필 이름, 수정 가능)
  recipient_id          uuid not null references auth.users(id) on delete cascade,
  recipient_postcode    char(5) not null,
  recipient_name        text not null,
  subject               text not null default '',
  body                  text not null default '',   -- Markdown 원문 (원칙 4: 사용자 텍스트가 원본)
  paper_id              text not null default 'plain',
  envelope_color        text not null default 'cream',
  font_id               text not null default '',
  sent_at               timestamptz not null default now(),
  read_at               timestamptz,
  archived_by_sender    boolean not null default false,
  archived_by_recipient boolean not null default false
);

-- 주소록. 이건 순수하게 본인 것만 읽고 쓰므로 RPC 없이 RLS로 직접 CRUD 한다.
create table if not exists letter_contacts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 30),
  postcode   char(5) not null check (postcode ~ '^[0-9]{5}$'),
  memo       text not null default '',
  created_at timestamptz not null default now(),
  unique (owner_id, postcode)
);

create index if not exists letters_recipient_idx on letters (recipient_id, sent_at desc);
create index if not exists letters_sender_idx    on letters (sender_id, sent_at desc);
create index if not exists letter_contacts_owner_idx on letter_contacts (owner_id, name);


-- ───────────────────────────────────────────────────────────────────────────
-- §2. 헬퍼 함수
-- ───────────────────────────────────────────────────────────────────────────

-- 호출자가 관리자인가.
-- security definer 인 이유: letter_users 의 RLS 정책 안에서 이 함수를 부르는데,
-- 함수가 다시 letter_users 를 조회하기 때문이다. 일반 함수였다면 정책 → 조회 →
-- 정책 → ... 무한 재귀가 난다. security definer 는 테이블 소유자 권한으로 돌아
-- RLS를 건너뛰므로 재귀가 끊긴다.
create or replace function letter_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from letter_users where id = auth.uid()), false);
$$;

-- 호출자가 승인된 사용자인가. 편지 관련 RPC 대부분이 이걸 먼저 확인한다.
create or replace function letter_is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status = 'approved' from letter_users where id = auth.uid()),
    false
  );
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- §3. RLS 정책
-- ───────────────────────────────────────────────────────────────────────────

alter table letter_users    enable row level security;
alter table letters         enable row level security;
alter table letter_contacts enable row level security;

-- letter_users ─────────────────────────────────────────────────────────────
-- SELECT 만 열고 INSERT/UPDATE/DELETE 는 열지 않는다. 프로필 생성은
-- letter_claim_postcode(), 상태 변경은 letter_admin_set_status() 로만 가능하다.
-- 이 정책이 없으면 사용자가 자기 행에 is_admin=true / status='approved' 를
-- 직접 써넣어 승인제를 통째로 우회할 수 있다.
drop policy if exists "letter_users self or admin read" on letter_users;
create policy "letter_users self or admin read" on letter_users
  for select using (auth.uid() = id or letter_is_admin());

-- letters ──────────────────────────────────────────────────────────────────
-- 보낸이/받는이 본인만, 그리고 자기 쪽에서 아카이브하지 않은 것만 보인다.
-- 쓰기 정책은 일부러 하나도 만들지 않았다 (§2 머리말 참고).
drop policy if exists "letters read own" on letters;
create policy "letters read own" on letters
  for select using (
    (auth.uid() = recipient_id and not archived_by_recipient) or
    (auth.uid() = sender_id    and not archived_by_sender)
  );

-- letter_contacts ──────────────────────────────────────────────────────────
-- 본인 주소록은 전부 직접 CRUD. 남의 주소록에는 어떤 방법으로도 닿지 않는다.
drop policy if exists "letter_contacts own read"   on letter_contacts;
drop policy if exists "letter_contacts own insert" on letter_contacts;
drop policy if exists "letter_contacts own update" on letter_contacts;
drop policy if exists "letter_contacts own delete" on letter_contacts;

create policy "letter_contacts own read" on letter_contacts
  for select using (auth.uid() = owner_id);
create policy "letter_contacts own insert" on letter_contacts
  for insert with check (auth.uid() = owner_id and letter_is_approved());
create policy "letter_contacts own update" on letter_contacts
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "letter_contacts own delete" on letter_contacts
  for delete using (auth.uid() = owner_id);


-- ───────────────────────────────────────────────────────────────────────────
-- §4. 사용자 RPC
-- ───────────────────────────────────────────────────────────────────────────

-- 최초 1회 프로필 생성. 우편번호는 사용자가 직접 고른다.
-- 항상 status='pending', is_admin=false 로 만든다 — 클라이언트가 뭘 보내든
-- 이 두 값은 인자로 받지 않으므로 승인 없이 통과할 방법이 없다.
create or replace function letter_claim_postcode(p_postcode text, p_name text)
returns letter_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_row  letter_users;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_postcode !~ '^[0-9]{5}$' then
    raise exception 'BAD_POSTCODE';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception 'BAD_NAME';
  end if;

  -- 관리자 사칭 방지. 일반 가입자는 이 이름들을 쓸 수 없다.
  if lower(v_name) in ('admin', 'administrator', '관리자', 'andysnote', 'andysletter') then
    raise exception 'RESERVED_NAME';
  end if;

  if exists (select 1 from letter_users where id = auth.uid()) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  if exists (select 1 from letter_users where postcode = p_postcode) then
    raise exception 'POSTCODE_TAKEN';
  end if;

  insert into letter_users (id, postcode, display_name, status, is_admin)
  values (auth.uid(), p_postcode, v_name, 'pending', false)
  returning * into v_row;

  return v_row;
end;
$$;

-- 우편번호가 실존하는 승인된 사용자의 것인지만 확인한다.
-- 이름은 절대 돌려주지 않는다 (§ 머리말 1번).
create or replace function letter_postcode_exists(p_postcode text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from letter_users
    where postcode = p_postcode and status = 'approved'
  ) and letter_is_approved();
$$;

-- 편지 발송. letters 테이블에 INSERT 하는 유일한 경로다.
create or replace function letter_send(
  p_to_postcode    text,
  p_sender_name    text,
  p_recipient_name text,
  p_subject        text,
  p_body           text,
  p_paper          text,
  p_envelope       text,
  p_font           text
)
returns letters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        letter_users;
  v_recipient letter_users;
  v_recent    integer;
  v_row       letters;
begin
  select * into v_me from letter_users where id = auth.uid();
  if v_me is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_me.status <> 'approved' then
    raise exception 'NOT_APPROVED';
  end if;

  select * into v_recipient
  from letter_users
  where postcode = p_to_postcode and status = 'approved';
  if v_recipient is null then
    raise exception 'NO_SUCH_POSTCODE';
  end if;

  -- 도배 방지: 최근 1시간에 20통까지.
  select count(*) into v_recent
  from letters
  where sender_id = auth.uid() and sent_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  if char_length(p_body) > 20000 or char_length(p_subject) > 100 then
    raise exception 'TOO_LONG';
  end if;

  insert into letters (
    sender_id, sender_postcode, sender_name,
    recipient_id, recipient_postcode, recipient_name,
    subject, body, paper_id, envelope_color, font_id
  ) values (
    auth.uid(), v_me.postcode, coalesce(nullif(trim(p_sender_name), ''), v_me.display_name),
    v_recipient.id, v_recipient.postcode, coalesce(nullif(trim(p_recipient_name), ''), ''),
    coalesce(p_subject, ''), coalesce(p_body, ''),
    coalesce(nullif(p_paper, ''), 'plain'),
    coalesce(nullif(p_envelope, ''), 'cream'),
    coalesce(p_font, '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- 읽음 표시. 받는 사람만, 그리고 최초 1회만 기록한다
-- (두 번째로 열었을 때 시각이 덮어써지면 "언제 읽었는지"가 의미를 잃는다).
create or replace function letter_mark_read(p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_read_at timestamptz;
begin
  update letters
  set read_at = now()
  where id = p_id and recipient_id = auth.uid() and read_at is null;

  select read_at into v_read_at
  from letters
  where id = p_id and (recipient_id = auth.uid() or sender_id = auth.uid());

  return v_read_at;
end;
$$;

-- 내보내기 후 아카이브. 호출자 쪽 플래그만 켜고, 양쪽 다 켜졌으면 행을 지운다.
create or replace function letter_archive(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row letters;
begin
  select * into v_row from letters
  where id = p_id and (sender_id = auth.uid() or recipient_id = auth.uid());
  if v_row is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_row.sender_id = auth.uid() then
    v_row.archived_by_sender := true;
  end if;
  if v_row.recipient_id = auth.uid() then
    v_row.archived_by_recipient := true;
  end if;

  -- 양쪽 모두 내보냈으면 더 붙들고 있을 이유가 없다.
  if v_row.archived_by_sender and v_row.archived_by_recipient then
    delete from letters where id = p_id;
    return true;
  end if;

  update letters
  set archived_by_sender    = v_row.archived_by_sender,
      archived_by_recipient = v_row.archived_by_recipient
  where id = p_id;
  return false;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- §5. 관리자 RPC
-- ───────────────────────────────────────────────────────────────────────────

-- 가입자 전체 목록. 관리자만 호출할 수 있다.
-- 이메일은 auth.users 에 있어 일반 정책으로는 닿지 않지만, security definer 라
-- 읽을 수 있다. 승인 판단에 필요한 최소 정보만 내보낸다.
create or replace function letter_admin_list_users()
returns table (
  id           uuid,
  email        text,
  postcode     char(5),
  display_name text,
  status       text,
  is_admin     boolean,
  created_at   timestamptz,
  approved_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not letter_is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return query
    select u.id, au.email::text, u.postcode, u.display_name,
           u.status, u.is_admin, u.created_at, u.approved_at
    from letter_users u
    join auth.users au on au.id = u.id
    -- 승인 대기를 맨 위로, 그 다음 신청 순.
    order by (u.status = 'pending') desc, u.created_at desc;
end;
$$;

-- 가입 승인/거부. 관리자만.
create or replace function letter_admin_set_status(p_user_id uuid, p_status text)
returns letter_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row letter_users;
begin
  if not letter_is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'BAD_STATUS';
  end if;
  -- 관리자가 실수로 자기 자신을 잠그는 사고를 막는다.
  if p_user_id = auth.uid() then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;

  update letter_users
  set status = p_status,
      approved_at = case when p_status = 'approved' then now() else null end
  where id = p_user_id
  returning * into v_row;

  if v_row is null then
    raise exception 'NOT_FOUND';
  end if;
  return v_row;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- §6. 권한
-- ───────────────────────────────────────────────────────────────────────────
-- Postgres 는 새 함수의 EXECUTE 를 PUBLIC 에 기본 부여한다. 실제 발송/승인
-- 같은 동작을 하는 RPC는 로그인하지 않은 anon 으로도 호출할 수 있으면 안 되므로
-- 명시적으로 회수하고 authenticated 에게만 준다 (함수 안에서도 auth.uid() 로
-- 다시 확인하지만, 층을 하나 더 둔다).
--
-- letter_is_admin()/letter_is_approved() 는 예외다 — 이 둘은 RPC로 직접
-- 호출되는 게 아니라 §3의 RLS 정책(letter_users의 SELECT, letter_contacts의
-- INSERT) "안에서" 호출된다. Postgres는 정책 표현식을 평가할 때 그 조회를
-- 실행하는 역할(anon 포함)이 정책이 참조하는 함수의 EXECUTE 권한도 가지고
-- 있어야 한다 — 최종 결과가 false가 되더라도 평가 자체가 막히면
-- "permission denied for function letter_is_admin" 에러가 난다. 그래서
-- 이 둘만 public 전체에 열어둔다. 안전한 이유: 인자를 받지 않고 항상
-- auth.uid() 기준으로만 "나 자신"을 확인하므로, 남의 정보를 캐낼 방법이 없다.
revoke execute on function letter_is_admin(), letter_is_approved() from public;
grant execute on function letter_is_admin(), letter_is_approved() to public;

revoke execute on function
  letter_claim_postcode(text, text), letter_postcode_exists(text),
  letter_send(text, text, text, text, text, text, text, text),
  letter_mark_read(uuid), letter_archive(uuid),
  letter_admin_list_users(), letter_admin_set_status(uuid, text)
from public, anon;

grant execute on function
  letter_claim_postcode(text, text), letter_postcode_exists(text),
  letter_send(text, text, text, text, text, text, text, text),
  letter_mark_read(uuid), letter_archive(uuid),
  letter_admin_list_users(), letter_admin_set_status(uuid, text)
to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  §7. 관리자 계정 지정 — 위 스크립트를 실행한 뒤, 아래 순서대로 한 번만
-- ═══════════════════════════════════════════════════════════════════════════
--
--  1) Supabase 대시보드 → Authentication → Users → "Add user" 로 관리자 계정을
--     만든다. 이메일과 비밀번호를 여기서 입력한다.
--     ⚠️ 비밀번호는 이 파일에도, 앱 코드에도, git 에도 절대 넣지 않는다.
--        Supabase 대시보드 밖으로 나오면 안 된다.
--
--  2) 앱에서 그 계정으로 로그인하고, 우편번호 설정 화면에서 우편번호를 고르고
--     이름은 아무거나 넣는다 (예약어라 'admin' 은 여기서 거부된다 — 3)에서 바꾼다).
--
--  3) 아래 UPDATE 의 이메일을 1)에서 만든 주소로 바꿔 SQL Editor 에서 실행한다.
--     이 한 줄이 그 계정을 관리자로 만들고 동시에 승인 상태로 올린다.
--
--        update letter_users
--        set is_admin = true,
--            status = 'approved',
--            approved_at = now(),
--            display_name = 'admin'
--        where id = (select id from auth.users where email = '관리자_이메일@example.com');
--
--  4) 앱을 새로고침하면 AndysLetter 에 "관리자" 탭이 생긴다.
--     이후 가입하는 사람은 전부 여기서 승인해 주면 된다.
--
--  관리자를 더 늘리려면 3)을 다른 이메일로 반복하면 된다.
-- ═══════════════════════════════════════════════════════════════════════════
