CREATE TABLE "responses" (
	"id" serial PRIMARY KEY,
	"survey_id" text NOT NULL,
	"submitted" text NOT NULL,
	"answers" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" text PRIMARY KEY,
	"owner" text NOT NULL,
	"definition" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "responses_survey" ON "responses" ("survey_id","id");--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_survey_id_surveys_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id");