import { Inngest } from 'inngest';

// Create the Inngest client — used by both functions and event sending
export const inngest = new Inngest({
  id: 'agentic-factor',
  eventKey: process.env.INNGEST_EVENT_KEY,
});
