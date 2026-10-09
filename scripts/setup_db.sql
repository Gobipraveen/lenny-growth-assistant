-- Database setup for Lenny Growth Assistant
-- Secure script with no hardcoded credentials

-- 1. Inspect and conditionally create role
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lenny_app'
   ) THEN
      CREATE ROLE lenny_app WITH LOGIN;
      RAISE NOTICE 'Role lenny_app created successfully.';
   ELSE
      RAISE NOTICE 'Role lenny_app already exists. Skipping creation.';
   END IF;
END
$do$;

-- 2. Inspect and conditionally create the database
SELECT 'CREATE DATABASE lenny_assistant OWNER lenny_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lenny_assistant')\gexec

-- 3. Grant necessary privileges
GRANT ALL PRIVILEGES ON DATABASE lenny_assistant TO lenny_app;
