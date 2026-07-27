-- ============================================================
-- Migration 026: Mission Templates
--
-- Stores pre-built mission blueprints that users can browse
-- in the template gallery and fork into their own missions.
--
-- Seeded with 12 templates covering the most common use cases:
--   Cold outreach, Lead enrichment, Social posting, CRM sync,
--   Support triage, Content generation, and more.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mission_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general',
  icon          TEXT NOT NULL DEFAULT '🤖',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  mission_json  JSONB NOT NULL,
  is_featured   BOOLEAN NOT NULL DEFAULT FALSE,
  use_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public read, no auth needed (templates are not tenant-scoped)
ALTER TABLE public.mission_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read templates" ON public.mission_templates;
CREATE POLICY "Anyone can read templates" ON public.mission_templates
  FOR SELECT USING (true);

-- Only service role can insert/update (seeding + admin use)
-- No customer write policy needed.

-- ── Seed templates ────────────────────────────────────────────

INSERT INTO public.mission_templates (slug, title, description, category, icon, tags, is_featured, mission_json) VALUES

('cold-email-outreach',
 'Cold Email Outreach Campaign',
 'Search Apollo.io for prospects matching your ICP, enrich each person, write a personalised email, send it, and track the contact. Runs daily on a schedule.',
 'outreach', '📧', ARRAY['apollo', 'email', 'outreach', 'sales'],
 TRUE,
 '{"agents":[{"name":"Prospect Hunter","role":"Find matching prospects on Apollo.io using the defined ICP criteria — job title, company size, industry, and location. Return up to 25 verified emails per run.","tools":["search_prospects","enrich_person","query_outreach_contacts"]},{"name":"Email Writer","role":"For each new prospect (not already contacted), write a highly personalised cold email referencing their specific company, role, and likely pain point. Use the Calendly booking link in the CTA.","tools":["create_booking_link"]},{"name":"Email Sender","role":"Send the personalised email to each prospect, then record them in the outreach tracker. Send a maximum of 50 emails per run.","tools":["send_email","track_outreach_contact","schedule_followup"]}]}'
),

('reply-handler',
 'Reply Detection & Classification',
 'Check your inbox for replies to cold emails, classify each as interested/not_interested/out_of_office/wrong_person, update the outreach tracker, and notify you on Slack.',
 'outreach', '📬', ARRAY['email', 'slack', 'outreach', 'classification'],
 TRUE,
 '{"agents":[{"name":"Reply Checker","role":"Check the email inbox for replies received in the last 24 hours. For each reply, classify it as interested, not_interested, out_of_office, wrong_person, or question.","tools":["check_email_replies","classify_reply"]},{"name":"CRM Updater","role":"Update the outreach contact status based on the classification. For interested contacts, create a HubSpot or Zoho lead. For unsubscribes, mark immediately.","tools":["update_outreach_status","hubspot_create_contact","zoho_create_lead"]},{"name":"Slack Reporter","role":"Post a daily summary to Slack: total replies, breakdown by classification, and a list of interested prospects with their emails.","tools":["slack_post_message"]}]}'
),

('followup-sender',
 'Automatic Follow-Up Sender',
 'Find contacts that had a follow-up scheduled and have not replied, then send the follow-up email and update the tracker.',
 'outreach', '🔄', ARRAY['email', 'outreach', 'follow-up'],
 FALSE,
 '{"agents":[{"name":"Follow-Up Finder","role":"Query the outreach tracker for contacts whose follow-up is due today or earlier and who have not replied yet.","tools":["get_followups_due","query_outreach_contacts"]},{"name":"Follow-Up Sender","role":"Send the scheduled follow-up email to each due contact and update their status and schedule the next follow-up if needed.","tools":["send_email","track_outreach_contact","schedule_followup"]}]}'
),

('lead-enrichment',
 'Lead Enrichment Pipeline',
 'Take a list of company domains or emails, enrich each with Apollo company and person data, and save results to HubSpot or Airtable.',
 'research', '🔍', ARRAY['apollo', 'hubspot', 'airtable', 'enrichment'],
 FALSE,
 '{"agents":[{"name":"Lead Enricher","role":"For each domain or email provided, enrich the company using Apollo and find the decision-maker contact. Return full profile including LinkedIn, title, company size.","tools":["enrich_company","enrich_person","search_prospects"]},{"name":"CRM Saver","role":"For each enriched lead, create or update the contact in HubSpot and save a record to the Airtable leads database.","tools":["hubspot_create_contact","airtable_create_record"]}]}'
),

('daily-slack-report',
 'Daily Business Summary to Slack',
 'Every morning, compile a summary of key metrics (emails sent, replies, new leads, tasks due) and post it to your Slack channel.',
 'reporting', '📊', ARRAY['slack', 'reporting', 'daily'],
 FALSE,
 '{"agents":[{"name":"Data Collector","role":"Gather metrics from the last 24 hours: outreach contacts sent, replies received, follow-ups due, and any other configured data sources.","tools":["query_outreach_contacts","get_followups_due"]},{"name":"Report Writer","role":"Write a clear, concise daily summary in markdown format covering what happened yesterday and what is due today.","tools":[]},{"name":"Slack Poster","role":"Post the formatted daily summary to the designated Slack channel.","tools":["slack_post_message"]}]}'
),

