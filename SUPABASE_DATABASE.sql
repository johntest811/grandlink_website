-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.about (
  id integer NOT NULL DEFAULT nextval('about_id_seq'::regclass),
  grand text NOT NULL,
  description text NOT NULL,
  mission text NOT NULL,
  vision text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  mission_image text,
  vision_image text,
  CONSTRAINT about_pkey PRIMARY KEY (id)
);
CREATE TABLE public.activity_logs (
  id bigint NOT NULL DEFAULT nextval('activity_logs_id_seq'::regclass),
  admin_id text NOT NULL,
  admin_name text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  page text,
  metadata jsonb,
  CONSTRAINT activity_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.addresses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  first_name text,
  last_name text,
  branch text,
  email text,
  CONSTRAINT addresses_pkey PRIMARY KEY (id)
);
CREATE TABLE public.admins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role = ANY (ARRAY['superadmin'::text, 'admin'::text, 'manager'::text, 'employee'::text])),
  created_at timestamp with time zone DEFAULT now(),
  last_login timestamp with time zone,
  employee_id integer,
  employee_number character varying,
  full_name text,
  position text CHECK ("position" = ANY (ARRAY['Sales Manager'::text, 'Site Manager'::text, 'Media Handler'::text, 'Supervisor'::text, 'Employee'::text, 'Manager'::text, 'Admin'::text, 'Superadmin'::text])),
  is_active boolean DEFAULT true,
  password text NOT NULL DEFAULT 'admin123'::text,
  CONSTRAINT admins_pkey PRIMARY KEY (id)
);
CREATE TABLE public.ar_measurements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  measurement_name character varying NOT NULL,
  measurement_type character varying NOT NULL DEFAULT 'general'::character varying CHECK (measurement_type::text = ANY (ARRAY['door'::character varying, 'window'::character varying, 'railing'::character varying, 'wall'::character varying, 'ceiling'::character varying, 'floor'::character varying, 'general'::character varying]::text[])),
  points jsonb NOT NULL,
  distances jsonb NOT NULL,
  total_measurements integer NOT NULL DEFAULT 0,
  unit character varying NOT NULL DEFAULT 'cm'::character varying CHECK (unit::text = ANY (ARRAY['cm'::character varying, 'm'::character varying, 'ft'::character varying, 'in'::character varying]::text[])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  device_info jsonb,
  notes text,
  is_favorite boolean DEFAULT false,
  CONSTRAINT ar_measurements_pkey PRIMARY KEY (id),
  CONSTRAINT ar_measurements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.blog_likes (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  blog_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT blog_likes_pkey PRIMARY KEY (id),
  CONSTRAINT blog_likes_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id),
  CONSTRAINT blog_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.blog_views (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  blog_id uuid NOT NULL,
  user_id uuid,
  visitor_id uuid,
  user_agent text,
  CONSTRAINT blog_views_pkey PRIMARY KEY (id),
  CONSTRAINT blog_views_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id)
);
CREATE TABLE public.blogs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  content_html text NOT NULL DEFAULT ''::text,
  cover_image_url text,
  author_name text,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamp with time zone,
  created_by_admin_id text,
  updated_by_admin_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT blogs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.calendar_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  start timestamp with time zone NOT NULL,
  end timestamp with time zone,
  location text,
  created_at timestamp without time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT calendar_events_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.cart (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cart_pkey PRIMARY KEY (id),
  CONSTRAINT cart_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT cart_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  thread_id uuid NOT NULL,
  sender_type text NOT NULL CHECK (sender_type = ANY (ARRAY['visitor'::text, 'user'::text, 'admin'::text])),
  sender_name text,
  sender_email text,
  body text,
  image_url text,
  read_by_admin boolean NOT NULL DEFAULT false,
  read_by_user boolean NOT NULL DEFAULT false,
  CONSTRAINT chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT chat_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.chat_threads(id)
);
CREATE TABLE public.chat_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_message_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'resolved'::text])),
  visitor_name text,
  visitor_email text,
  user_id uuid,
  access_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  accepted_at timestamp with time zone,
  resolved_at timestamp with time zone,
  resolved_by text,
  CONSTRAINT chat_threads_pkey PRIMARY KEY (id)
);
CREATE TABLE public.discount_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type = ANY (ARRAY['percent'::text, 'amount'::text])),
  value numeric NOT NULL,
  min_subtotal numeric DEFAULT 0,
  max_uses integer,
  used_count integer DEFAULT 0,
  active boolean DEFAULT true,
  starts_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT discount_codes_pkey PRIMARY KEY (id)
);
CREATE TABLE public.event_participants (
  id bigint NOT NULL DEFAULT nextval('event_participants_id_seq'::regclass),
  event_id bigint,
  user_id uuid,
  role text DEFAULT 'attendee'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT event_participants_pkey PRIMARY KEY (id),
  CONSTRAINT event_participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.event_tags (
  id bigint NOT NULL DEFAULT nextval('event_tags_id_seq'::regclass),
  event_id bigint,
  tag text NOT NULL,
  CONSTRAINT event_tags_pkey PRIMARY KEY (id),
  CONSTRAINT event_tags_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id)
);
CREATE TABLE public.events (
  id bigint NOT NULL DEFAULT nextval('events_id_seq'::regclass),
  title text NOT NULL,
  description text,
  category text DEFAULT 'Other'::text CHECK (category = ANY (ARRAY['Production'::text, 'Meeting'::text, 'Deadline'::text, 'Personal'::text, 'Other'::text])),
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  location text,
  recurrence_rule text,
  reminder_minutes integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT events_pkey PRIMARY KEY (id)
);
CREATE TABLE public.faq_categories (
  id bigint NOT NULL DEFAULT nextval('faq_categories_id_seq'::regclass),
  name text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT faq_categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.faq_questions (
  id bigint NOT NULL DEFAULT nextval('faq_questions_id_seq'::regclass),
  category_id bigint,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT faq_questions_pkey PRIMARY KEY (id),
  CONSTRAINT faq_questions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.faq_categories(id)
);
CREATE TABLE public.faqs (
  id bigint NOT NULL DEFAULT nextval('faqs_id_seq'::regclass),
  category text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT faqs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.featured_projects (
  id bigint NOT NULL DEFAULT nextval('featured_projects_id_seq'::regclass),
  title text NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT now(),
  image_url text,
  link_url text,
  CONSTRAINT featured_projects_pkey PRIMARY KEY (id)
);
CREATE TABLE public.home_content (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  content jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT home_content_pkey PRIMARY KEY (id)
);
CREATE TABLE public.inqruire_content (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  phone text,
  email text,
  facebook text,
  CONSTRAINT inqruire_content_pkey PRIMARY KEY (id)
);
CREATE TABLE public.inquiries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  inquiry_type text NOT NULL CHECK (inquiry_type = ANY (ARRAY['Doors'::text, 'Windows'::text, 'Enclosure'::text, 'Casement'::text, 'Sliding'::text, 'Railings'::text, 'Canopy'::text, 'Curtain Wall'::text, 'Custom Design'::text])),
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inquiries_pkey PRIMARY KEY (id)
);
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_item_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  invoice_number text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'PHP'::text,
  subtotal numeric NOT NULL DEFAULT 0,
  addons_total numeric NOT NULL DEFAULT 0,
  discount_value numeric NOT NULL DEFAULT 0,
  reservation_fee numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  payment_method text,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  invoice_html text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_user_item_id_fkey FOREIGN KEY (user_item_id) REFERENCES public.user_items(id),
  CONSTRAINT invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.notifications (
  id bigint NOT NULL DEFAULT nextval('notifications_id_seq'::regclass),
  title text NOT NULL,
  message text NOT NULL,
  type text DEFAULT 'general'::text CHECK (type = ANY (ARRAY['report'::text, 'stock'::text, 'task'::text, 'general'::text, 'product_added'::text, 'stock_updated'::text, 'order_status'::text])),
  recipient_role text DEFAULT 'all'::text CHECK (recipient_role = ANY (ARRAY['employee'::text, 'manager'::text, 'admin'::text, 'all'::text])),
  recipient_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  priority text DEFAULT 'medium'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  action_url text,
  expires_at timestamp with time zone,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id)
);
CREATE TABLE public.order_team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_item_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  created_by_admin_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT order_team_members_pkey PRIMARY KEY (id),
  CONSTRAINT order_team_members_user_item_id_fkey FOREIGN KEY (user_item_id) REFERENCES public.user_items(id),
  CONSTRAINT order_team_members_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id),
  CONSTRAINT order_team_members_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.admins(id)
);
CREATE TABLE public.payment_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  user_item_id uuid,
  stripe_session_id text NOT NULL UNIQUE,
  amount numeric NOT NULL,
  currency text DEFAULT 'php'::text,
  status text DEFAULT 'pending'::text,
  payment_type text DEFAULT 'reservation'::text,
  created_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  payment_provider text DEFAULT 'paymongo'::text,
  paypal_order_id text,
  converted_amount numeric,
  converted_currency text,
  CONSTRAINT payment_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT payment_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT payment_sessions_user_item_id_fkey FOREIGN KEY (user_item_id) REFERENCES public.user_items(id)
);
CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  images ARRAY DEFAULT '{}'::text[],
  fbx_url text,
  created_at timestamp with time zone DEFAULT now(),
  category text,
  height numeric,
  width numeric,
  thickness numeric,
  material text,
  type text,
  image1 text,
  image2 text,
  image3 text,
  image4 text,
  image5 text,
  fullproductname text,
  additionalfeatures text,
  inventory integer DEFAULT 0,
  fbx_urls ARRAY DEFAULT '{}'::text[],
  last_stock_update timestamp with time zone DEFAULT now(),
  stock_notification_sent boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  skyboxes jsonb,
  CONSTRAINT products_pkey PRIMARY KEY (id)
);
CREATE TABLE public.products_archive (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  product_name text,
  product_category text,
  product_price numeric,
  product_data jsonb NOT NULL,
  archived_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_by uuid,
  archived_by_name text,
  CONSTRAINT products_archive_pkey PRIMARY KEY (id),
  CONSTRAINT products_archive_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.admins(id)
);
CREATE TABLE public.rbac_admin_page_overrides (
  admin_id uuid NOT NULL,
  page_key text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rbac_admin_page_overrides_pkey PRIMARY KEY (admin_id, page_key),
  CONSTRAINT rbac_admin_page_overrides_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id),
  CONSTRAINT rbac_admin_page_overrides_page_key_fkey FOREIGN KEY (page_key) REFERENCES public.rbac_pages(key),
  CONSTRAINT rbac_admin_page_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id)
);
CREATE TABLE public.rbac_pages (
  key text NOT NULL,
  name text NOT NULL,
  path text NOT NULL UNIQUE,
  group_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rbac_pages_pkey PRIMARY KEY (key)
);
CREATE TABLE public.rbac_position_pages (
  position_name text NOT NULL,
  page_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rbac_position_pages_pkey PRIMARY KEY (position_name, page_key),
  CONSTRAINT rbac_position_pages_position_name_fkey FOREIGN KEY (position_name) REFERENCES public.rbac_positions(name),
  CONSTRAINT rbac_position_pages_page_key_fkey FOREIGN KEY (page_key) REFERENCES public.rbac_pages(key)
);
CREATE TABLE public.rbac_positions (
  name text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rbac_positions_pkey PRIMARY KEY (name)
);
CREATE TABLE public.reservations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  user_item_id uuid,
  name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  store_branch text NOT NULL,
  type_of_product text NOT NULL,
  product_model text,
  width numeric,
  height numeric,
  thickness numeric,
  construction text,
  remarks text,
  address text,
  agree boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT reservations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.sales_inventory_9months (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  month_start date NOT NULL,
  branch text NOT NULL DEFAULT 'unknown'::text,
  units_sold integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_inventory_9months_pkey PRIMARY KEY (id),
  CONSTRAINT sales_inventory_9months_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.sales_reports (
  id bigint NOT NULL DEFAULT nextval('sales_reports_id_seq'::regclass),
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  total_sales numeric DEFAULT 0.00,
  total_products_sold integer DEFAULT 0,
  total_orders integer DEFAULT 0,
  successful_orders integer DEFAULT 0,
  cancelled_orders integer DEFAULT 0,
  pending_orders integer DEFAULT 0,
  report_data jsonb,
  generated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  products_data jsonb DEFAULT '{}'::jsonb,
  inventory_summary jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT sales_reports_pkey PRIMARY KEY (id),
  CONSTRAINT sales_reports_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES auth.users(id)
);
CREATE TABLE public.services (
  id bigint NOT NULL DEFAULT nextval('services_id_seq'::regclass),
  name text NOT NULL,
  short_description text,
  long_description text,
  created_at timestamp without time zone DEFAULT now(),
  icon text,
  icon_url text,
  CONSTRAINT services_pkey PRIMARY KEY (id)
);
CREATE TABLE public.services_page_content (
  slug text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT services_page_content_pkey PRIMARY KEY (slug)
);
CREATE TABLE public.showrooms (
  id bigint NOT NULL DEFAULT nextval('showrooms_id_seq'::regclass),
  title text NOT NULL,
  address text,
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  image text,
  CONSTRAINT showrooms_pkey PRIMARY KEY (id)
);
CREATE TABLE public.task_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id bigint NOT NULL,
  submitted_by_admin_id uuid,
  submitted_by_name text,
  description text,
  image_urls ARRAY,
  status text NOT NULL DEFAULT 'submitted'::text CHECK (status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text])),
  is_final_qc boolean NOT NULL DEFAULT false,
  approved_by_admin_id uuid,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  visible_to_customer boolean NOT NULL DEFAULT false,
  CONSTRAINT task_updates_pkey PRIMARY KEY (id),
  CONSTRAINT task_updates_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_updates_submitted_by_admin_id_fkey FOREIGN KEY (submitted_by_admin_id) REFERENCES public.admins(id),
  CONSTRAINT task_updates_approved_by_admin_id_fkey FOREIGN KEY (approved_by_admin_id) REFERENCES public.admins(id)
);
CREATE TABLE public.tasks (
  id integer NOT NULL DEFAULT nextval('tasks_id_seq'::regclass),
  task_number character varying NOT NULL,
  product_name character varying NOT NULL,
  task_name character varying NOT NULL,
  employee_id integer,
  employee_name character varying NOT NULL,
  employee_number character varying NOT NULL,
  start_date date NOT NULL,
  due_date date NOT NULL,
  status character varying DEFAULT 'Pending'::character varying,
  created_at timestamp without time zone DEFAULT now(),
  user_item_id uuid,
  product_id uuid,
  assigned_admin_id uuid,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_user_item_id_fkey FOREIGN KEY (user_item_id) REFERENCES public.user_items(id),
  CONSTRAINT tasks_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT tasks_assigned_admin_id_fkey FOREIGN KEY (assigned_admin_id) REFERENCES public.admins(id)
);
CREATE TABLE public.user_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type = ANY (ARRAY['my-list'::text, 'reserve'::text, 'order'::text, 'reservation'::text, 'cart'::text])),
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'pending_payment'::text, 'pending_acceptance'::text, 'reserved'::text, 'accepted'::text, 'approved'::text, 'in_production'::text, 'start_packaging'::text, 'ready_for_delivery'::text, 'completed'::text, 'cancelled'::text, 'pending_cancellation'::text, 'packaging'::text, 'quality_check'::text, 'out_for_delivery'::text, 'pending_balance_payment'::text])),
  quantity integer NOT NULL DEFAULT 1,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  reservation_fee numeric DEFAULT 500,
  payment_intent_id text,
  delivery_address_id uuid,
  special_instructions text,
  admin_notes text,
  estimated_delivery_date date,
  payment_id text,
  payment_status text DEFAULT 'pending'::text,
  updated_at timestamp with time zone DEFAULT now(),
  price numeric,
  total_amount numeric,
  customer_name text,
  customer_email text,
  customer_phone text,
  delivery_address text,
  payment_method text,
  order_status text DEFAULT 'pending_payment'::text,
  order_progress text DEFAULT 'awaiting_payment'::text,
  admin_accepted_at timestamp with time zone,
  accepted_by_admin_id uuid,
  cancellation_requested_at timestamp with time zone,
  cancellation_approved_at timestamp with time zone,
  cancelled_by_admin_id uuid,
  cancellation_notes text,
  progress_history jsonb DEFAULT '[]'::jsonb,
  balance_payment_status text,
  balance_payment_id text,
  total_paid numeric,
  CONSTRAINT user_items_pkey PRIMARY KEY (id),
  CONSTRAINT user_items_delivery_address_id_fkey FOREIGN KEY (delivery_address_id) REFERENCES public.addresses(id),
  CONSTRAINT user_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.user_notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  email_notifications boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  new_product_notifications boolean DEFAULT true,
  stock_update_notifications boolean DEFAULT true,
  order_status_notifications boolean DEFAULT true,
  order_updates boolean DEFAULT true,
  sms_notifications boolean DEFAULT false,
  push_notifications boolean DEFAULT true,
  CONSTRAINT user_notification_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT user_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_notifications (
  id bigint NOT NULL DEFAULT nextval('user_notifications_id_seq'::regclass),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text DEFAULT 'general'::text CHECK (type = ANY (ARRAY['new_product'::text, 'stock_update'::text, 'order_status'::text, 'general'::text])),
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  action_url text,
  product_id uuid,
  order_id uuid,
  CONSTRAINT user_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_notifications_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.warranties (
  id bigint NOT NULL DEFAULT nextval('warranties_id_seq'::regclass),
  title text,
  description text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT warranties_pkey PRIMARY KEY (id)
);