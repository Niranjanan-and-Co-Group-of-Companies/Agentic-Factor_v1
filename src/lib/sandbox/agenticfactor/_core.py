"""
AgenticFactor Python SDK — Core Module
Pre-installed in every E2B sandbox for reliable API interactions.
Handles OAuth token management, HTTP requests, error handling, and retries.
"""

import os
import json
import sys
import time
import requests
from typing import Optional, Dict, Any, List
from urllib.parse import urlencode

# ============================================================
# TOKEN MANAGEMENT
# ============================================================

def _get_token(provider: str) -> str:
    """Get OAuth access token for a provider from environment."""
    env_key = f"{provider.upper()}_ACCESS_TOKEN"
    token = os.environ.get(env_key, "")
    if not token:
        # Try alternative naming
        alt_key = f"{provider.upper().replace('-', '_')}_ACCESS_TOKEN"
        token = os.environ.get(alt_key, "")
    if not token:
        _signal_missing_permission(provider)
        raise PermissionError(
            f"No access token for '{provider}'. "
            f"The user needs to connect {provider} on the Connectors page. "
            f"Env var '{env_key}' is not set."
        )
    return token


def _get_api_key(name: str) -> str:
    """Get an API key from environment."""
    key = os.environ.get(name, "")
    if not key:
        _signal_missing_permission(name)
        raise PermissionError(f"API key '{name}' is not configured.")
    return key


# ============================================================
# HTTP CLIENT WITH RETRIES
# ============================================================

class APIError(Exception):
    """Raised when an API call fails."""
    def __init__(self, status_code: int, message: str, provider: str = ""):
        self.status_code = status_code
        self.provider = provider
        super().__init__(f"[{provider}] HTTP {status_code}: {message}")


def _request(
    method: str,
    url: str,
    token: Optional[str] = None,
    api_key: Optional[str] = None,
    headers: Optional[Dict] = None,
    json_data: Optional[Dict] = None,
    data: Optional[Any] = None,
    params: Optional[Dict] = None,
    retries: int = 2,
    timeout: int = 30,
    provider: str = "",
) -> Dict:
    """Make an HTTP request with retry logic and error handling."""
    
    # ── DRY RUN MODE ──
    # When AF_DRY_RUN=1, WRITE operations (POST/PUT/PATCH/DELETE) return mock success
    # READ operations (GET) still execute normally so data fetching works
    # This prevents side effects (email sending, sheet creation) during retry attempts
    dry_run = os.environ.get("AF_DRY_RUN", "0") == "1"
    if dry_run and method.upper() in ("POST", "PUT", "PATCH", "DELETE"):
        sys.stderr.write(f"[DRY_RUN] Skipped {method} {url} (side effects deferred to final run)\n")
        # Return realistic mock responses based on the URL/provider
        mock_id = f"dryrun_{int(time.time())}"
        if "messages/send" in url or "gmail" in provider:
            return {"id": mock_id, "threadId": mock_id, "labelIds": ["SENT"]}
        elif "spreadsheets" in url or "sheets" in provider:
            return {"spreadsheetId": mock_id, "spreadsheetUrl": f"https://docs.google.com/spreadsheets/d/{mock_id}"}
        elif "events" in url or "calendar" in provider:
            return {"id": mock_id, "status": "confirmed", "htmlLink": f"https://calendar.google.com/event?eid={mock_id}"}
        elif "files" in url or "drive" in provider:
            return {"id": mock_id, "name": "dryrun_file", "webViewLink": f"https://drive.google.com/file/d/{mock_id}"}
        elif "drafts" in url:
            return {"id": mock_id, "status": "draft_created"}
        else:
            return {"id": mock_id, "status": "ok", "dry_run": True}
    
    _headers = {"Content-Type": "application/json"}
    if token:
        _headers["Authorization"] = f"Bearer {token}"
    if api_key:
        _headers["X-API-Key"] = api_key
    if headers:
        _headers.update(headers)

    last_error = None
    for attempt in range(retries + 1):
        try:
            resp = requests.request(
                method=method,
                url=url,
                headers=_headers,
                json=json_data,
                data=data,
                params=params,
                timeout=timeout,
            )
            
            if resp.status_code == 429:
                # Rate limited — wait and retry
                wait = min(2 ** attempt, 10)
                time.sleep(wait)
                continue
            
            if resp.status_code >= 400:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = resp.text
                raise APIError(resp.status_code, str(err_body), provider)
            
            # Success
            try:
                return resp.json()
            except Exception:
                return {"text": resp.text, "status": resp.status_code}
                
        except requests.exceptions.Timeout:
            last_error = APIError(408, "Request timed out", provider)
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
        except APIError:
            raise
        except Exception as e:
            last_error = APIError(500, str(e), provider)
            if attempt < retries:
                time.sleep(1)
                continue

    raise last_error or APIError(500, "Request failed after retries", provider)


