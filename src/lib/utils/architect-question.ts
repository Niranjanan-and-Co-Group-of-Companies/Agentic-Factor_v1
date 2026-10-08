/**
 * When the Mission Architect needs one answer before it can design a mission,
 * the question is appended to the Command Center message that started the
 * build. Keeping it in the message text (not only in a card) means the chat
 * history sent back to Command Center contains it, so the user's reply is
 * understood as the answer.
 */
export const ARCHITECT_QUESTION_HEADING = '**Before I build this — one question from the Mission Architect:**';

export function withArchitectQuestion(content: string, question: string): string {
  if (content.includes(ARCHITECT_QUESTION_HEADING)) return content;
  return `${content.trim()}\n\n${ARCHITECT_QUESTION_HEADING}\n${question.trim()}`.trim();
}
