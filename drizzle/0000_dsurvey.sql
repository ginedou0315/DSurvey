CREATE TABLE surveys (id TEXT PRIMARY KEY, owner TEXT NOT NULL, definition TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE responses (id INTEGER PRIMARY KEY, survey_id TEXT NOT NULL REFERENCES surveys(id), submitted TEXT NOT NULL, answers TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX responses_survey ON responses(survey_id, id);