# ============================================================
# INTERACTIVE SIGNALS (detected by agent-loop.ts)
# ============================================================

def ask_user(question: str, options: Optional[List[str]] = None) -> str:
    """
    Pause agent execution and ask the user a question.
    The agent-loop.ts will detect this signal, save the question,
    and resume execution when the user responds.
    """
    signal = {
        "__user_prompt__": {
            "question": question,
            "options": options or [],
            "timestamp": time.time(),
        }
    }
    # Write to a special signal file that agent-loop.ts monitors
    with open("/tmp/__agenticfactor_signal__.json", "w") as f:
        json.dump(signal, f)
    # Also print for stdout-based detection
    print(f"__SIGNAL__:{json.dumps(signal)}")
    return ""


def notify_user(message: str, email: bool = True) -> None:
    """Send a notification to the user (in-app + optional email)."""
    signal = {
        "__notify__": {
            "message": message,
            "send_email": email,
            "timestamp": time.time(),
        }
    }
    with open("/tmp/__agenticfactor_signal__.json", "w") as f:
        json.dump(signal, f)
    print(f"__SIGNAL__:{json.dumps(signal)}")


def schedule_check(delay: str, context: Optional[Dict] = None, reason: str = "") -> None:
    """
    Schedule a future re-check.
    delay: "3d" for 3 days, "2h" for 2 hours, "30m" for 30 minutes
    context: Data to pass to the agent when it resumes
    """
    signal = {
        "__schedule__": {
            "delay": delay,
            "context": context or {},
            "reason": reason,
            "timestamp": time.time(),
        }
    }
    with open("/tmp/__agenticfactor_signal__.json", "w") as f:
        json.dump(signal, f)
    print(f"__SIGNAL__:{json.dumps(signal)}")


def _signal_missing_permission(provider: str) -> None:
    """Signal that a permission/connector is missing."""
    signal = {
        "__missing_permission__": {
            "provider": provider,
            "timestamp": time.time(),
        }
    }
    with open("/tmp/__agenticfactor_signal__.json", "w") as f:
        json.dump(signal, f)
    print(f"__SIGNAL__:{json.dumps(signal)}")


# ============================================================
# PROVIDER BASE URLS
# ============================================================

