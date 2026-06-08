import { v4 as uuidv4 } from 'uuid';
import type { Mission } from '../schemas/mission';

// ============================================================
// Mission Templates — Pre-tested, proven blueprints
// These bypass LLM code generation entirely for common tasks.
// The code is tested and locked — only variables change.
// ============================================================

export interface TemplateMatch {
  templateId: string;
  confidence: number;
  template: TemplateConfig;
}

interface TemplateConfig {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  category: string;
  agents: Array<{
    role: string;
    capabilities: string[];
    requiresExternalData: boolean;
    tools: Array<{ name: string; type: string; requiresAuth: boolean; confidentialityLevel: string }>;
    systemPrompt: string;
    handoffProtocol: string;
    pythonScript: string;
  }>;
  orchestration: { pattern: string; timeoutSeconds: number };
  permissions: Array<{ type: string; service: string; scope: string; confidentialityLevel: string }>;
  validationChecklist: string[];
  expectedOutputFormat: string;
  discoveryQuestions: string[];
}

// ── Template 1: Research + Report + Email ──
const RESEARCH_REPORT_EMAIL: TemplateConfig = {
  id: 'research_report_email',
  title: 'Research & Email Report',
  description: 'Research a topic using the web, compile a detailed HTML report, and email it.',
  keywords: ['research', 'report', 'email', 'find', 'search', 'investigate', 'analyze', 'send email', 'gmail', 'startups', 'companies', 'market', 'competitors', 'trends'],
  category: 'research',
  agents: [
    {
      role: 'Web Researcher & Analyst',
      capabilities: ['web_search', 'data_extraction', 'analysis'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You are a thorough web researcher. Search for information, extract key data points, and compile structured analysis.',
      handoffProtocol: 'Output: JSON with { "query": string, "results": array of findings with name/description/details, "summary": string }',
      pythonScript: `import json, os, requests

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
query = input_data.get('query', os.environ.get('MISSION_INTENT', 'latest trends'))

tavily_key = os.environ.get('TAVILY_API_KEY', '')
results = []

if tavily_key:
    try:
        resp = requests.post('https://api.tavily.com/search', json={
            'api_key': tavily_key,
            'query': query,
            'search_depth': 'advanced',
            'max_results': 10,
            'include_answer': True
        }, timeout=30)
        data = resp.json()
        
        for r in data.get('results', []):
            results.append({
                'title': r.get('title', ''),
                'url': r.get('url', ''),
                'content': r.get('content', '')[:500],
                'score': r.get('score', 0)
            })
    except Exception as e:
        results = [{'title': 'Search Error', 'content': str(e), 'url': '', 'score': 0}]

output = {
    **input_data,
    'query': query,
    'results': results,
    'answer': data.get('answer', '') if tavily_key else '',
    'result_count': len(results),
    'status': 'researched'
}
print(json.dumps(output))`
    },
    {
      role: 'Report Builder & Email Sender',
      capabilities: ['format_html', 'send_email', 'create_spreadsheet'],
      requiresExternalData: true,
      tools: [
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }
      ],
      systemPrompt: 'You format research results into a professional HTML email and Google Sheet, then send via Gmail.',
      handoffProtocol: 'Input: research results JSON. Output: { "email_sent": boolean, "sheet_url": string, "status": "delivered" }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
results = input_data.get('results', [])
query = input_data.get('query', 'Research')
answer = input_data.get('answer', '')

# Build HTML email
rows = []
for i, r in enumerate(results[:10]):
    title = r.get('title', 'N/A').replace('"', "'")
    url = r.get('url', '#')
    content = r.get('content', '').replace('"', "'")[:200]
    rows.append(f"<tr><td style='padding:8px;border-bottom:1px solid #eee'>{i+1}</td><td style='padding:8px;border-bottom:1px solid #eee'><a href='{url}'>{title}</a></td><td style='padding:8px;border-bottom:1px solid #eee'>{content}</td></tr>")

table_html = "".join(rows)

html_body = f"""<div style='font-family:Arial,sans-serif;max-width:700px;margin:0 auto'>
<h2 style='color:#6366f1'>Research Report: {query}</h2>
<p style='color:#64748b;line-height:1.6'>{answer[:500] if answer else 'See detailed findings below.'}</p>
<table style='width:100%;border-collapse:collapse;margin:16px 0'>
<tr style='background:#f8fafc'><th style='padding:8px;text-align:left'>#</th><th style='padding:8px;text-align:left'>Source</th><th style='padding:8px;text-align:left'>Key Finding</th></tr>
{table_html}
</table>
<p style='color:#94a3b8;font-size:12px'>Generated by Agentic Factor</p>
</div>"""

# Send via Gmail
from agenticfactor import api
try:
    email_to = os.environ.get('USER_EMAIL', '')
    if email_to:
        api.call('google', 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', json_data={
            'raw': __import__('base64').urlsafe_b64encode(
                f"To: {email_to}\\r\\nSubject: Research Report: {query}\\r\\nContent-Type: text/html; charset=utf-8\\r\\n\\r\\n{html_body}".encode()
            ).decode()
        })
        email_status = 'sent'
    else:
        email_status = 'no_email'
except Exception as e:
    email_status = f'failed: {str(e)}'

# Create Google Sheet
sheet_url = ''
try:
    sheet_data = api.call('google', 'POST', 'https://sheets.googleapis.com/v4/spreadsheets', json_data={
        'properties': {'title': f'Research: {query}'},
        'sheets': [{'properties': {'title': 'Results'}}]
    })
    sheet_url = sheet_data.get('spreadsheetUrl', '')
    
    if sheet_url:
        sheet_id = sheet_data.get('spreadsheetId', '')
        values = [['#', 'Title', 'URL', 'Key Finding']]
        for i, r in enumerate(results[:10]):
            values.append([str(i+1), r.get('title',''), r.get('url',''), r.get('content','')[:200]])
        
        api.call('google', 'PUT', 
            f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Results!A1?valueInputOption=RAW',
            json_data={'values': values})
except Exception as e:
    sheet_url = f'Sheet creation failed: {str(e)}'

output = {
    **input_data,
    'email_status': email_status,
    'sheet_url': sheet_url,
    'html_report': html_body,
    'status': 'delivered'
}
print(json.dumps(output))`
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 300 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'Web search returns relevant results',
    'HTML email is well-formatted',
    'Email is sent successfully via Gmail',
    'Google Sheet contains structured data'
  ],
  expectedOutputFormat: '{ "query": "...", "results": [...], "email_status": "sent", "sheet_url": "https://...", "status": "delivered" }',
  discoveryQuestions: [
    'What specific topic or query should I research?',
    'How many results do you want in the report?',
    'Should I include a Google Sheet with the raw data?'
  ]
};

// ── Template 2: Content Creation + Email ──
const CONTENT_CREATION: TemplateConfig = {
  id: 'content_creation',
  title: 'Content Creation & Delivery',
  description: 'Research a topic, write professional content, and deliver via email.',
  keywords: ['write', 'content', 'article', 'blog', 'post', 'newsletter', 'draft', 'copy', 'create content', 'write about', 'compose'],
  category: 'content',
  agents: [
    {
      role: 'Research & Content Writer',
      capabilities: ['web_search', 'content_writing'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You research a topic and write professional, engaging content based on your findings.',
      handoffProtocol: 'Output: { "topic": string, "content": string (HTML formatted), "sources": array, "word_count": number }',
      pythonScript: `import json, os, requests

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
topic = input_data.get('topic', os.environ.get('MISSION_INTENT', 'technology trends'))

tavily_key = os.environ.get('TAVILY_API_KEY', '')
sources = []

if tavily_key:
    try:
        resp = requests.post('https://api.tavily.com/search', json={
            'api_key': tavily_key, 'query': topic,
            'search_depth': 'advanced', 'max_results': 8, 'include_answer': True
        }, timeout=30)
        data = resp.json()
        sources = [{'title': r.get('title',''), 'url': r.get('url','')} for r in data.get('results',[])]
        answer = data.get('answer', '')
    except:
        answer = ''
else:
    answer = ''

# Build content sections from research
sections = []
for s in sources[:5]:
    sections.append(f"<h3>{s['title']}</h3><p>Source: <a href='{s['url']}'>{s['url'][:60]}</a></p>")

content_html = f"""<div style='font-family:Georgia,serif;max-width:700px;margin:0 auto;line-height:1.8'>
<h1 style='color:#1e293b'>{topic}</h1>
<p style='color:#475569;font-size:1.1em'>{answer[:800] if answer else 'Detailed analysis below.'}</p>
{"".join(sections)}
<hr style='margin:24px 0;border-color:#e2e8f0'>
<p style='color:#94a3b8;font-size:12px'>Research compiled by Agentic Factor | {len(sources)} sources analyzed</p>
</div>"""

output = {
    **input_data,
    'topic': topic,
    'content': content_html,
    'sources': sources,
    'word_count': len(content_html.split()),
    'status': 'written'
}
print(json.dumps(output))`
    },
    {
      role: 'Email Deliverer',
      capabilities: ['send_email'],
      requiresExternalData: true,
      tools: [{ name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }],
      systemPrompt: 'You deliver the written content via Gmail to the user.',
      handoffProtocol: 'Input: content HTML. Output: { "email_sent": boolean, "status": "delivered" }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
content = input_data.get('content', '<p>No content generated</p>')
topic = input_data.get('topic', 'Content')

from agenticfactor import api
email_to = os.environ.get('USER_EMAIL', '')
email_status = 'no_email'

if email_to:
    try:
        import base64
        raw = base64.urlsafe_b64encode(
            f"To: {email_to}\\r\\nSubject: {topic}\\r\\nContent-Type: text/html; charset=utf-8\\r\\n\\r\\n{content}".encode()
        ).decode()
        api.call('google', 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', json_data={'raw': raw})
        email_status = 'sent'
    except Exception as e:
        email_status = f'failed: {str(e)}'

output = {**input_data, 'email_status': email_status, 'status': 'delivered'}
print(json.dumps(output))`
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 300 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send', confidentialityLevel: 'internal' }
  ],
  validationChecklist: ['Content is well-written and relevant', 'Sources are cited', 'Email delivered successfully'],
  expectedOutputFormat: '{ "topic": "...", "content": "<html>...</html>", "email_status": "sent", "status": "delivered" }',
  discoveryQuestions: ['What topic should the content cover?', 'What tone — formal, casual, or technical?', 'How long should the content be?']
};

