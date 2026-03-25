--Create tables

CREATE TABLE IF NOT EXISTS public.contract_employees (
  contract_id uuid NOT NULL,
  applicant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_employees_pkey PRIMARY KEY (contract_id, applicant_id),
  CONSTRAINT contract_employees_contract_id_fkey FOREIGN KEY (contract_id)
    REFERENCES public.contracts(contract_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT contract_employees_applicant_id_fkey FOREIGN KEY (applicant_id)
    REFERENCES public.applicants(applicant_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

COMMIT;


-- If you want to alter a table:
ALTER TABLE IF EXISTS public.contracts
  ADD COLUMN IF NOT EXISTS contract_no_date date,
  ADD COLUMN IF NOT EXISTS cluster text,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS specific_area text,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS contract_start date,
  ADD COLUMN IF NOT EXISTS contract_end date,
  ADD COLUMN IF NOT EXISTS contracted_manpower integer,
  ADD COLUMN IF NOT EXISTS deployed_guards integer,
  ADD COLUMN IF NOT EXISTS remarks text;

  --Create table if not exists public.ReStock(
   
    --id_ReStock uuid NOT NULL,
    --Date character varying,
    --Status text,
    --Item text,
    --Quanitity character varying,
    --timestamptz timestamp NOT NULL DEFAULT now()
  --);

  --create table if not exists public.Paraphernalia (
    --id_Paraphernalia uuid NOT NULL,
    --names text,
    --items character varying,
    --quantity integer,
    --price numeric,
    --Date character varying, 
    --Timestamp timestamp NOT NUll DEFAULT now()
  --);

  --create table if not exists public.Paraphernalia_Inventory(
  --id_Paraphernalia_Inventory uuid NOT NULL,
  --items text,
  --stock_balance numeric,
  --stock_in numeric,
  --stock_out numeric
  --);

  --create table if not exists public.resigned(
          --last_name varchar,
          --first_name varchar,
          --middle_name varchar,
          --date_resigned character varying,
          --detachment character varying,
          --remarks text,
          --last_duty character varying,
          --Timestamp timestamp NOT NULL DEFAULT now()
  --);
-- ror_message text
-- );
-- CREATE TABLE IF NOT EXISTS public.audit_log (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   created_at timestamptz NOT NULL DEFAULT now(),
--   actor_user_id uuid NULL,
--   actor_email text NULL,
--   action text NOT NULL,
--   page text NULL,
--   entity text NULL,
--   details jsonb NULL
-- );
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_email_settings_provider
--   ON public.notification_email_settings (provider);
-- CREATE TABLE IF NOT EXISTS public.notification_preferences (
--   id uuid NOT NULL DEFAULT gen_random_uuid(),
--   created_at timestamp with time zone NOT NULL DEFAULT now(),
--   updated_at timestamp with time zone NOT NULL DEFAULT now(),
--   is_enabled boolean NOT NULL DEFAULT true,
--   days_before_expiry integer NOT NULL DEFAULT 30 CHECK (days_before_expiry >= 1 AND days_before_expiry <= 365),
--   include_driver_license boolean NOT NULL DEFAULT false,
--   include_security_license boolean NOT NULL DEFAULT true,
--   include_insurance boolean NOT NULL DEFAULT false,
--   send_time_local time without time zone NOT NULL DEFAULT '08:00:00'::time without time zone,
--   timezone text NOT NULL DEFAULT 'Asia/Manila'::text,
--   CONSTRAINT notification_preferences_pkey PRIMARY KEY (id)
-- );

create table if not exists public.inventory_fixed_asset(
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
date character varying,
partial varchar,
quanitity integer,
amount numeric,
remarks varchar,
firearms_ammunitions varchar,
communications_equipment varchar,
furniture_and_fixtures varchar,
office_equipments_sec_equipments varchar,
sec_equipments varchar,
vehicle_and_motorcycle varchar,
total_amount numeric,
grand_total numeric
);


