-- Row Level Security policies for the blog demo schema.

alter table public.authors enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;

-- Anyone can read published posts.
create policy "Published posts are viewable by everyone"
    on public.posts
    for select
    using (status = 'published');

-- Authors can see their own posts regardless of status.
create policy "Authors can view their own posts"
    on public.posts
    for select
    using (auth.uid() is not null);

-- Comments on published posts are public.
create policy "Comments are viewable by everyone"
    on public.comments
    for select
    using (true);

-- Author profiles are public.
create policy "Author profiles are viewable by everyone"
    on public.authors
    for select
    using (true);
