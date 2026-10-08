/**
 * When the Mission Architect needs one answer before it can design a mission,
 * the question is appended to the Command Center message that started the
 * build. Keeping it in the message text (not only in a card) means the chat
 * history sent back to Command Center contains it, so the user's reply is
 * understood as the answer.
 */
export const ARCHITECT_QUESTION_HEADING = '**Before I build this — one question from the Mission Architect:**';

/** Architect questions already asked in a Command Center conversation, oldest first. */
export function architectQuestionsIn(messages: Array<{ role: string; content: string }>): string[] {
  return messages
    .filter(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes(ARCHITECT_QUESTION_HEADING))
    .map(m => m.content.slice(m.content.indexOf(ARCHITECT_QUESTION_HEADING) + ARCHITECT_QUESTION_HEADING.length).trim())
    .filter(Boolean);
}

export function withArchitectQuestion(content: string, question: string): string {
  if (content.includes(ARCHITECT_QUESTION_HEADING)) return content;
  return `${content.trim()}\n\n${ARCHITECT_QUESTION_HEADING}\n${question.trim()}`.trim();
}
