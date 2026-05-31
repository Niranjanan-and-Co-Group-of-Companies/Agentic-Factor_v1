// ============================================================
// AgenticFactor SDK — Embedded Python modules
// These are embedded as strings so they work on Vercel (which
// doesn't deploy .py files from src/).
// Generated from src/lib/sandbox/agenticfactor/*.py
// ============================================================

// We use dynamic filesystem reads with a fallback to raw strings.
// On local dev: reads .py files from disk.
// On Vercel: uses the embedded strings below.

import * as path from 'path';
import * as fs from 'fs';

const SDK_DIR = path.join(process.cwd(), 'src/lib/sandbox/agenticfactor');

function readSDKFile(filename: string, fallback: string): string {
  try {
    return fs.readFileSync(path.join(SDK_DIR, filename), 'utf-8');
  } catch {
    return fallback;
  }
}

// Minimal embedded fallbacks for Vercel (these are the critical core files)
const CORE_FALLBACK = `
import os, json, sys, time, requests
from typing import Optional, Dict, Any, List
from urllib.parse import urlencode

def _get_token(provider):
    env_key = f"{provider.upper()}_ACCESS_TOKEN"
    token = os.environ.get(env_key, "")
    if not token:
        alt_key = f"{provider.upper().replace('-', '_')}_ACCESS_TOKEN"
        token = os.environ.get(alt_key, "")
    if not token:
        _signal_missing_permission(provider)
        raise PermissionError(f"No access token for '{provider}'. Env var '{env_key}' not set.")
    return token

def _get_api_key(name):
    key = os.environ.get(name, "")
    if not key:
        _signal_missing_permission(name)
        raise PermissionError(f"API key '{name}' not configured.")
    return key

class APIError(Exception):
    def __init__(self, status_code, message, provider=""):
        self.status_code = status_code
        self.provider = provider
        super().__init__(f"[{provider}] HTTP {status_code}: {message}")

def _request(method, url, token=None, api_key=None, headers=None, json_data=None, data=None, params=None, retries=2, timeout=30, provider=""):
    _headers = {"Content-Type": "application/json"}
    if token: _headers["Authorization"] = f"Bearer {token}"
    if api_key: _headers["X-API-Key"] = api_key
    if headers: _headers.update(headers)
    last_error = None
    for attempt in range(retries + 1):
        try:
            resp = requests.request(method=method, url=url, headers=_headers, json=json_data, data=data, params=params, timeout=timeout)
            if resp.status_code == 429:
                time.sleep(min(2 ** attempt, 10))
                continue
            if resp.status_code >= 400:
                try: err_body = resp.json()
                except: err_body = resp.text
                raise APIError(resp.status_code, str(err_body), provider)
            try: return resp.json()
            except: return {"text": resp.text, "status": resp.status_code}
        except requests.exceptions.Timeout:
            last_error = APIError(408, "Request timed out", provider)
            if attempt < retries: time.sleep(2 ** attempt); continue
        except APIError: raise
        except Exception as e:
            last_error = APIError(500, str(e), provider)
            if attempt < retries: time.sleep(1); continue
    raise last_error or APIError(500, "Request failed after retries", provider)

def ask_user(question, options=None):
    signal = {"__user_prompt__": {"question": question, "options": options or [], "timestamp": time.time()}}
    print(f"__SIGNAL__:{json.dumps(signal)}")
    return ""

def notify_user(message, email=True):
    signal = {"__notify__": {"message": message, "send_email": email, "timestamp": time.time()}}
    print(f"__SIGNAL__:{json.dumps(signal)}")

def schedule_check(delay, context=None, reason=""):
    signal = {"__schedule__": {"delay": delay, "context": context or {}, "reason": reason, "timestamp": time.time()}}
    print(f"__SIGNAL__:{json.dumps(signal)}")

def _signal_missing_permission(provider):
    signal = {"__missing_permission__": {"provider": provider, "timestamp": time.time()}}
    print(f"__SIGNAL__:{json.dumps(signal)}")

PROVIDER_BASE_URLS = {
    "google": "https://www.googleapis.com", "gmail": "https://gmail.googleapis.com",
    "calendar": "https://www.googleapis.com/calendar/v3", "drive": "https://www.googleapis.com/drive/v3",
    "sheets": "https://sheets.googleapis.com/v4", "slides": "https://slides.googleapis.com/v1",
    "contacts": "https://people.googleapis.com/v1", "linkedin": "https://api.linkedin.com/v2",
    "slack": "https://slack.com/api", "github": "https://api.github.com",
    "notion": "https://api.notion.com/v1", "hubspot": "https://api.hubapi.com",
    "sendgrid": "https://api.sendgrid.com/v3", "airtable": "https://api.airtable.com/v0",
}
`;

const INIT_FALLBACK = `
__version__ = "1.0.0"
from . import gmail, calendar, drive, sheets, search, files, api
from ._core import ask_user, notify_user, schedule_check
__all__ = ["gmail","calendar","drive","sheets","search","files","api","ask_user","notify_user","schedule_check"]
`;

// SDK file list and their fallbacks
const SDK_FILES: { name: string; fallback: string }[] = [
  { name: '__init__.py', fallback: INIT_FALLBACK },
  { name: '_core.py', fallback: CORE_FALLBACK },
  // These modules use _core, so a minimal fallback just re-exports the raw API approach
  { name: 'gmail.py', fallback: '' },
  { name: 'calendar.py', fallback: '' },
  { name: 'drive.py', fallback: '' },
  { name: 'sheets.py', fallback: '' },
  { name: 'api.py', fallback: '' },
  { name: 'search.py', fallback: '' },
  { name: 'files.py', fallback: '' },
];

/**
 * Get all SDK files as {filename: content} pairs.
 * Tries to read from disk first (local dev), falls back to embedded strings (Vercel).
 */
export function getSDKFiles(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of SDK_FILES) {
    const content = readSDKFile(file.name, file.fallback);
    if (content.trim()) {
      result[file.name] = content;
    }
  }
  return result;
}
