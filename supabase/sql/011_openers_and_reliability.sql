ALTER TABLE agents ADD COLUMN IF NOT EXISTS openers jsonb DEFAULT '[]'::jsonb;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS prepared_followup_seed text;
