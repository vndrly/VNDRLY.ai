import pg from 'pg';
import {guardAdditiveReplay} from '../../../scripts/guard-additive-replay.mjs';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try {
 await client.connect();
 await client.query(guardAdditiveReplay(`
 CREATE TABLE IF NOT EXISTS vndrly_u_assignments (
   id uuid PRIMARY KEY, owner_type text NOT NULL, owner_id integer NOT NULL,
   user_id integer NOT NULL REFERENCES users(id), course_id text NOT NULL,
   sources jsonb NOT NULL DEFAULT '[]', progress jsonb NOT NULL DEFAULT '{}',
   assigned_by integer NOT NULL REFERENCES users(id), assigned_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE(owner_type,owner_id,user_id,course_id)
 );
 CREATE TABLE IF NOT EXISTS vndrly_u_training_requests (
   id uuid PRIMARY KEY, owner_type text NOT NULL, owner_id integer NOT NULL,
   user_id integer NOT NULL REFERENCES users(id), target_id text NOT NULL,
   status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
   reason text, reviewed_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
 );
 CREATE UNIQUE INDEX IF NOT EXISTS vndrly_u_pending_request_idx ON vndrly_u_training_requests(owner_type,owner_id,user_id,target_id) WHERE status='pending';
 CREATE INDEX IF NOT EXISTS vndrly_u_request_company_idx ON vndrly_u_training_requests(owner_type,owner_id,created_at);
 CREATE TABLE IF NOT EXISTS vndrly_u_certifications (
   id uuid PRIMARY KEY, owner_type text NOT NULL, owner_id integer NOT NULL,
   user_id integer NOT NULL REFERENCES users(id), program_id text NOT NULL,
   progress jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE(owner_type,owner_id,user_id,program_id)
 );
 `));
 console.log('VNDRLY/U assignment and request storage ready. No company catalog copies created.');
} finally {await client.end();}
