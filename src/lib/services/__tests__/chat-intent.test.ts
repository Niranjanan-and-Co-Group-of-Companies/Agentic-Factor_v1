import { describe, it, expect } from 'vitest';
import { asksForRecurring } from '../chat-intent';

// Real-style requests: each must be routed the right way by the safety net.
const RECURRING = [
  'Every Monday put my overdue Zoho invoices in a Google Sheet',
  'Send me a summary of my inbox every morning at 9',
  'Daily report of new leads to Slack',
  'Weekly GitHub activity summary to the team',
  'Whenever a new order comes in on Shopify, add it to Airtable',
  'Each time someone fills the contact form, email them a thank you',
  'Automate my invoice reminders',
  'Can you automatically post our blog to LinkedIn?',
  'Build me an agent that researches competitors',
  'Create a mission that tracks Indian SMB AI news',
  'Set up a workflow to file receipts in Drive',
  'Monitor my brand mentions on Twitter',
  'Keep me updated on new tenders from government sites',
  'Post a motivational quote on Instagram every day',
  'Every 2 hours check the server status page',
  'Remind the team on Fridays — actually every Friday — about timesheets',
  'Send the sales numbers monthly to my accountant',
  'Schedule it for 8 AM IST',
  'Chase unpaid invoices on Mondays',
  'Make a bot that answers WhatsApp FAQs',
];

const ONCE = [
  'Summarise my last 5 emails',
  'Put these 12 invoices in a new Google Sheet',
  'Email the team today\'s numbers',
  'What ran today?',
  'Check my credits',
  'Find the 10 biggest customers in HubSpot',
  'Draft a reply to the latest email from Ravi',
  'Create a Notion page with this meeting\'s notes',
  'Send every invoice in this sheet to me as a PDF',
  'Add a meeting with Priya to my calendar tomorrow at 3',
  'Just once, send the overdue list to Anil',
  'Do this one time only: post the launch tweet',
  'How much did we spend on ads last month?',
  'Show all missions',
  'Research the top 5 CRM tools for small businesses',
  'Make a sheet of today\'s orders',
  'Write a LinkedIn post about our new feature',
  'What is my plan?',
  'Translate this email to Hindi',
  'List my unpaid invoices from Zoho Books',
];

describe('the once-or-regularly safety net', () => {
  it.each(RECURRING)('treats "%s" as recurring', text => expect(asksForRecurring(text)).toBe(true));
  it.each(ONCE)('treats "%s" as one-time', text => expect(asksForRecurring(text)).toBe(false));
});
