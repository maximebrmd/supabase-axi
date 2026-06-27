-- Synthetic seed data for the blog demo. 100% fake.

insert into public.authors (email, display_name, bio) values
    ('ada@example.com',   'Ada Lovelace',    'Writes about analytical engines.'),
    ('grace@example.com', 'Grace Hopper',    'Compiler enthusiast.'),
    ('alan@example.com',  'Alan Turing',     'Thinks about thinking machines.'),
    ('katherine@example.com', 'Katherine Johnson', 'Orbital mechanics and trajectories.');

insert into public.tags (name, slug) values
    ('Engineering', 'engineering'),
    ('History',     'history'),
    ('Mathematics', 'mathematics'),
    ('Opinion',     'opinion');

insert into public.posts (author_id, title, slug, body, status, view_count, published_at) values
    (1, 'On Analytical Engines',        'on-analytical-engines',   'A long-form essay.', 'published', 1280, now() - interval '10 days'),
    (1, 'Notes on Looms',               'notes-on-looms',          'Draft notes.',       'draft',       0, null),
    (2, 'The First Compiler',           'the-first-compiler',      'How it began.',      'published',  942, now() - interval '7 days'),
    (3, 'Can Machines Think?',          'can-machines-think',      'An inquiry.',        'published', 5310, now() - interval '3 days'),
    (4, 'Trajectories to Orbit',        'trajectories-to-orbit',   'The math of it.',    'archived',   210, now() - interval '30 days');

insert into public.post_tags (post_id, tag_id) values
    (1, 1), (1, 2),
    (3, 1), (3, 2),
    (4, 1), (4, 3),
    (5, 3);

insert into public.comments (post_id, author_id, body) values
    (1, 2, 'Fascinating perspective.'),
    (1, 3, 'I disagree on one point.'),
    (3, 1, 'This brings back memories.'),
    (4, 2, 'A timeless question.'),
    (4, 4, 'The math checks out.');