PROVIDER_BASE_URLS = {
    "google": "https://www.googleapis.com",
    "gmail": "https://gmail.googleapis.com",
    "calendar": "https://www.googleapis.com/calendar/v3",
    "drive": "https://www.googleapis.com/drive/v3",
    "sheets": "https://sheets.googleapis.com/v4",
    "slides": "https://slides.googleapis.com/v1",
    "contacts": "https://people.googleapis.com/v1",
    "linkedin": "https://api.linkedin.com/v2",
    "slack": "https://slack.com/api",
    "github": "https://api.github.com",
    "notion": "https://api.notion.com/v1",
    "discord": "https://discord.com/api/v10",
    "zoho": "https://www.zohoapis.com",
    # ── Social Media ──
    "twitter": "https://api.twitter.com/2",
    "facebook": "https://graph.facebook.com/v19.0",
    "instagram": "https://graph.facebook.com/v19.0",
    # ── Other ──
    "salesforce": "",   # Instance-specific — read SALESFORCE_BASE_URL from env
    "hubspot": "https://api.hubapi.com",
    "jira": "",         # Instance-specific — read JIRA_BASE_URL / CUSTOM_JIRA_BASE_URL from env
    "stripe": "https://api.stripe.com/v1",
    "shopify": "",      # Store-specific — read SHOPIFY_BASE_URL from env
    "twilio": "https://api.twilio.com/2010-04-01",
    "sendgrid": "https://api.sendgrid.com/v3",
    "airtable": "https://api.airtable.com/v0",
    "zendesk": "",      # Instance-specific — read ZENDESK_BASE_URL / CUSTOM_ZENDESK_BASE_URL from env
    "linear": "https://api.linear.app",
    "asana": "https://app.asana.com/api/1.0",
    "intercom": "https://api.intercom.io",
    "trello": "https://api.trello.com/1",
    "monday": "https://api.monday.com/v2",
}

# Load custom base URLs from env (admin-configured)
_custom_urls = os.environ.get("CONNECTOR_BASE_URLS", "")
if _custom_urls:
    try:
        PROVIDER_BASE_URLS.update(json.loads(_custom_urls))
    except Exception:
        pass


# ============================================================
# COMPOSIO — Preferred tool execution for 850+ integrations
# ============================================================

_READ_VERBS = frozenset({
    'GET', 'LIST', 'SEARCH', 'FIND', 'FETCH', 'READ', 'CHECK', 'VIEW', 'QUERY',
    'RETRIEVE', 'SHOW', 'DESCRIBE', 'LOOKUP', 'COUNT', 'DOWNLOAD', 'EXPORT', 'WHO',
})
_WRITE_VERBS = frozenset({
    'CREATE', 'UPDATE', 'DELETE', 'REMOVE', 'SEND', 'SENDS', 'POST', 'PUT', 'PATCH', 'ADD', 'INSERT',
    'APPEND', 'UPLOAD', 'MOVE', 'COPY', 'RENAME', 'SET', 'MERGE', 'PUBLISH', 'REPLY', 'FORWARD', 'TRASH',
    'ARCHIVE', 'UNARCHIVE', 'INVITE', 'SHARE', 'STAR', 'UNSTAR', 'MARK', 'LABEL', 'MODIFY', 'EDIT',
    'REPLACE', 'CLEAR', 'EXECUTE', 'RUN', 'TRIGGER', 'CANCEL', 'CLOSE', 'LOCK', 'UNLOCK', 'ASSIGN',
    'UNASSIGN', 'ENABLE', 'DISABLE', 'APPROVE', 'DISMISS', 'SUBMIT', 'SCHEDULE', 'UPSERT', 'WRITE',
    'IMPORT', 'DUPLICATE', 'TRANSFER', 'PAY', 'CHARGE', 'REFUND', 'FOLLOW', 'UNFOLLOW', 'BLOCK', 'UNBLOCK',
    'MUTE', 'UNMUTE', 'PIN', 'UNPIN', 'REACT', 'COMMENT', 'TWEET', 'RETWEET', 'LIKE', 'UNLIKE', 'ACCEPT',
    'DECLINE', 'JOIN', 'LEAVE', 'KICK', 'BAN', 'RESTORE', 'RESET', 'REVOKE', 'GRANT', 'SYNC',
})

def _is_composio_read(action_name: str) -> bool:
    """A read: some word after the app prefix is a read verb and none is a write verb
    (so GOOGLECALENDAR_EVENTS_LIST is a read). Mirrors isComposioRead in agent-loop.ts."""
    words = action_name.upper().split('_')[1:]
    return any(w in _READ_VERBS for w in words) and not any(w in _WRITE_VERBS for w in words)


