CREATE TABLE IF NOT EXISTS "org_company_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"product_name" text NOT NULL,
	"product_summary" text NOT NULL,
	"ideal_customer_profile" text NOT NULL,
	"value_proposition" text NOT NULL,
	"differentiators" text NOT NULL,
	"proof_points" text NOT NULL,
	"rep_talking_points" text NOT NULL,
	"discovery_guidance" text NOT NULL,
	"qualification_guidance" text NOT NULL,
	"objection_handling" text NOT NULL,
	"competitor_guidance" text NOT NULL,
	"pricing_guidance" text NOT NULL,
	"implementation_guidance" text NOT NULL,
	"faq" text NOT NULL,
	"do_not_say" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_company_profiles" ADD CONSTRAINT "org_company_profiles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
