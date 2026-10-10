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


def _record_write_failure(action: str, error: Any) -> None:
    """Report a failed live write even when the script catches the exception: a bookkeeping script
    logged 404s for every invoice and bill, carried on, and its step showed as complete."""
    try:
        sys.stderr.write("__AF_WRITE_FAILED__:" + json.dumps({"action": action, "error": str(error)[:300]}) + "\n")
    except Exception:
        pass


def _record_deferred(action: str, params: Any) -> None:
    """Report a write the preview deferred, with its parameters shortened, so the approval screen
    shows the exact call — an approval card once showed a document's text but not that the call
    would make it public to anyone with the link."""
    def short(v):
        if isinstance(v, str):
            return v if len(v) <= 12000 else v[:12000] + "..."
        if isinstance(v, (list, tuple)):
            return [short(x) for x in list(v)[:10]]
        if isinstance(v, dict):
            return {k: short(x) for k, x in list(v.items())[:20]}
        return v
    try:
        sys.stderr.write("__AF_DEFERRED__:" + json.dumps({"action": action, "params": short(params)}, default=str) + "\n")
    except Exception:
        pass


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
        _record_deferred(f"{method.upper()} {url}", json_data if json_data is not None else params)
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

_NOUN_FOLLOWERS = frozenset({'CONTENTS', 'CONTENT', 'CHILDREN', 'CHILD', 'ID', 'IDS', 'INFO', 'DETAILS', 'LOGS', 'HISTORY', 'ARTIFACTS', 'JOBS'})
_DETERMINERS = frozenset({'A', 'AN', 'THE', 'ALL', 'EACH', 'WORKFLOW'})

def _is_composio_read(action_name: str) -> bool:
    """A read: some word after the app prefix is a read verb and none is a write verb
    (so GOOGLECALENDAR_EVENTS_LIST is a read). Mirrors isComposioRead in agent-loop.ts."""
    words = action_name.upper().split('_')[1:]
    def noun_before(i):
        return i + 1 < len(words) and words[i + 1] in _NOUN_FOLLOWERS
    first_verb = next((w for i, w in enumerate(words) if w in _READ_VERBS or (w in _WRITE_VERBS and not noun_before(i))), None)
    leads_with_read = first_verb in _READ_VERBS
    def is_write(i, w):
        # Write words that are nouns in context (Notion "block", a workflow "run") don't count.
        if w not in _WRITE_VERBS or noun_before(i):
            return False
        return not (leads_with_read and i > 0 and words[i - 1] in _DETERMINERS)
    return leads_with_read and not any(is_write(i, w) for i, w in enumerate(words))


# ── Preview-pass stand-ins for deferred writes ──────────────────────────────
# Kept in sync with CORE_FALLBACK in sdk-loader.ts (this file is what ships when present).
_DEFERRED_ERROR_KEYS = frozenset({'error', 'errors', 'error_message', 'errormessage'})
_DEFERRED_PLACEHOLDER = "dry-run-preview"
_DEFERRED_COUNTER = [0]
_SCALAR_KEY_SUFFIXES = ('id', 'url', 'uri', 'link', 'name', 'title', 'path', 'token', 'status',
                        'ts', 'timestamp', 'time', 'date', 'email', 'key', 'slug', 'href')


def _is_error_key(key):
    return isinstance(key, str) and key.lower() in _DEFERRED_ERROR_KEYS


def _deferred_for(key, default=None, seq=None):
    """Placeholder shaped like what the caller expects: the .get() default's type wins, then
    id/url/name-like keys become text and anything else a nested response object."""
    if _is_error_key(key):
        return None
    if isinstance(default, dict):
        return _DeferredResult()
    if isinstance(default, list):
        return []
    if isinstance(default, str):
        return _DeferredValue(seq)
    if default is not None:
        return default
    if isinstance(key, slice):
        return _DeferredValue(seq)
    if isinstance(key, str) and key.lower().endswith(_SCALAR_KEY_SUFFIXES):
        return _DeferredValue(seq)
    return _DeferredResult()


class _DeferredValue(str):
    """A text field of a write deferred by the preview pass (an id, url, name...): reads as a
    placeholder, is truthy, and tolerates further lookups."""
    def __new__(cls, seq=None):
        value = super().__new__(cls, _DEFERRED_PLACEHOLDER if seq is None else f"{_DEFERRED_PLACEHOLDER}-{seq}")
        value._af_seq = seq
        return value

    def __getitem__(self, key):
        return _DeferredValue(self._af_seq) if isinstance(key, slice) else _deferred_for(key, seq=self._af_seq)

    def get(self, key, default=None):
        return _deferred_for(key, default, self._af_seq)

    def __contains__(self, key):
        return not _is_error_key(key)


