# Private application database boundary

Production preflight found 102 public application tables with automatic anon and
authenticated privileges and no row-level security. The application does not use
Supabase Data API sessions: browser/mobile requests go through Express, whose
PostgreSQL role is postgres with BYPASSRLS. Supabase Storage uses a server-only
service key. No public routines, views or extension objects existed at inspection.

The guarded `migrate:public-data-api-hardening` operation closes this independent
exposure after application migrations. It revokes public-schema access and
table, column, view, sequence and application-routine privileges from PUBLIC,
anon and authenticated. It enables table RLS without FORCE, preserves backend
access, and changes the postgres creator defaults so grants do not recur.

Managed supabase_admin defaults are not rewritten by an unprivileged role.
Schema denial independently blocks objects those defaults might expose later.
Storage/auth schemas, data rows, passwords and application sessions are unchanged.
Any future direct Data API integration requires an explicit, separately reviewed
schema and authorization design; do not restore blanket public grants.

The isolated PostgreSQL regression checks table/column/view/RPC/sequence denial,
owner/service access, repeatability, defaults and future explicit table grants.
Production verification must confirm schema/ACL/RLS read-back, normal app access,
and Storage read/write. The preflight proves exposure, not whether anyone used it;
historical access requires a separate provider-log review.
