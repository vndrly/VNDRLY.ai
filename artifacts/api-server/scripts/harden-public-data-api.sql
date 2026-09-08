-- The application authenticates through Express, not Supabase's Data API.
-- Keep Storage/auth schemas untouched and preserve the backend identities.
DO $hardening$
DECLARE
  item record;
  blocked_role text;
  target_name text;
  columns_sql text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN
    RETURN;
  END IF;
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = current_user AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Public Data API hardening requires the reviewed postgres BYPASSRLS backend role';
  END IF;

  GRANT USAGE ON SCHEMA public TO postgres;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
  END IF;
  -- Schema denial also blocks future objects created by managed roles whose
  -- default ACLs postgres cannot change. Object ACLs remain defense in depth.
  REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC;
  FOR blocked_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE USAGE, CREATE ON SCHEMA public FROM %I', blocked_role);
  END LOOP;

  FOR item IN
    SELECT c.oid, c.relname, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    target_name := format('public.%I', item.relname);
    IF item.relkind IN ('r','p') THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_name);
    END IF;
    FOR blocked_role IN SELECT 'PUBLIC' UNION ALL SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM %s',
        CASE WHEN item.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
        target_name, CASE WHEN blocked_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(blocked_role) END);
      -- Column-level grants survive table-level REVOKE.
      IF item.relkind <> 'S' THEN
        SELECT string_agg(quote_ident(attname), ', ') INTO columns_sql
          FROM pg_attribute WHERE attrelid = item.oid AND attnum > 0 AND NOT attisdropped;
        IF columns_sql IS NOT NULL THEN
          EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$s FROM %3$s',
            columns_sql, target_name, CASE WHEN blocked_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(blocked_role) END);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  FOR item IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f','p','w')
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    target_name := format('public.%I(%s)', item.proname, item.args);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO postgres', target_name);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', target_name);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', target_name);
    FOR blocked_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM %I', target_name, blocked_role);
    END LOOP;
  END LOOP;

  -- Function EXECUTE defaults are global; a schema-only revoke is insufficient.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  FOR blocked_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM %I', blocked_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM %I', blocked_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM %I', blocked_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', blocked_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', blocked_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', blocked_role);
  END LOOP;
  -- Retain backend access when future routines no longer inherit PUBLIC EXECUTE.
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
  END IF;

  FOR blocked_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    IF has_schema_privilege(blocked_role, 'public', 'USAGE') OR has_schema_privilege(blocked_role, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'Public Data API schema verification failed for %', blocked_role;
    END IF;
    IF EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
        AND (has_table_privilege(blocked_role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(blocked_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    ) THEN RAISE EXCEPTION 'Public Data API table verification failed for %', blocked_role; END IF;
    IF EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='S'
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
        AND has_sequence_privilege(blocked_role,c.oid,'USAGE,SELECT,UPDATE')
    ) THEN RAISE EXCEPTION 'Public Data API sequence verification failed for %', blocked_role; END IF;
    IF EXISTS (
      SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind IN ('f','p','w')
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
        AND has_function_privilege(blocked_role,p.oid,'EXECUTE')
    ) THEN RAISE EXCEPTION 'Public Data API routine verification failed for %', blocked_role; END IF;
  END LOOP;
  IF EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  ) THEN RAISE EXCEPTION 'Public Data API RLS verification failed'; END IF;
END
$hardening$;