class _DeferredResult(dict):
    """Stand-in response for a write deferred by the preview pass. Missing fields resolve to a
    placeholder of the expected shape (error fields to None), so validation code keeps running."""
    # Each deferred write gets its own placeholder ("dry-run-preview-3"): with one shared value, a
    # preview that created 16 invoices saw them all as one, and its "already paid?" checks skipped 15.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _DEFERRED_COUNTER[0] += 1
        self._af_seq = _DEFERRED_COUNTER[0]
    def __missing__(self, key):
        return _deferred_for(key, seq=self._af_seq)

    def get(self, key, default=None):
        return dict.__getitem__(self, key) if dict.__contains__(self, key) else _deferred_for(key, default, self._af_seq)

    def __contains__(self, key):
        return dict.__contains__(self, key) or not _is_error_key(key)

    def __str__(self):
        return dict.__repr__(self) if len(self) else f"{_DEFERRED_PLACEHOLDER}-{self._af_seq}"

    def __format__(self, spec):
        return format(str(self), spec)


# Composio returns lists inside a wrapper named for the resource ({"repositories": [...]},
# {"commits": [...]}). Scripts often read them with a generic key (resp.get("data", []),
# resp["items"]) and silently got an empty list — a digest reported "no commits" for a week that
# had commits. A generic key missing from such a wrapper now resolves to the wrapper's one list.
_GENERIC_LIST_KEYS = {"data", "items", "results", "result", "records", "details", "response_data", "list", "entries", "values"}


class _WrappedList(list):
    """The list inside a Composio wrapper. Still answers dict-style lookups on the wrapper, so
    d = resp.get("data", resp); d.get("repositories", []) keeps working."""
    def __init__(self, items=(), wrapper=None):
        super().__init__(items)
        self._wrapper = wrapper if wrapper is not None else {}

    def get(self, key, default=None):
        return self._wrapper.get(key, default)

    def keys(self):
        return self._wrapper.keys()

    def __getitem__(self, key):
        return self._wrapper[key] if isinstance(key, str) else list.__getitem__(self, key)


# Single objects come in an envelope too ({"ok": true, "user": {"profile": {...}}}); a script that
# read user["profile"] got nothing and showed raw user IDs instead of names. A key missing from a
# small envelope resolves into its one nested object. Status and error keys never do.
_ENVELOPE_SKIP = {"ok", "error", "errors", "warning", "warnings", "successful", "status"}
_NOT_FOUND = object()


class _ComposioData(dict):
    def _resolve(self, key):
        if len(self) <= 4 and key in _GENERIC_LIST_KEYS:
            lists = [v for v in self.values() if isinstance(v, list)]
            scalars = all(isinstance(v, (list, str, int, float, bool)) or v is None for v in self.values())
            if len(lists) == 1 and scalars:
                return _WrappedList(lists[0], self)
        if len(self) <= 6 and key not in _ENVELOPE_SKIP:
            objects = [v for v in self.values() if isinstance(v, dict)]
            if len(objects) == 1 and key in objects[0]:
                value = objects[0][key]
                return _ComposioData(value) if isinstance(value, dict) and not isinstance(value, _ComposioData) else value
        return _NOT_FOUND

    def __missing__(self, key):
        found = self._resolve(key)
        if found is _NOT_FOUND:
            raise KeyError(key)
        return found

    def get(self, key, default=None):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        found = self._resolve(key)
        return default if found is _NOT_FOUND else found


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
            f"ask_ai output was cut off at max_tokens={max_tokens} (it ends mid-sentence). Write the document in "
            "sections with ask_ai_batch, one prompt per section of ~1500 tokens; one very long call also risks the time limit."
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


def _slack_ts_params(action_name: str, params: Any) -> Any:
    """Slack timestamps must have at most 6 decimals. str(time.time() - 7 * 86400) has 7, and
    Composio re-placed the decimal point 6 digits from the end ('1790946094.1895018' became
    '17909460941.895018', centuries ahead), so every history read came back empty."""
    if not action_name.startswith("SLACK_") or not isinstance(params, dict):
        return params
    fixed = dict(params)
    for key in ("oldest", "latest"):
        value = fixed.get(key)
        if isinstance(value, bool) or value is None or value == "":
            continue
        try:
            fixed[key] = f"{float(value):.6f}"
        except (TypeError, ValueError):
            pass
    return fixed


_SHAPES_SEEN = set()


