-- ─────────────────────────────────────────────────────────────────────────────
-- The registry. Structure follows Matrix_V3_Platform_Path.md §4 ("The registry
-- (Stage 1 tables, `ontology` schema)"), trimmed to what the PoC proves.
--
-- Design note: child rows reference object types by api_name + version_id rather
-- than by FK to object_type.id. This is deliberate — a tenant overlay must be
-- able to add a property to a BASE object type it does not own. api_name is the
-- stable identity across versions; that is also how Foundry's Marketplace keeps
-- API-name consistency when installing a product into another enrollment.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS ontology;

-- A version is either the shared base package (tenant_id IS NULL) or one
-- tenant's overlay on top of it (tenant_id set, parent_id -> the base version).
CREATE TABLE ontology.ontology_version (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  package    text NOT NULL,
  semver     text NOT NULL,
  status     text NOT NULL DEFAULT 'published'
               CHECK (status IN ('draft','published','retired')),
  parent_id  uuid REFERENCES ontology.ontology_version(id),
  CONSTRAINT uq_version UNIQUE (package, semver, tenant_id)
);

CREATE TABLE ontology.object_type (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id    uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  api_name      text NOT NULL,
  display_name  text NOT NULL,
  plural        text NOT NULL,
  primary_key   text NOT NULL,
  implements    text[] NOT NULL DEFAULT '{}',
  CONSTRAINT uq_object_type UNIQUE (version_id, api_name)
);

-- storage: 'column'    -> a real typed column on the backing table
--          'props_json'-> a key inside the props jsonb overlay column
CREATE TABLE ontology.property_def (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id    uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  object_type   text NOT NULL,
  api_name      text NOT NULL,
  display_name  text NOT NULL,
  type          text NOT NULL,
  required      boolean NOT NULL DEFAULT false,
  storage       text NOT NULL DEFAULT 'column'
                  CHECK (storage IN ('column','props_json','derived')),
  column_name   text,
  constraints   jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_property_def UNIQUE (version_id, object_type, api_name)
);

CREATE TABLE ontology.link_type (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id   uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  api_name     text NOT NULL,
  from_type    text NOT NULL,
  to_type      text NOT NULL,
  cardinality  text NOT NULL CHECK (cardinality IN ('one_to_one','one_to_many','many_to_many')),
  backing      text NOT NULL DEFAULT 'fk' CHECK (backing IN ('fk','join_table')),
  from_column  text NOT NULL,
  to_column    text NOT NULL,
  display      text,
  CONSTRAINT uq_link_type UNIQUE (version_id, api_name)
);

-- preconditions is JsonLogic. This is the row that makes an approval flow
-- editable without a deploy — see gate_demo in demo.py.
CREATE TABLE ontology.action_type (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id      uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  api_name        text NOT NULL,
  object_type     text NOT NULL,
  display_name    text NOT NULL,
  from_status     text[] NOT NULL DEFAULT '{}',
  to_status       text,
  preconditions   jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_role   text,
  required_module text,
  side_effects    jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_action_type UNIQUE (version_id, api_name)
);

-- The seam. Only kind='native' is implemented here; 'ingested' and 'virtual'
-- exist so adding them later is additive rather than a read-path rewrite.
CREATE TABLE ontology.datasource_binding (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id    uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  object_type   text NOT NULL,
  kind          text NOT NULL DEFAULT 'native'
                  CHECK (kind IN ('native','ingested','virtual')),
  schema_name   text NOT NULL,
  table_name    text NOT NULL,
  pk_column     text NOT NULL,
  tenant_column text,
  -- column_map: {"<property api_name>": "<physical column>"} — Foundry's MDO
  -- column mapping. Absent entries fall back to the property's column_name.
  column_map    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- value_map: {"<property>": {"<their value>": "<our value>"}}. Column mapping
  -- alone is not enough — a client's ERP says 'CLEARED' where the base ontology
  -- says 'positive'. Foundry pushes this into a transform; here it is declared.
  value_map     jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_binding UNIQUE (version_id, object_type)
);

CREATE TABLE ontology.interface (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id          uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  api_name            text NOT NULL,
  required_properties text[] NOT NULL DEFAULT '{}',
  CONSTRAINT uq_interface UNIQUE (version_id, api_name)
);

-- property_mapping maps the implementing type's own property api_names onto the
-- interface's shared property names — exactly Foundry's implement-an-interface
-- contract.
CREATE TABLE ontology.interface_impl (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id       uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  interface_name   text NOT NULL,
  object_type      text NOT NULL,
  property_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_interface_impl UNIQUE (version_id, interface_name, object_type)
);

-- The overlay column requirement #4 needs. One jsonb per backing table, GIN
-- indexed; promoted to a real generated column when a tenant filters on it hot.
-- No EAV table, ever (V3 §7).
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS props jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX idx_sites_props ON public.sites USING gin (props);
