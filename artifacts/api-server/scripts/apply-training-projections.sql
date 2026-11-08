-- Additive only: no source records or saved projection payloads are rewritten.
CREATE TABLE IF NOT EXISTS public.training_read_projections (
  projection_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.training_projection_queue (
  owner_key text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  lease_until timestamptz,
  next_attempt_at timestamptz DEFAULT now(),
  attempts integer DEFAULT 0
);

-- Existing queues acquire durable worker coordination without replacing rows.
ALTER TABLE public.training_projection_queue ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE public.training_projection_queue ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now();
ALTER TABLE public.training_projection_queue ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0;

ALTER TABLE public.training_read_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_projection_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_read_projections, public.training_projection_queue FROM PUBLIC;
DO $access$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.training_read_projections, public.training_projection_queue FROM %I',role_name);
    END IF;
  END LOOP;
  -- The API uses the owning postgres connection; Supabase service_role bypasses RLS.
  -- No client-role policy is installed. Existing source-table grants are untouched.
  FOREACH role_name IN ARRAY ARRAY['postgres','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.training_read_projections, public.training_projection_queue TO %I',role_name);
    END IF;
  END LOOP;
END $access$;

-- This helper changes only the dirty timestamp, never payload/completion/error.
-- A NULL owner means a global dependency: dirty the known owners conservatively.
CREATE OR REPLACE FUNCTION public.mark_training_projection_dirty(owner text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $dirty$
BEGIN
  IF owner IS NULL THEN
    UPDATE public.training_projection_queue
       SET requested_at=GREATEST(clock_timestamp(),requested_at+interval '1 microsecond');
  ELSIF owner ~ '^((vendor|partner):[0-9]+|metrics:site:[0-9]+|metrics:global)$' THEN
    INSERT INTO public.training_projection_queue(owner_key,requested_at)
      VALUES(owner,clock_timestamp())
      ON CONFLICT(owner_key) DO UPDATE
      SET requested_at=GREATEST(EXCLUDED.requested_at,training_projection_queue.requested_at+interval '1 microsecond');
  END IF;
END $dirty$;

-- Resolve only ownership/foreign keys. No count, score, JSON projection or course
-- body is calculated here. OLD and NEW both invalidate on a move between owners.
CREATE OR REPLACE FUNCTION public.training_projection_source_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $changed$
DECLARE r record; linked record; mode text:=TG_ARGV[0]; pass integer;
        owner text; matched boolean; lookup_user_id integer;
BEGIN
  IF mode='global' THEN
    PERFORM public.mark_training_projection_dirty(NULL);
    RETURN NULL;
  END IF;
  FOR pass IN 1..2 LOOP
    IF pass=1 THEN
      IF TG_OP='INSERT' THEN CONTINUE; END IF;
      r:=OLD;
    ELSE
      IF TG_OP='DELETE' THEN CONTINUE; END IF;
      r:=NEW;
    END IF;
    owner:=NULL;
    matched:=false;
    IF mode='owner' THEN
      IF r.owner_org_type IN ('vendor','partner') THEN
        owner:=r.owner_org_type||':'||r.owner_org_id;
      END IF;
    ELSIF mode='org' THEN
      IF r.org_type IN ('vendor','partner') THEN owner:=r.org_type||':'||r.org_id; END IF;
    ELSIF mode='vendor' THEN owner:='vendor:'||r.vendor_id;
    ELSIF mode='vendor-id' THEN owner:='vendor:'||r.id;
    ELSIF mode='partner-id' THEN owner:='partner:'||r.id;
    ELSIF mode='company' THEN owner:='vendor:'||r.company_id;
    ELSIF mode='membership' THEN
      IF r.org_type='vendor' THEN owner:='vendor:'||r.vendor_id;
      ELSIF r.org_type='partner' THEN owner:='partner:'||r.partner_id; END IF;
    ELSIF mode='instance' THEN
      SELECT t.owner_org_type||':'||t.owner_org_id INTO owner
        FROM public.work_hub_form_templates t WHERE t.id=r.template_id
        AND t.owner_org_type IN ('vendor','partner');
    ELSIF mode='submission' THEN
      SELECT t.owner_org_type||':'||t.owner_org_id INTO owner
        FROM public.work_hub_form_instances i
        JOIN public.work_hub_form_templates t ON t.id=i.template_id
        WHERE i.id=r.instance_id AND t.owner_org_type IN ('vendor','partner');
    ELSIF mode='certificate' THEN
      SELECT 'vendor:'||p.vendor_id INTO owner FROM public.vendor_people p WHERE p.id=r.employee_id;
    ELSIF mode='offer' THEN
      SELECT 'vendor:'||c.vendor_id INTO owner FROM public.vendor_capabilities c WHERE c.id=r.vendor_capability_id;
      IF r.partner_id IS NOT NULL THEN
        PERFORM public.mark_training_projection_dirty('partner:'||r.partner_id); matched:=true;
      END IF;
    ELSIF mode='event' THEN
      PERFORM public.mark_training_projection_dirty('metrics:global');
      IF r.site_location_id IS NOT NULL THEN
        PERFORM public.mark_training_projection_dirty('metrics:site:'||r.site_location_id);
      END IF;
      IF r.vendor_id IS NOT NULL THEN
        PERFORM public.mark_training_projection_dirty('vendor:'||r.vendor_id); matched:=true;
      END IF;
      IF r.partner_id IS NOT NULL THEN owner:='partner:'||r.partner_id; END IF;
    ELSIF mode='event-child' THEN
      PERFORM public.mark_training_projection_dirty('metrics:global');
      SELECT e.vendor_id,e.partner_id,e.site_location_id INTO linked FROM public.safety_events e WHERE e.id=r.event_id;
      IF FOUND THEN
        IF linked.site_location_id IS NOT NULL THEN
          PERFORM public.mark_training_projection_dirty('metrics:site:'||linked.site_location_id);
        END IF;
        IF linked.vendor_id IS NOT NULL THEN
          PERFORM public.mark_training_projection_dirty('vendor:'||linked.vendor_id); matched:=true;
        END IF;
        IF linked.partner_id IS NOT NULL THEN owner:='partner:'||linked.partner_id; END IF;
      END IF;
    ELSIF mode='site' THEN
      -- New sites need a new queue key, not only invalidation of existing keys.
      PERFORM public.mark_training_projection_dirty('metrics:site:'||r.id);
      PERFORM public.mark_training_projection_dirty('metrics:global');
      PERFORM public.mark_training_projection_dirty(NULL);
      matched:=true;
    ELSIF mode IN ('user','user-child') THEN
      IF mode='user' THEN lookup_user_id:=r.id; ELSE lookup_user_id:=r.user_id; END IF;
      FOR linked IN
        SELECT m.org_type,m.vendor_id,m.partner_id FROM public.user_org_memberships m
        WHERE m.user_id=lookup_user_id
      LOOP
        IF linked.org_type='vendor' AND linked.vendor_id IS NOT NULL THEN
          PERFORM public.mark_training_projection_dirty('vendor:'||linked.vendor_id); matched:=true;
        ELSIF linked.org_type='partner' AND linked.partner_id IS NOT NULL THEN
          PERFORM public.mark_training_projection_dirty('partner:'||linked.partner_id); matched:=true;
        END IF;
      END LOOP;
    END IF;
    IF owner IS NOT NULL THEN PERFORM public.mark_training_projection_dirty(owner); matched:=true; END IF;
    -- A missing parent during cascades or a platform-owned dependency must not
    -- silently leave saved data current. Conservative fallback is mutation-only.
    IF NOT matched THEN PERFORM public.mark_training_projection_dirty(NULL); END IF;
  END LOOP;
  RETURN NULL;
END $changed$;

REVOKE ALL ON FUNCTION public.mark_training_projection_dirty(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.training_projection_source_changed() FROM PUBLIC;
DO $function_access$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.mark_training_projection_dirty(text), public.training_projection_source_changed() FROM %I',role_name);
    END IF;
  END LOOP;
END $function_access$;

-- Initial discovery is migration work, never a page-read side effect. Existing
-- queue records and every existing projection remain byte-for-byte untouched.
INSERT INTO public.training_projection_queue(owner_key)
  SELECT 'vendor:'||id FROM public.vendors
  UNION SELECT 'partner:'||id FROM public.partners
  UNION SELECT 'metrics:site:'||id FROM public.site_locations
  UNION SELECT 'metrics:global' WHERE true
  ON CONFLICT(owner_key) DO NOTHING;