def _record_shape(action: str, result: Any) -> None:
    """Report the shape of a Composio response (field names and types, never values) so a fixer
    reads fields that exist: a Gmail script read 'internalDate' where Composio sends
    'messageTimestamp', and every email was dated 1970."""
    if action in _SHAPES_SEEN:
        return
    _SHAPES_SEEN.add(action)

    def shape(v, depth):
        if isinstance(v, dict):
            return "object" if depth >= 3 else {k: shape(x, depth + 1) for k, x in list(v.items())[:25]}
        if isinstance(v, list):
            return [shape(v[0], depth + 1)] if v else []
        return "null" if v is None else type(v).__name__

    try:
        text = json.dumps(shape(result, 0), default=str)[:1500]
        sys.stderr.write("__AF_SHAPE__:" + json.dumps({"action": action, "shape": text}) + "\n")
    except Exception:
        pass


_CONNECTED_ACCOUNTS: Dict[str, str] = {}


def _connected_account_id(toolkit: str) -> str:
    """The customer's active Composio connection for a toolkit (e.g. zoho_books)."""
    toolkit = toolkit.lower()
    if toolkit in _CONNECTED_ACCOUNTS:
        return _CONNECTED_ACCOUNTS[toolkit]
    entity_id = os.environ.get("COMPOSIO_ENTITY_ID", "")
    if not entity_id:
        _signal_missing_permission("composio")
        raise PermissionError("COMPOSIO_ENTITY_ID is not set — the tenant's Composio connection is not configured.")
    resp = requests.get(
        "https://backend.composio.dev/api/v3.1/connected_accounts",
        headers={"x-api-key": os.environ.get("COMPOSIO_API_KEY", "")},
        params={"user_ids": entity_id, "toolkit_slugs": toolkit, "statuses": "ACTIVE", "limit": 1},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise APIError(resp.status_code, resp.text[:500], f"composio_proxy:{toolkit}")
    items = (resp.json() or {}).get("items") or []
    if not items:
        # A near-miss slug ("zohobooks" for zoho_books) resolves to the customer's matching connection.
        every = requests.get(
            "https://backend.composio.dev/api/v3.1/connected_accounts",
            headers={"x-api-key": os.environ.get("COMPOSIO_API_KEY", "")},
            params={"user_ids": entity_id, "statuses": "ACTIVE", "limit": 100},
            timeout=30,
        )
        accounts = (every.json() or {}).get("items") or [] if every.status_code < 400 else []
        slugs = {(a.get("toolkit") or {}).get("slug", ""): a.get("id") for a in accounts}
        norm = lambda s: "".join(ch for ch in s.lower() if ch.isalnum())
        match = next((sid for slug, sid in slugs.items() if slug and norm(slug) == norm(toolkit)), None)
        if not match:
            _signal_missing_permission(toolkit)
            raise PermissionError(f"{toolkit} is not connected. Connected toolkits: {', '.join(sorted(s for s in slugs if s)) or 'none'}.")
        items = [{"id": match}]
    _CONNECTED_ACCOUNTS[toolkit] = items[0]["id"]
    return items[0]["id"]


def _without_version_prefix(path: str) -> Optional[str]:
    """'/books/v3/invoices?x=1' -> '/invoices?x=1'; None when there is no version segment to drop."""
    import re
    if path.startswith("http"):
        return None
    route, _, query = path.partition("?")
    segments = [seg for seg in route.split("/") if seg]
    for i, seg in enumerate(segments[:-1]):
        if re.fullmatch(r"v\d+(\.\d+)?", seg):
            return "/" + "/".join(segments[i + 1:]) + (f"?{query}" if query else "")
    return None


def composio_proxy(toolkit: str, method: str, endpoint: str, params: Optional[Dict] = None, body: Any = None, headers: Optional[Dict] = None, binary: Optional[bytes] = None, content_type: str = "application/octet-stream") -> Any:
    """Call an app's own REST API through the customer's Composio connection, for anything the
    toolkit has no action for. Zoho Books has no report actions, so a P&L is:
        composio_proxy("zoho_books", "GET", "/reports/profitandloss",
                       params={"organization_id": org_id, "from_date": "2025-04-01", "to_date": "2026-03-31"})
    endpoint is a path relative to the connected account's API base (as in the app's REST API
    docs) or an absolute URL. binary= sends raw file bytes, e.g. a generated XLSX to Google Drive:
        composio_proxy("googledrive", "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=media",
                       binary=xlsx_bytes, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    Returns the response body. Writes (POST/PUT/PATCH/DELETE) are deferred in previews like
    composio_execute writes. Kept in sync with CORE_FALLBACK."""
    method = method.upper()
    label = f"{toolkit.upper()} {method} {endpoint}"
    # Composio's proxy rejects a query string in the path ("Invalid URL Passed"): send it as parameters.
    if "?" in endpoint:
        from urllib.parse import parse_qsl
        endpoint, _, query = endpoint.partition("?")
        params = {**dict(parse_qsl(query)), **(params or {})}
    # Resolved before a preview defers the write: a wrong toolkit fails here, where it can be fixed.
    account_id = _connected_account_id(toolkit)
    if os.environ.get("AF_DRY_RUN", "0") == "1" and method not in ("GET", "HEAD"):
        sys.stderr.write(f"[DRY_RUN] Skipped composio_proxy({label}) — write op deferred\n")
        _record_deferred(label, body if body is not None else (params if binary is None else {**(params or {}), "file": f"{len(binary)} bytes ({content_type})"}))
        return _DeferredResult({"status": "ok", "dry_run": True, "action": label})

    def value(v):
        return str(v).lower() if isinstance(v, bool) else str(v)

    # Composio's proxy wants {name, type: "query" | "header", value: string}.
    parameters = [{"name": k, "type": "query", "value": value(v)} for k, v in (params or {}).items() if v is not None]
    parameters += [{"name": k, "type": "header", "value": str(v)} for k, v in (headers or {}).items()]
    payload = {"endpoint": endpoint, "method": method, "connected_account_id": account_id, "parameters": parameters}
    if body is not None:
        payload["body"] = body
    if binary is not None:
        import base64
        payload["binary_body"] = {"base64": base64.b64encode(binary).decode(), "content_type": content_type}
    def send(path):
        body_payload = {**payload, "endpoint": path}
        r = requests.post(
            "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
            headers={"x-api-key": os.environ.get("COMPOSIO_API_KEY", ""), "Content-Type": "application/json"},
            json=body_payload,
            timeout=60,
        )
        if r.status_code >= 400:
            raise APIError(r.status_code, r.text[:800], f"composio_proxy:{label}")
        data = r.json()
        status = data.get("status", 200) if isinstance(data, dict) else 200
        result = data.get("data", data) if isinstance(data, dict) else data
        if isinstance(status, int) and status >= 400:
            raise APIError(status, json.dumps(result, default=str)[:800], f"composio_proxy:{label}")
        return result

    try:
        result = send(endpoint)
    except APIError as e:
        # The connection's API base usually ends in a version ("/books/v3"), so "/books/v3/invoices"
        # doubles it and 404s. Retry once with the part up to the version segment removed.
        retry = _without_version_prefix(endpoint) if e.status_code == 404 else None
        if not retry and method not in ("GET", "HEAD"):
            _record_write_failure(label, e)
        if not retry:
            if e.status_code == 404 and not endpoint.startswith("http"):
                raise APIError(404, f"{e} — paths are relative to the app's API base, which already includes its version (e.g. '/invoices', not '/books/v3/invoices')", f"composio_proxy:{label}")
            raise
        try:
            result = send(retry)
        except APIError as retry_error:
            if method not in ("GET", "HEAD"):
                _record_write_failure(label, retry_error)
            raise
    _record_shape(f"PROXY {label}", result)
    return _ComposioData(result) if isinstance(result, dict) else result


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
    params = _slack_ts_params(action_name, params)
    dry_run = os.environ.get("AF_DRY_RUN", "0") == "1"
    if dry_run and not _is_composio_read(action_name):
        # Skip writes in DRY_RUN — reads still execute so downstream code gets real IDs/data
        sys.stderr.write(f"[DRY_RUN] Skipped composio_execute({action_name}) — write op deferred\n")
        _record_deferred(action_name, params)
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
        if not _is_composio_read(action_name):
            _record_write_failure(action_name, err_body)
        raise APIError(resp.status_code, str(err_body), action_name)

    data = resp.json()
    # v3.1 response: { successful: bool, data: {...}, error: str|null }
    if not data.get("successful", True):
        err_msg = data.get("error") or "Tool execution failed"
        if "not found" in str(err_msg).lower() or "invalid action" in str(err_msg).lower():
            sys.stderr.write(f"[COMPOSIO] Action '{action_name}' rejected — {err_msg}\n")
        if not _is_composio_read(action_name):
            _record_write_failure(action_name, err_msg)
        raise APIError(resp.status_code, err_msg, action_name)
    result = data.get("data", data)
    _record_shape(action_name, result)
    return _ComposioData(result) if isinstance(result, dict) else result
