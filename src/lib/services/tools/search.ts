import { ToolExecutionContext, registerTool } from './index';

async function webSearchTool({ args }: ToolExecutionContext) {
  const query = args.query as string;
  const maxResults = (args.maxResults as number) || 5;
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return { error: 'TAVILY_API_KEY is not configured.' };
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_raw_content: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { error: `Tavily API returned ${res.status}: ${err}` };
    }

    const data = await res.json();
    return data.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }));
  } catch (err) {
    return { error: `Web search failed: ${(err as Error).message}` };
  }
}

registerTool('web_search', webSearchTool);
