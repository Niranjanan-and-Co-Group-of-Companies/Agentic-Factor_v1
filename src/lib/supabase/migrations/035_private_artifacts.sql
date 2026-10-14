-- Files agents create (workbooks, decks, charts) are private: the app opens them only for the
-- owning workspace, through signed URLs that expire within minutes (/api/artifacts/file).
-- Until now the bucket was public, so anyone holding a link could open a customer's file.
UPDATE storage.buckets SET public = false WHERE id = 'mission-artifacts';
