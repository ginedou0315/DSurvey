# DSurvey

DSurvey builds shareable forms for attendance, registrations, concerns, and other collections. It has an owner dashboard, a separate respondent page, and downloadable Excel and PDF reports.

## Run on your computer

Install Node.js 22.13 or later. Open a terminal in the DSurvey folder and run:

```powershell
npm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). There are no packages to install or API keys to enter. This address works on the computer running the app. The app creates `dsurvey.sqlite` in the project folder and keeps it across restarts. Stop the app before making a file copy for backup. Set `DSURVEY_DB_PATH` to use a different file or `DSURVEY_PORT` to use another port.

1. Select **Create form** or use a template. Write the title and a short notice describing what you will collect, why, and how people can contact you.
2. Use **Quick add** for contact details, attendance, address, or notes. Edit the labels, answer types, and required status as needed. Use **Up**, **Down**, and **Remove** to arrange the questions. Test your changes in the live preview or tap **Preview form** on a narrow screen. Preview answers are never saved.
3. Select **Publish form**. In **Share**, send the **Respondent link** and store the **Management link** in a password manager. Open the respondent link in a private browser window to test it.
4. Use **Responses** for totals, answers per question, dropdown counts, and the response table. Download a workbook with **Responses** and **Summary** sheets or a paginated PDF with both. The PDF uses rendered pages and preserves characters supported by the device fonts. Its text is image-based.
5. To stop collection, turn off **Accept responses** in **Build** and save. You can delete individual submissions from the response table. Removed questions remain in the response history and downloads. Create a new question when its meaning changes so historical answers stay under their original heading.

## Deploy on Netlify

The repository includes a Netlify configuration. Netlify runs `npm run build`, then serves the app from a Netlify Server (`netlify/server/index.mjs`) and stores forms and responses in Netlify Database (Postgres). Migrations in `netlify/database/migrations/` are applied automatically on deploy. To restrict who can create forms, set a `DSURVEY_CREATOR_KEY` environment variable in the Netlify project settings.

## Deploy for people outside your computer

Use one Cloudflare Worker for the website and API and one Cloudflare D1 database for durable forms and responses. Workers and D1 offer free allowances suitable for a small pilot. Check the [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) pages for current usage limits. Excel and PDF generation happen in the owner's browser. 

### Deploy to your Cloudflare account

1. Sign in with Wrangler, then create a database. You need a Cloudflare account with permission to deploy Workers and manage D1. Interactive login needs no API token. For unattended deployment, use a scoped Cloudflare API token and account ID in your deployment environment.

   ```powershell
   npx wrangler login
   npx wrangler d1 create dsurvey
   ```

2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace the example database ID with the ID Wrangler returned. Apply the included migration and build the Worker:

   ```powershell
   Copy-Item wrangler.example.jsonc wrangler.jsonc
   # Edit wrangler.jsonc now with your database ID.
   npx wrangler d1 migrations apply DB --remote
   npm run build
   ```

3. For a public instance, create a random form-creation key in a password manager. Use a text editor to create an ignored `.env.production` file containing `DSURVEY_CREATOR_KEY=your-random-key` with your actual key. Deploy the Worker and secret together:

   ```powershell
   npx wrangler deploy --secrets-file .env.production
   ```

   Remove your local copy of `.env.production` once deployment succeeds and keep the key in your password manager. For later code updates, `npx wrangler deploy` preserves the configured secret. See [D1 setup](https://developers.cloudflare.com/d1/get-started/) and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

4. Open the HTTPS Worker URL from the Cloudflare dashboard. Create a test form using the creation key, submit from a private browser window, and verify the owner can see the response and download both files. Create your actual forms on that same HTTPS origin and share only the respondent links. The hosted database starts empty and is separate from your local SQLite file. Keep the same D1 binding and database ID through upgrades.

If using the included ChatGPT Site project, its hosting configuration binds the database as `DB`. The Site's access setting controls who can reach the app. Anonymous respondents need a public entry point, whether through a public Site or through your own Cloudflare deployment.

## Data access and operational limits

- Anyone who can reach the app and has the respondent link can read that form's questions and submit while it is open. The API requires a separate, randomly generated management key to edit the form or read or delete answers. It stores only a hash of each management key. Each form has its own key.
- The owner link's secret is in the URL fragment, which the browser keeps out of normal HTTP request URLs. Dashboard shortcuts store the management links in that browser. Use a trusted browser profile, save a backup of each private management link, and remove shortcuts on shared devices. The MVP does not have account recovery or a key rotation screen.
- Set the optional `DSURVEY_CREATOR_KEY` hosting secret to limit creation on a public instance. Respondents never need it. For a public rollout, configure traffic limits for submission and creation routes based on expected volume. Anonymous submissions may include duplicates.
- Use HTTPS, restrict account and database permissions, and decide how long to retain responses and exported reports. Store exports where only authorized owners can read them. Configure backups for your deployment and document their retention, since deleting a live response does not erase existing exports or backups.
- The dashboard downloads response records in batches and builds reports in browser memory. This workflow suits modest surveys. Large collections will need server-side summaries and file generation.