# ── Preview-pass stand-ins for deferred writes ──────────────────────────────
# Kept in sync with CORE_FALLBACK in sdk-loader.ts (this file is what ships when present).
_DEFERRED_ERROR_KEYS = frozenset({'error', 'errors', 'error_message', 'errormessage'})
_DEFERRED_PLACEHOLDER = "dry-run-preview"
_SCALAR_KEY_SUFFIXES = ('id', 'url', 'uri', 'link', 'name', 'title', 'path', 'token', 'status',
                        'ts', 'timestamp', 'time', 'date', 'email', 'key', 'slug', 'href')


def _is_error_key(key):
    return isinstance(key, str) and key.lower() in _DEFERRED_ERROR_KEYS


def _deferred_for(key, default=None):
    """Placeholder shaped like what the caller expects: the .get() default's type wins, then
    id/url/name-like keys become text and anything else a nested response object."""
    if _is_error_key(key):
        return None
    if isinstance(default, dict):
        return _DeferredResult()
    if isinstance(default, list):
        return []
    if isinstance(default, str):
        return _DeferredValue()
    if default is not None:
        return default
    if isinstance(key, slice):
        return _DeferredValue()
    if isinstance(key, str) and key.lower().endswith(_SCALAR_KEY_SUFFIXES):
        return _DeferredValue()
    return _DeferredResult()


class _DeferredValue(str):
    """A text field of a write deferred by the preview pass (an id, url, name...): reads as a
    placeholder, is truthy, and tolerates further lookups."""
    def __new__(cls):
        return super().__new__(cls, _DEFERRED_PLACEHOLDER)

    def __getitem__(self, key):
        return _DeferredValue() if isinstance(key, slice) else _deferred_for(key)

    def get(self, key, default=None):
        return _deferred_for(key, default)

    def __contains__(self, key):
        return not _is_error_key(key)


class _DeferredResult(dict):
    """Stand-in response for a write deferred by the preview pass. Missing fields resolve to a
    placeholder of the expected shape (error fields to None), so validation code keeps running."""
    def __missing__(self, key):
        return _deferred_for(key)

    def get(self, key, default=None):
        return dict.__getitem__(self, key) if dict.__contains__(self, key) else _deferred_for(key, default)

    def __contains__(self, key):
        return dict.__contains__(self, key) or not _is_error_key(key)

    def __str__(self):
        return dict.__repr__(self) if len(self) else _DEFERRED_PLACEHOLDER

    def __format__(self, spec):
        return format(str(self), spec)


def ask_ai(prompt: str, system: str = "", max_tokens: int = 1500, json_mode: bool = False) -> str:
    """Use the platform's AI while the agent runs: summarise, write, classify or analyse data the
    script fetched. Returns the model's text (a JSON string when json_mode=True).
    Billed to the workspace's credits. Kept in sync with CORE_FALLBACK in sdk-loader.ts."""
    token = os.environ.get("AF_LLM_TOKEN", "")
    base = os.environ.get("AF_API_BASE", "https://agenticfactor.io").rstrip("/")
    if not token:
        raise RuntimeError("ask_ai is unavailable: AF_LLM_TOKEN is not set for this run.")
    resp = requests.post(
        f"{base}/api/sandbox/llm",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        # The preview's text is stored and handed back to the live run, so what was approved is what gets written.
        json={"prompt": prompt, "system": system, "max_tokens": max_tokens, "json": json_mode,
              "phase": "preview" if os.environ.get("AF_DRY_RUN", "0") == "1" else "live"},
        timeout=150,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"ask_ai failed (HTTP {resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    if data.get("truncated"):
        raise RuntimeError(
            f"ask_ai output was cut off at max_tokens={max_tokens} (it ends mid-sentence). Raise max_tokens "
            "(up to 4000) or write the document in sections with ask_ai_batch, one prompt per section."
        )
    return data.get("text", "")


def ask_ai_batch(prompts, system: str = "", max_tokens: int = 1500, json_mode: bool = False, max_workers: int = 4) -> list:
    """Run several independent ask_ai prompts at the same time and return their texts in the same
    order. Each AI call takes ~10-20s, so use this instead of calling ask_ai in a loop."""
    from concurrent.futures import ThreadPoolExecutor
    prompts = list(prompts)
    if not prompts:
        return []
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, 6, len(prompts)))) as pool:
        return list(pool.map(lambda p: ask_ai(p, system=system, max_tokens=max_tokens, json_mode=json_mode), prompts))