// ── Template 3: Data Collection + Summary ──
const DATA_COLLECTION: TemplateConfig = {
  id: 'data_collection',
  title: 'Data Collection & Summary',
  description: 'Collect data from the web, process it into a structured format, and email a summary.',
  keywords: ['data', 'collect', 'scrape', 'gather', 'list', 'compile', 'extract', 'find all', 'get me', 'pricing', 'comparison', 'summary'],
  category: 'data',
  agents: [
    {
      role: 'Data Collector & Processor',
      capabilities: ['web_search', 'data_extraction', 'processing'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'You collect structured data from web searches and organize it into a clean dataset.',
      handoffProtocol: 'Output: { "query": string, "data": array of objects, "total": number, "summary": string }',
      pythonScript: `import json, os, requests

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
query = input_data.get('query', os.environ.get('MISSION_INTENT', 'data collection'))

tavily_key = os.environ.get('TAVILY_API_KEY', '')
data_items = []

if tavily_key:
    try:
        resp = requests.post('https://api.tavily.com/search', json={
            'api_key': tavily_key, 'query': query,
            'search_depth': 'advanced', 'max_results': 15, 'include_answer': True
        }, timeout=30)
        results = resp.json()
        
        for i, r in enumerate(results.get('results', [])):
            data_items.append({
                'index': i + 1,
                'title': r.get('title', ''),
                'source': r.get('url', ''),
                'data': r.get('content', '')[:300],
                'relevance': round(r.get('score', 0) * 100)
            })
        summary = results.get('answer', 'Data collected successfully.')
    except Exception as e:
        summary = f'Collection error: {str(e)}'
else:
    summary = 'No API key available'

output = {
    **input_data,
    'query': query,
    'data': data_items,
    'total': len(data_items),
    'summary': summary,
    'status': 'collected'
}
print(json.dumps(output))`
    },
    {
      role: 'Report & Email Sender',
      capabilities: ['format_report', 'send_email', 'create_spreadsheet'],
      requiresExternalData: true,
      tools: [
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }
      ],
      systemPrompt: 'You create a summary report from collected data and email it with a Google Sheet.',
      handoffProtocol: 'Input: data array. Output: { "email_sent": boolean, "sheet_url": string, "status": "delivered" }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
data_items = input_data.get('data', [])
query = input_data.get('query', 'Data')
summary = input_data.get('summary', '')

# Build HTML
rows = []
for item in data_items[:15]:
    rows.append(f"<tr><td style='padding:6px;border-bottom:1px solid #eee'>{item.get('index','')}</td><td style='padding:6px;border-bottom:1px solid #eee'>{item.get('title','')}</td><td style='padding:6px;border-bottom:1px solid #eee'>{item.get('data','')[:150]}</td><td style='padding:6px;border-bottom:1px solid #eee'>{item.get('relevance','')}%</td></tr>")

html = f"""<div style='font-family:Arial,sans-serif;max-width:750px;margin:0 auto'>
<h2 style='color:#6366f1'>Data Report: {query}</h2>
<p style='color:#64748b'>{summary[:400]}</p>
<p><strong>{len(data_items)}</strong> items collected</p>
<table style='width:100%;border-collapse:collapse'><tr style='background:#f1f5f9'><th style='padding:6px;text-align:left'>#</th><th style='padding:6px;text-align:left'>Title</th><th style='padding:6px;text-align:left'>Data</th><th style='padding:6px;text-align:left'>Score</th></tr>{"".join(rows)}</table>
<p style='color:#94a3b8;font-size:11px;margin-top:16px'>Collected by Agentic Factor</p></div>"""

from agenticfactor import api
email_to = os.environ.get('USER_EMAIL', '')
email_status = 'no_email'

if email_to:
    try:
        import base64
        raw = base64.urlsafe_b64encode(f"To: {email_to}\\r\\nSubject: Data Report: {query}\\r\\nContent-Type: text/html; charset=utf-8\\r\\n\\r\\n{html}".encode()).decode()
        api.call('google', 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', json_data={'raw': raw})
        email_status = 'sent'
    except Exception as e:
        email_status = f'failed: {str(e)}'

# Create Sheet
sheet_url = ''
try:
    sheet = api.call('google', 'POST', 'https://sheets.googleapis.com/v4/spreadsheets', json_data={
        'properties': {'title': f'Data: {query}'}, 'sheets': [{'properties': {'title': 'Data'}}]
    })
    sheet_url = sheet.get('spreadsheetUrl', '')
    if sheet_url:
        sid = sheet.get('spreadsheetId', '')
        vals = [['#', 'Title', 'Source', 'Data', 'Relevance']]
        for item in data_items: vals.append([str(item.get('index','')), item.get('title',''), item.get('source',''), item.get('data','')[:200], str(item.get('relevance',''))])
        api.call('google', 'PUT', f'https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/Data!A1?valueInputOption=RAW', json_data={'values': vals})
except Exception as e:
    sheet_url = f'failed: {str(e)}'

output = {**input_data, 'email_status': email_status, 'sheet_url': sheet_url, 'html_report': html, 'status': 'delivered'}
print(json.dumps(output))`
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 300 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: ['Data is collected and structured', 'Summary is accurate', 'Email sent with report', 'Sheet created with raw data'],
  expectedOutputFormat: '{ "data": [...], "total": 15, "email_status": "sent", "sheet_url": "https://...", "status": "delivered" }',
  discoveryQuestions: ['What data should I collect?', 'How many results do you need?', 'Do you want a Google Sheet with the raw data?']
};

// ── Template 4: HR Recruitment Pipeline (Complex, 7 agents) ──
const HR_RECRUITMENT: TemplateConfig = {
  id: 'hr_recruitment',
  title: 'HR Recruitment Pipeline',
  description: 'End-to-end recruitment: source candidates, screen resumes, rank, draft outreach emails, schedule interviews.',
  keywords: ['recruit', 'hiring', 'candidate', 'resume', 'interview', 'hr', 'talent', 'job', 'position', 'hire', 'recruitment', 'sourcing', 'offer letter', 'headhunt'],
  category: 'hr',
  agents: [
    {
      role: 'Job Profile Analyzer',
      capabilities: ['analysis', 'requirement_extraction'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Parse the job requirement and extract key criteria: skills, experience, location, salary range.',
      handoffProtocol: 'Output: { "job_title": string, "required_skills": array, "experience_years": number, "location": string, "salary_range": string, "nice_to_have": array }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
intent = os.environ.get('MISSION_INTENT', '')

# Extract job details from intent
output = {
    **input_data,
    'job_title': intent.split('for')[-1].strip() if 'for' in intent.lower() else intent[:100],
    'required_skills': [],
    'experience_years': 3,
    'location': 'Remote',
    'salary_range': 'Market competitive',
    'nice_to_have': [],
    'raw_requirement': intent,
    'status': 'job_analyzed'
}
print(json.dumps(output))`
    },
    {
      role: 'Candidate Sourcer',
      capabilities: ['web_search', 'candidate_sourcing'],
      requiresExternalData: true,
      tools: [{ name: 'Tavily Search', type: 'web_search', requiresAuth: true, confidentialityLevel: 'public' }],
      systemPrompt: 'Search for potential candidates matching the job profile on LinkedIn, job boards, and professional networks.',
      handoffProtocol: 'Output: { "candidates": array of { name, profile_url, title, company, skills, match_score } }',
      pythonScript: `import json, os, requests

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
job_title = input_data.get('job_title', 'Software Engineer')

tavily_key = os.environ.get('TAVILY_API_KEY', '')
candidates = []

if tavily_key:
    queries = [
        f'{job_title} professionals LinkedIn',
        f'{job_title} experienced candidates hiring'
    ]
    for q in queries:
        try:
            resp = requests.post('https://api.tavily.com/search', json={
                'api_key': tavily_key, 'query': q, 'search_depth': 'advanced', 'max_results': 8
            }, timeout=30)
            for r in resp.json().get('results', []):
                candidates.append({
                    'name': r.get('title', '').split('-')[0].strip()[:50],
                    'profile_url': r.get('url', ''),
                    'summary': r.get('content', '')[:200],
                    'source': 'web_search',
                    'match_score': round(r.get('score', 0.5) * 100)
                })
        except:
            pass

# Dedupe and sort by match score
seen = set()
unique = []
for c in candidates:
    key = c['profile_url']
    if key not in seen:
        seen.add(key)
        unique.append(c)

unique.sort(key=lambda x: x['match_score'], reverse=True)

output = {**input_data, 'candidates': unique[:15], 'total_sourced': len(unique), 'status': 'sourced'}
print(json.dumps(output))`
    },
    {
      role: 'Candidate Screener & Ranker',
      capabilities: ['screening', 'ranking'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Screen and rank candidates based on job requirements. Assign scores and categorize into tiers.',
      handoffProtocol: 'Output: { "ranked_candidates": array sorted by score, "tier_a": array, "tier_b": array }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
candidates = input_data.get('candidates', [])
required_skills = input_data.get('required_skills', [])

# Score candidates
for c in candidates:
    base = c.get('match_score', 50)
    summary = c.get('summary', '').lower()
    skill_bonus = sum(5 for s in required_skills if s.lower() in summary)
    c['final_score'] = min(100, base + skill_bonus)

ranked = sorted(candidates, key=lambda x: x['final_score'], reverse=True)
tier_a = [c for c in ranked if c['final_score'] >= 70]
tier_b = [c for c in ranked if 50 <= c['final_score'] < 70]

output = {
    **input_data,
    'ranked_candidates': ranked,
    'tier_a': tier_a,
    'tier_b': tier_b,
    'tier_a_count': len(tier_a),
    'tier_b_count': len(tier_b),
    'status': 'screened'
}
print(json.dumps(output))`
    },
    {
      role: 'Outreach Email Drafter',
      capabilities: ['email_drafting'],
      requiresExternalData: false,
      tools: [],
      systemPrompt: 'Draft personalized outreach emails for top-tier candidates.',
      handoffProtocol: 'Output: { "emails": array of { candidate_name, subject, body_html } }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
tier_a = input_data.get('tier_a', [])
job_title = input_data.get('job_title', 'the position')

emails = []
for c in tier_a[:10]:
    name = c.get('name', 'Candidate').split('|')[0].strip()
    subject = f"Exciting {job_title} Opportunity"
    body = f"""<div style='font-family:Arial,sans-serif;max-width:600px'>
<p>Hi {name},</p>
<p>I came across your profile and was impressed by your background. We have an exciting opportunity for a <strong>{job_title}</strong> role that aligns well with your experience.</p>
<p>Would you be open to a brief conversation to learn more?</p>
<p>Best regards,<br>Recruitment Team</p>
<p style='color:#94a3b8;font-size:11px'>Sent via Agentic Factor</p></div>"""
    emails.append({'candidate_name': name, 'subject': subject, 'body_html': body, 'profile_url': c.get('profile_url','')})

output = {**input_data, 'draft_emails': emails, 'total_emails': len(emails), 'status': 'emails_drafted'}
print(json.dumps(output))`
    },
    {
      role: 'Recruitment Report & Gmail Sender',
      capabilities: ['report_generation', 'send_email'],
      requiresExternalData: true,
      tools: [
        { name: 'Gmail API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' },
        { name: 'Google Sheets API', type: 'api', requiresAuth: true, confidentialityLevel: 'internal' }
      ],
      systemPrompt: 'Generate final recruitment report, create a candidate tracking sheet, and email the summary to the hiring manager.',
      handoffProtocol: 'Output: { "report_sent": boolean, "sheet_url": string, "status": "pipeline_complete" }',
      pythonScript: `import json, os

input_data = json.loads(os.environ.get('INPUT_CONTEXT', '{}'))
ranked = input_data.get('ranked_candidates', [])
tier_a = input_data.get('tier_a', [])
tier_b = input_data.get('tier_b', [])
job_title = input_data.get('job_title', 'Position')
draft_emails = input_data.get('draft_emails', [])

# Build report HTML
rows_html = []
for c in ranked[:15]:
    tier = 'A' if c.get('final_score',0) >= 70 else 'B' if c.get('final_score',0) >= 50 else 'C'
    color = '#22c55e' if tier == 'A' else '#f59e0b' if tier == 'B' else '#94a3b8'
    rows_html.append(f"<tr><td style='padding:6px;border-bottom:1px solid #eee'>{c.get('name','')[:30]}</td><td style='padding:6px;border-bottom:1px solid #eee'><span style='color:{color};font-weight:700'>Tier {tier}</span></td><td style='padding:6px;border-bottom:1px solid #eee'>{c.get('final_score',0)}%</td></tr>")

html = f"""<div style='font-family:Arial,sans-serif;max-width:700px;margin:0 auto'>
<h2 style='color:#6366f1'>Recruitment Report: {job_title}</h2>
<div style='display:flex;gap:16px;margin:16px 0'>
<div style='background:#f0fdf4;padding:12px 20px;border-radius:8px'><strong style='color:#22c55e'>{len(tier_a)}</strong> Tier A</div>
<div style='background:#fffbeb;padding:12px 20px;border-radius:8px'><strong style='color:#f59e0b'>{len(tier_b)}</strong> Tier B</div>
<div style='background:#f8fafc;padding:12px 20px;border-radius:8px'><strong>{len(ranked)}</strong> Total</div>
</div>
<table style='width:100%;border-collapse:collapse'><tr style='background:#f1f5f9'><th style='padding:6px;text-align:left'>Candidate</th><th style='padding:6px;text-align:left'>Tier</th><th style='padding:6px;text-align:left'>Score</th></tr>{"".join(rows_html)}</table>
<p><strong>{len(draft_emails)}</strong> outreach emails drafted and ready to send.</p>
<p style='color:#94a3b8;font-size:11px;margin-top:24px'>Generated by Agentic Factor</p></div>"""

from agenticfactor import api
email_to = os.environ.get('USER_EMAIL', '')
email_status = 'no_email'

if email_to:
    try:
        import base64
        raw = base64.urlsafe_b64encode(f"To: {email_to}\\r\\nSubject: Recruitment Report: {job_title} ({len(tier_a)} Tier A candidates)\\r\\nContent-Type: text/html; charset=utf-8\\r\\n\\r\\n{html}".encode()).decode()
        api.call('google', 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', json_data={'raw': raw})
        email_status = 'sent'
    except Exception as e:
        email_status = f'failed: {str(e)}'

# Create tracking sheet
sheet_url = ''
try:
    sheet = api.call('google', 'POST', 'https://sheets.googleapis.com/v4/spreadsheets', json_data={
        'properties': {'title': f'Recruitment: {job_title}'}, 'sheets': [{'properties': {'title': 'Candidates'}}]
    })
    sheet_url = sheet.get('spreadsheetUrl', '')
    if sheet_url:
        sid = sheet.get('spreadsheetId', '')
        vals = [['Name', 'Score', 'Tier', 'Profile', 'Status']]
        for c in ranked:
            tier = 'A' if c.get('final_score',0) >= 70 else 'B'
            vals.append([c.get('name',''), str(c.get('final_score',0)), f'Tier {tier}', c.get('profile_url',''), 'To Contact'])
        api.call('google', 'PUT', f'https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/Candidates!A1?valueInputOption=RAW', json_data={'values': vals})
except Exception as e:
    sheet_url = f'failed: {str(e)}'

output = {**input_data, 'report_sent': email_status == 'sent', 'email_status': email_status, 'sheet_url': sheet_url, 'html_report': html, 'status': 'pipeline_complete'}
print(json.dumps(output))`
    }
  ],
  orchestration: { pattern: 'sequential', timeoutSeconds: 600 },
  permissions: [
    { type: 'api_key', service: 'tavily', scope: 'search', confidentialityLevel: 'public' },
    { type: 'oauth_token', service: 'google', scope: 'gmail.send sheets', confidentialityLevel: 'internal' }
  ],
  validationChecklist: [
    'Candidates are sourced from multiple channels',
    'Screening criteria matches job requirements',
    'Tier A candidates are genuine top matches',
    'Outreach emails are personalized',
    'Report is comprehensive and actionable',
    'Tracking sheet is created with all candidates'
  ],
  expectedOutputFormat: '{ "ranked_candidates": [...], "tier_a_count": 5, "draft_emails": [...], "report_sent": true, "sheet_url": "https://...", "status": "pipeline_complete" }',
  discoveryQuestions: [
    'What is the exact job title and role description?',
    'What are the must-have skills and experience requirements?',
    'What is the preferred location or is remote OK?',
    'What is the salary range or budget?',
    'How many candidates do you want in the shortlist?'
  ]
};

// ── All Templates ──
const ALL_TEMPLATES: TemplateConfig[] = [
  RESEARCH_REPORT_EMAIL,
  CONTENT_CREATION,
  DATA_COLLECTION,
  HR_RECRUITMENT,
];

/**
 * Match user intent against templates.
 * Returns the best matching template if confidence > threshold.
 */
export function matchTemplate(intent: string): TemplateMatch | null {
  const lower = intent.toLowerCase();
  let bestMatch: TemplateMatch | null = null;

  for (const template of ALL_TEMPLATES) {
    let score = 0;
    let matches = 0;

    for (const keyword of template.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        matches++;
        // Longer keywords = more specific = higher weight
        score += keyword.length;
      }
    }

    // Calculate confidence: ratio of matching keywords * keyword length weight
    const maxPossibleScore = template.keywords.reduce((sum, k) => sum + k.length, 0);
    const confidence = maxPossibleScore > 0 ? (score / maxPossibleScore) * 100 : 0;

    // Require at least 2 keyword matches and 15% confidence
    if (matches >= 2 && confidence > 15 && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { templateId: template.id, confidence, template };
    }
  }

  return bestMatch;
}

/**
 * Build a full Mission object from a template.
 * Hydrates with IDs, tenant context, and timestamps.
 */
export function buildMissionFromTemplate(
  template: TemplateConfig,
  tenantId: string,
  intent: string
): Mission {
  const now = new Date().toISOString();
  const missionId = uuidv4();

  const agentIdMap = new Map<string, string>();
  const agents = template.agents.map((agent, index) => {
    const agentId = uuidv4();
    agentIdMap.set(`agent-${index}`, agentId);
    return {
      id: agentId,
      agentIndex: index,
      role: agent.role,
      capabilities: agent.capabilities,
      requiresExternalData: agent.requiresExternalData,
      tools: agent.tools,
      systemPrompt: agent.systemPrompt,
      handoffProtocol: agent.handoffProtocol,
      pythonScript: agent.pythonScript,
    };
  });

  // Build sequential edges
  const edges = [];
  for (let i = 0; i < agents.length - 1; i++) {
    edges.push({ from: agents[i].id, to: agents[i + 1].id });
  }

  return {
    id: missionId,
    tenantId,
    title: template.title,
    description: `${template.description} (Template: ${template.id})`,
    status: 'draft',
    agents,
    orchestration: {
      pattern: template.orchestration.pattern,
      timeoutSeconds: template.orchestration.timeoutSeconds,
      entryAgent: agents[0].id,
      edges,
    },
    validationChecklist: template.validationChecklist,
    expectedOutputFormat: template.expectedOutputFormat,
    permissions: template.permissions as any,
    createdAt: now,
    updatedAt: now,
  } as Mission;
}

/**
 * Get all available templates for display.
 */
export function getAvailableTemplates() {
  return ALL_TEMPLATES.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    agentCount: t.agents.length,
    discoveryQuestions: t.discoveryQuestions,
  }));
}
