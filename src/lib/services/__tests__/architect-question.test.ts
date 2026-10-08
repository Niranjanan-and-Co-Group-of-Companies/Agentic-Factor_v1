import { describe, it, expect } from 'vitest';
import { architectQuestionsIn, withArchitectQuestion } from '@/lib/utils/architect-question';

describe('architect questions in a Command Center conversation', () => {
  it('collects every question the architect asked, oldest first', () => {
    const messages = [
      { role: 'user', content: 'Make a Notion page' },
      { role: 'assistant', content: withArchitectQuestion('Building it now.', 'Which parent page?') },
      { role: 'user', content: 'Any page' },
      { role: 'assistant', content: withArchitectQuestion('Perfect.', 'What is its exact title?') },
    ];
    expect(architectQuestionsIn(messages)).toEqual(['Which parent page?', 'What is its exact title?']);
  });

  it('ignores ordinary replies and user text quoting the heading', () => {
    expect(architectQuestionsIn([{ role: 'assistant', content: 'Done!' }])).toEqual([]);
    expect(architectQuestionsIn([{ role: 'user', content: withArchitectQuestion('x', 'y') }])).toEqual([]);
  });

  it('does not append the question twice', () => {
    const once = withArchitectQuestion('Hi', 'Q?');
    expect(withArchitectQuestion(once, 'Q?')).toBe(once);
  });
});