def composio_execute(action_name: str, params: Dict[str, Any], dry_run_result: Optional[Dict] = None) -> Dict:
    """
    Execute a Composio action for the current tenant entity.

    Use this instead of api.call() for any provider that has a Composio
    action listed in the blueprint's system prompt. Composio handles token
    refresh, retries, and API quirks automatically.

    Args:
        action_name: Exact Composio action name, e.g. "GMAIL_SEND_EMAIL"
        params: Parameter dict matching the action's schema
        dry_run_result: Optional mock result for AF_DRY_RUN mode (defaults to {"status": "ok", "dry_run": True})

    Returns:
        Response data dict from the action execution
    """
    dry_run = os.environ.get("AF_DRY_RUN", "0") == "1"
    if dry_run and not _is_composio_read(action_name):
        # Skip writes in DRY_RUN — reads still execute so downstream code gets real IDs/data
        sys.stderr.write(f"[DRY_RUN] Skipped composio_execute({action_name}) — write op deferred\n")
        return _DeferredResult(dry_run_result or {"status": "ok", "dry_run": True, "action": action_name})
    # Reading back something a deferred write "created" (its id is the placeholder) can't hit the
    # real API — the resource doesn't exist yet — so answer it with a placeholder too.
    if dry_run and _DEFERRED_PLACEHOLDER in json.dumps(params, default=str):
        sys.stderr.write(f"[DRY_RUN] Deferred composio_execute({action_name}) — reads a resource created in this preview\n")
        return _DeferredResult({"status": "ok", "dry_run": True, "action": action_name})

    entity_id = os.environ.get("COMPOSIO_ENTITY_ID", "")
    api_key = os.environ.get("COMPOSIO_API_KEY", "")

    if not entity_id:
        _signal_missing_permission("composio")
        raise PermissionError(
            f"COMPOSIO_ENTITY_ID is not set — cannot execute {action_name}. "
            "The tenant's Composio connection is not configured."
        )

    resp = requests.post(
        f"https://backend.composio.dev/api/v3.1/tools/execute/{action_name}",
        headers={"x-api-key": api_key, "Content-Type": "application/json"},
        json={"user_id": entity_id, "arguments": params},
        timeout=60,
    )

    if resp.status_code >= 400:
        try:
            err_body = resp.json()
        except Exception:
            err_body = resp.text
        if resp.status_code == 404:
            sys.stderr.write(f"[COMPOSIO] Action '{action_name}' not found — verify the exact name (ALL_CAPS_WITH_UNDERSCORES).\n")
            raise APIError(404, f"Composio action '{action_name}' does not exist. Use only action names listed in the mission blueprint.", action_name)
        raise APIError(resp.status_code, str(err_body), action_name)

    data = resp.json()
    # v3.1 response: { successful: bool, data: {...}, error: str|null }
    if not data.get("successful", True):
        err_msg = data.get("error") or "Tool execution failed"
        if "not found" in str(err_msg).lower() or "invalid action" in str(err_msg).lower():
            sys.stderr.write(f"[COMPOSIO] Action '{action_name}' rejected — {err_msg}\n")
        raise APIError(resp.status_code, err_msg, action_name)
    return data.get("data", data)
