import { pgTable, serial, text, index } from "drizzle-orm/pg-core";

export const surveys = pgTable("surveys", {
  id: text().primaryKey(),
  owner: text().notNull(),
  definition: text().notNull(),
});

export const responses = pgTable(
  "responses",
  {
    id: serial().primaryKey(),
    surveyId: text("survey_id").notNull().references(() => surveys.id),
    submitted: text().notNull(),
    answers: text().notNull(),
  },
  (t) => [index("responses_survey").on(t.surveyId, t.id)],
);