('github-issue-triage',
 'GitHub Issue Triage',
 'Monitor new GitHub issues, classify them by type (bug/feature/question), assign labels, and notify the relevant team member on Slack.',
 'devtools', '🐙', ARRAY['github', 'slack', 'triage'],
 FALSE,
 '{"agents":[{"name":"Issue Scanner","role":"Fetch all open GitHub issues created in the last 24 hours. Classify each as bug, feature request, or question based on the title and body.","tools":["github_list_prs"]},{"name":"Issue Responder","role":"For each new issue, add an appropriate label comment and assign it. For bugs, tag as high priority. For questions, post a helpful initial response.","tools":["github_add_comment","github_create_issue"]},{"name":"Team Notifier","role":"Post a summary of new issues to the engineering Slack channel, grouping by type and highlighting any critical bugs.","tools":["slack_post_message"]}]}'
),

('social-content-poster',
 'Social Media Content Pipeline',
 'Generate and post 3 pieces of content per week to X (Twitter) and LinkedIn, tailored to your audience and brand voice.',
 'marketing', '📱', ARRAY['twitter', 'marketing', 'content'],
 FALSE,
 '{"agents":[{"name":"Content Strategist","role":"Brainstorm 3 content ideas relevant to our target audience this week, based on industry trends found via web search.","tools":["web_search"]},{"name":"Content Writer","role":"Write the full post for each content idea — concise, engaging, with a clear hook. Keep Twitter posts under 280 characters.","tools":[]},{"name":"Content Poster","role":"Post each piece of content to the configured social media platforms with appropriate hashtags.","tools":["twitter_post_tweet"]}]}'
),

('stripe-churn-monitor',
 'Stripe Churn Monitor',
 'Check for subscriptions that cancelled or failed in the last 7 days, enrich the customer info, and send a personalised win-back email.',
 'payments', '💳', ARRAY['stripe', 'email', 'churn'],
 FALSE,
 '{"agents":[{"name":"Churn Detector","role":"Query Stripe for subscriptions that were cancelled or had failed payments in the last 7 days. Collect the customer email and plan details.","tools":["stripe_list_subscriptions","stripe_search_customers"]},{"name":"Win-Back Emailer","role":"For each churned customer, write a personalised win-back email acknowledging their cancellation and offering a discount or addressing their likely reason for leaving.","tools":["send_email","track_outreach_contact"]}]}'
),

('support-ticket-responder',
 'Support Ticket Auto-Responder',
 'Read incoming support emails, classify urgency, generate a helpful first response, and create a GitHub issue for bugs.',
 'support', '🎧', ARRAY['email', 'github', 'support'],
 FALSE,
 '{"agents":[{"name":"Ticket Reader","role":"Check the support inbox for new emails in the last hour. Classify each as: bug report, billing question, feature request, or general question.","tools":["read_email"]},{"name":"Responder","role":"For each ticket, draft and send a helpful, empathetic first response. For bugs, also create a GitHub issue with the details.","tools":["send_email","github_create_issue"]}]}'
),

('notion-knowledge-sync',
 'Knowledge Base Sync to Notion',
 'Compile research or web search results and save them as structured Notion pages in a specified database.',
 'productivity', '📝', ARRAY['notion', 'research', 'knowledge'],
 FALSE,
 '{"agents":[{"name":"Researcher","role":"Search the web for the latest information on the specified topic. Collect key facts, sources, and insights.","tools":["web_search"]},{"name":"Notion Writer","role":"Create a structured Notion page with the research findings, organised with headings, bullet points, and source links.","tools":["notion_create_page","notion_append_blocks"]}]}'
),

('crm-data-cleaner',
 'CRM Data Cleaner',
 'Find HubSpot contacts with missing data fields, enrich them using Apollo, and update the records automatically.',
 'crm', '🧹', ARRAY['hubspot', 'apollo', 'crm', 'data'],
 FALSE,
 '{"agents":[{"name":"Gap Finder","role":"Search HubSpot for contacts missing company, title, or phone number. Return up to 50 records to enrich.","tools":["hubspot_get_contact"]},{"name":"Data Enricher","role":"For each incomplete contact, use Apollo to find the missing information using their email or LinkedIn URL.","tools":["enrich_person","enrich_company"]},{"name":"CRM Updater","role":"Update each HubSpot contact with the enriched data fields.","tools":["hubspot_update_contact"]}]}'
),

('airtable-report-builder',
 'Airtable Report Builder',
 'Query your Airtable base for this week''s data, analyse it, and post a summary to Slack.',
 'reporting', '📋', ARRAY['airtable', 'slack', 'reporting'],
 FALSE,
 '{"agents":[{"name":"Data Fetcher","role":"Query the configured Airtable base and table for records created or updated this week. Summarise the key metrics.","tools":["airtable_list_records"]},{"name":"Reporter","role":"Analyse the data and write a concise weekly summary highlighting trends, top performers, and action items.","tools":[]},{"name":"Notifier","role":"Post the formatted report to Slack.","tools":["slack_post_message"]}]}'
)

ON CONFLICT (slug) DO NOTHING;
