-- Synthetic demo schema: a small blog domain.
-- NOTE: This is 100% fake data for benchmarking. No real/private data.
--
-- Tables: authors, posts, comments, tags, post_tags (join)
-- Relationships:
--   posts.author_id      -> authors.id
--   comments.post_id     -> posts.id
--   comments.author_id   -> authors.id
--   post_tags.post_id    -> posts.id
--   post_tags.tag_id     -> tags.id

create table public.authors (
    id          bigint generated always as identity primary key,
    email       text not null unique,
    display_name text not null,
    bio         text,
    created_at  timestamptz not null default now()
);

create table public.posts (
    id           bigint generated always as identity primary key,
    author_id    bigint not null references public.authors (id) on delete cascade,
    title        text not null,
    slug         text not null unique,
    body         text,
    status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    view_count   integer not null default 0,
    published_at timestamptz,
    created_at   timestamptz not null default now()
);

-- A non-primary-key index used by a benchmark task.
create index posts_author_id_idx on public.posts (author_id);

create table public.tags (
    id    bigint generated always as identity primary key,
    name  text not null unique,
    slug  text not null unique
);

create table public.post_tags (
    post_id bigint not null references public.posts (id) on delete cascade,
    tag_id  bigint not null references public.tags (id) on delete cascade,
    primary key (post_id, tag_id)
);

create table public.comments (
    id         bigint generated always as identity primary key,
    post_id    bigint not null references public.posts (id) on delete cascade,
    author_id  bigint not null references public.authors (id) on delete cascade,
    body       text not null,
    created_at timestamptz not null default now()
);

-- A SQL function used by a benchmark task and by the post-stats edge function.
create or replace function public.post_comment_count(p_post_id bigint)
returns integer
language sql
stable
as $$
    select count(*)::integer from public.comments where post_id = p_post_id;
$$;
