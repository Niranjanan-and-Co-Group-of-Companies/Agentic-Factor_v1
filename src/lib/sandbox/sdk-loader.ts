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
import os, json, sys, time, itertools, requests
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

def _record_write_failure(action: str, error: Any) -> None:
    """Report a failed live write even when the script catches the exception: a bookkeeping script
    logged 404s for every invoice and bill, carried on, and its step showed as complete."""
    try:
        sys.stderr.write("__AF_WRITE_FAILED__:" + json.dumps({"action": action, "error": str(error)[:300]}) + "\\n")
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
        sys.stderr.write("__AF_DEFERRED__:" + json.dumps({"action": action, "params": short(params)}, default=str) + "\\n")
    except Exception:
        pass


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
  "twitter": "https://api.twitter.com/2", "facebook": "https://graph.facebook.com/v19.0",
  "instagram": "https://graph.facebook.com/v19.0",
}

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

_DEFERRED_ERROR_KEYS = frozenset({'error', 'errors', 'error_message', 'errormessage'})

def _is_error_key(key):
    return isinstance(key, str) and key.lower() in _DEFERRED_ERROR_KEYS

_DEFERRED_PLACEHOLDER = "dry-run-preview"
_DEFERRED_SEQ = itertools.count(1)  # next() is atomic: safe when a script writes from threads
_SCALAR_KEY_SUFFIXES = ('id', 'url', 'uri', 'link', 'name', 'title', 'path', 'token', 'status',
                        'ts', 'timestamp', 'time', 'date', 'email', 'key', 'slug', 'href')

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
        self._af_seq = next(_DEFERRED_SEQ)
    def __missing__(self, key):
        return _deferred_for(key, seq=self._af_seq)
    def get(self, key, default=None):
        return dict.__getitem__(self, key) if dict.__contains__(self, key) else _deferred_for(key, default, self._af_seq)
    def __contains__(self, key):
        return dict.__contains__(self, key) or not _is_error_key(key)
    def __str__(self):
        return dict.__repr__(self) if len(self) else f"{_DEFERRED_PLACEHOLDER}-{self._af_seq}"
    __format__ = lambda self, spec: format(str(self), spec)

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
    """Use the platform's AI while the agent runs (summarise, write, classify, analyse fetched data).
    Returns the model's text (a JSON string when json_mode=True). Billed to the workspace's credits."""
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
        sys.stderr.write("__AF_SHAPE__:" + json.dumps({"action": action, "shape": text}) + "\\n")
    except Exception:
        pass


_CONNECTED_ACCOUNTS: Dict[str, str] = {}
# Each connection's own API base, e.g. "https://www.zohoapis.in/books" for a Zoho Books account on the
# India data centre: Composio's proxy did not resolve relative paths for it ("Invalid URL Passed").
_CONNECTION_BASES: Dict[str, Optional[str]] = {}


def _base_url_of(account: Any) -> Optional[str]:
    """The base_url / api_url / instance endpoint stored on a Composio connected account, if any."""
    def walk(v, depth=0):
        if not isinstance(v, dict) or depth > 4:
            return None
        for key in ("base_url", "api_url", "instanceEndpoint", "instance_url"):
            x = v.get(key)
            if isinstance(x, str) and x.startswith("http"):
                return x.rstrip("/")
        for x in v.values():
            found = walk(x, depth + 1)
            if found:
                return found
        return None
    return walk(account)


def _account_details(account_id: str) -> Dict:
    try:
        r = requests.get(
            f"https://backend.composio.dev/api/v3.1/connected_accounts/{account_id}",
            headers={"x-api-key": os.environ.get("COMPOSIO_API_KEY", "")},
            timeout=30,
        )
        return r.json() if r.status_code < 400 else {}
    except Exception:
        return {}


def _join_base(base: str, path: str) -> str:
    """'https://www.zohoapis.in/books' + '/books/v3/invoices' -> 'https://www.zohoapis.in/books/v3/invoices'
    (the app's documented path, with the part the base already has merged)."""
    from urllib.parse import urlparse
    base_path = urlparse(base).path.rstrip("/")
    if base_path and (path == base_path or path.startswith(base_path + "/")):
        path = path[len(base_path):]
    return base + (path if path.startswith("/") else "/" + path)


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
    _CONNECTION_BASES[toolkit] = _base_url_of(items[0]) or _base_url_of(_account_details(items[0]["id"]))
    return items[0]["id"]


def _without_version_prefix(path: str) -> Optional[str]:
    """'/books/v3/invoices?x=1' -> '/invoices?x=1'; None when there is no version segment to drop."""
    import re
    if path.startswith("http"):
        return None
    route, _, query = path.partition("?")
    segments = [seg for seg in route.split("/") if seg]
    for i, seg in enumerate(segments[:-1]):
        if re.fullmatch(r"v\\d+(\\.\\d+)?", seg):
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
        sys.stderr.write(f"[DRY_RUN] Skipped composio_proxy({label}) — write op deferred\\n")
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

    was_relative = not endpoint.startswith("http")
    base = _CONNECTION_BASES.get(toolkit.lower())
    if base and was_relative:
        endpoint = _join_base(base, endpoint)
    try:
        result = send(endpoint)
    except APIError as e:
        # The connection's API base usually ends in a version ("/books/v3"), so "/books/v3/invoices"
        # doubles it and 404s. Retry once with the part up to the version segment removed.
        retry = _without_version_prefix(endpoint) if e.status_code == 404 else None
        if not retry and method not in ("GET", "HEAD"):
            _record_write_failure(label, e)
        if not retry:
            if e.status_code == 404 and was_relative:
                raise APIError(404, f"{e} — use the app's full documented REST path (e.g. Zoho Books '/books/v3/invoices'); it is joined with this connection's own base URL", f"composio_proxy:{label}")
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
    """Execute a Composio action for the current tenant entity.
    Use instead of api.call() for any provider connected via Composio OAuth.
    Composio handles token refresh, retries, and API quirks automatically.
    In DRY_RUN mode: reads execute normally (so downstream code gets real IDs),
    writes are safely mocked.
    """
    params = _slack_ts_params(action_name, params)
    dry_run = os.environ.get("AF_DRY_RUN", "0") == "1"
    if dry_run and not _is_composio_read(action_name):
        sys.stderr.write(f"[DRY_RUN] Skipped composio_execute({action_name}) — write op deferred\\n")
        _record_deferred(action_name, params)
        return _DeferredResult(dry_run_result or {"status": "ok", "dry_run": True, "action": action_name})
    # Reading back something a deferred write "created" (its id is the placeholder) can't hit the
    # real API — the resource doesn't exist yet — so answer it with a placeholder too.
    if dry_run and _DEFERRED_PLACEHOLDER in json.dumps(params, default=str):
        sys.stderr.write(f"[DRY_RUN] Deferred composio_execute({action_name}) — reads a resource created in this preview\\n")
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
            sys.stderr.write(f"[COMPOSIO] Action '{action_name}' not found — verify the exact name (ALL_CAPS_WITH_UNDERSCORES).\\n")
            raise APIError(404, f"Composio action '{action_name}' does not exist. Use only action names listed in the mission blueprint.", action_name)
        if not _is_composio_read(action_name):
            _record_write_failure(action_name, err_body)
        raise APIError(resp.status_code, str(err_body), action_name)

    data = resp.json()
    if not data.get("successful", True):
        err_msg = data.get("error") or "Tool execution failed"
        if "not found" in str(err_msg).lower() or "invalid action" in str(err_msg).lower():
            sys.stderr.write(f"[COMPOSIO] Action '{action_name}' rejected — {err_msg}\\n")
        if not _is_composio_read(action_name):
            _record_write_failure(action_name, err_msg)
        raise APIError(resp.status_code, err_msg, action_name)
    result = data.get("data", data)
    _record_shape(action_name, result)
    return _ComposioData(result) if isinstance(result, dict) else result
`;

const INIT_FALLBACK = `
__version__ = "1.2.0"
from . import gmail, calendar, drive, sheets, search, files, api, social, creative, buffer
from ._core import ask_user, notify_user, schedule_check, composio_execute
__all__ = ["gmail","calendar","drive","sheets","search","files","api","social","creative","buffer","ask_user","notify_user","schedule_check","composio_execute"]
`;

const BUFFER_FALLBACK = `"""
AgenticFactor SDK — Buffer Social Media Module
Publish posts to Facebook Pages, Instagram Business, LinkedIn, Twitter, TikTok,
Threads, Bluesky, Pinterest, and more via Buffer's GraphQL API.
Buffer already has Meta's approval — no Facebook/Instagram app review needed.

Usage:
    from agenticfactor import buffer
    channels = buffer.buffer_get_channels()
    linkedin = [c for c in channels if c['service'] == 'linkedin']
    buffer.buffer_create_post(linkedin[0]['id'], "Hello LinkedIn!")
"""
import os, json, time, requests
from typing import Optional, List, Dict, Any

BUFFER_GQL = "https://api.buffer.com"

def _token():
    token = os.environ.get("BUFFER_API_KEY", "")
    if not token:
        signal = {"__missing_permission__": {"provider": "buffer", "timestamp": time.time()}}
        print(f"__SIGNAL__:{json.dumps(signal)}")
        raise PermissionError("BUFFER_API_KEY not set — connect Buffer in the Connectors page.")
    return token

def _gql(query, variables=None):
    token = _token()
    resp = requests.post(BUFFER_GQL, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, json={"query": query, "variables": variables or {}}, timeout=30)
    if resp.status_code >= 400: raise RuntimeError(f"[Buffer] HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if data.get("errors"): raise RuntimeError(f"[Buffer] GraphQL error: {data['errors']}")
    return data.get("data", {})

def buffer_get_channels():
    """Return all social channels connected to this Buffer account.
    First fetches org IDs, then fetches channels for each org.
    Returns list of dicts: {id, service, name, displayName, avatar, organizationId, isDisconnected}
    service is one of: 'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'threads', 'bluesky', 'pinterest', etc.
    """
    account_data = _gql("query { account { organizations { id name } } }")
    orgs = account_data.get("account", {}).get("organizations", [])
    all_channels = []
    for org in orgs:
        result = _gql("""
            query GetChannels($input: ChannelsInput!) {
              channels(input: $input) { id name displayName service type avatar organizationId isDisconnected }
            }""", variables={"input": {"organizationId": org["id"]}})
        all_channels.extend([{"id": c.get("id",""), "service": c.get("service",""), "name": c.get("name",""), "displayName": c.get("displayName",""), "avatar": c.get("avatar",""), "organizationId": c.get("organizationId",""), "isDisconnected": c.get("isDisconnected", False)} for c in result.get("channels", [])])
    return all_channels

def buffer_create_post(channel_id, text, image_url=None, scheduled_at=None, now=False):
    """Create a post on a social channel via Buffer.
    Args:
        channel_id: Channel ID from buffer_get_channels()
        text: Post content
        image_url: Optional publicly accessible image URL to attach
        scheduled_at: ISO 8601 UTC datetime to schedule (optional; None = next queue slot)
        now: If True, publish immediately
    Returns dict: {post_id, text, due_at, status}
    """
    inp = {"text": text, "channelId": channel_id, "schedulingType": "automatic", "mode": "customScheduled" if scheduled_at else "addToQueue"}
    if scheduled_at: inp["dueAt"] = scheduled_at
    if image_url: inp["assets"] = [{"url": image_url, "type": "image"}]
    result = _gql("""
        mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            ... on PostActionSuccess { post { id text dueAt status } }
            ... on MutationError { message }
          }
        }""", variables={"input": inp})
    r = result.get("createPost", {})
    if "message" in r: raise RuntimeError(f"[Buffer] Post failed: {r['message']}")
    p = r.get("post", {})
    return {"post_id": p.get("id",""), "text": p.get("text",""), "due_at": p.get("dueAt"), "status": p.get("status","")}

def buffer_post_to_multiple(channel_ids, text, image_url=None, scheduled_at=None, now=False):
    """Post to multiple channels at once. Returns list of {channel_id, post_id, status} or {channel_id, error}."""
    results = []
    for cid in channel_ids:
        try: results.append({"channel_id": cid, **buffer_create_post(cid, text, image_url=image_url, scheduled_at=scheduled_at, now=now)})
        except Exception as e: results.append({"channel_id": cid, "error": str(e)})
    return results

def buffer_get_posts(channel_id, status="queue", first=20):
    """Get queued or sent posts for a channel. status: 'queue', 'sent', or 'draft'. Returns list of {id, text, due_at, status}."""
    status_map = {"queue": ["pending"], "sent": ["sent"], "draft": ["draft"]}
    result = _gql("""
        query GetPosts($first: Int, $input: PostsInput!) {
          posts(first: $first, input: $input) { edges { node { id text dueAt status } } }
        }""", variables={"first": first, "input": {"filter": {"status": status_map.get(status, ["pending"]), "channelIds": [channel_id]}}})
    return [{"id": e["node"].get("id",""), "text": e["node"].get("text",""), "due_at": e["node"].get("dueAt"), "status": e["node"].get("status","")} for e in result.get("posts",{}).get("edges",[]) if e.get("node")]

def buffer_delete_post(post_id):
    """Delete a post by ID. Returns {"success": True}."""
    result = _gql("""
        mutation DeletePost($input: DeletePostInput!) {
          deletePost(input: $input) {
            ... on PostActionSuccess { post { id } }
            ... on MutationError { message }
          }
        }""", variables={"input": {"postId": post_id}})
    r = result.get("deletePost", {})
    if "message" in r: raise RuntimeError(f"[Buffer] Delete failed: {r['message']}")
    return {"success": True, "deleted_id": post_id}
`;

const GMAIL_FALLBACK = `"""
AgenticFactor SDK — Gmail Module
Send, read, search, draft emails via Gmail API using stored OAuth tokens.
"""

import base64
import json
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional, List, Dict, Any

from ._core import _get_token, _request

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"


def _token():
    return _get_token("google")


def _via_composio() -> bool:
    """Composio-managed Google connections have no direct token: route through Composio instead.
    (A mission's interview emails reported 'No access token for google' and would never have sent.)"""
    return not os.environ.get("GOOGLE_ACCESS_TOKEN") and bool(os.environ.get("COMPOSIO_ENTITY_ID"))


def _composio_data(result) -> Dict:
    if isinstance(result, dict):
        data = result.get("data", result)
        return data if isinstance(data, dict) else {}
    return {}


def send(
    to: str,
    subject: str,
    body: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
    html: bool = False,
    reply_to: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Dict:
    """
    Send an email via Gmail API.

    Args:
        to: Recipient email (comma-separated for multiple)
        subject: Email subject line
        body: Email body (plain text or HTML)
        cc: CC recipients (comma-separated)
        bcc: BCC recipients (comma-separated)
        html: If True, send as HTML email
        reply_to: Message-ID to reply to
        attachments: List of {"filename": "...", "content": bytes, "mime_type": "..."}

    Returns:
        Dict with message id and thread id
    """
    if _via_composio() and not attachments and not reply_to:
        from ._core import composio_execute
        params: Dict[str, Any] = {"recipient_email": to, "subject": subject, "body": body, "is_html": html}
        if cc:
            params["cc"] = [a.strip() for a in cc.split(",") if a.strip()]
        if bcc:
            params["bcc"] = [a.strip() for a in bcc.split(",") if a.strip()]
        data = _composio_data(composio_execute("GMAIL_SEND_EMAIL", params))
        return {"id": data.get("id"), "threadId": data.get("threadId"), "status": "sent", "via": "composio"}
    token = _token()

    if attachments:
        msg = MIMEMultipart()
        if html:
            msg.attach(MIMEText(body, "html"))
        else:
            msg.attach(MIMEText(body, "plain"))

        for att in attachments:
            part = MIMEBase("application", "octet-stream")
            content = att.get("content", b"")
            if isinstance(content, str):
                content = content.encode()
            part.set_payload(content)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{att.get("filename", "file")}"')
            msg.attach(part)
    else:
        content_type = "html" if html else "plain"
        msg = MIMEText(body, content_type)

    msg["to"] = to
    msg["subject"] = subject
    if cc:
        msg["cc"] = cc
    if bcc:
        msg["bcc"] = bcc
    if reply_to:
        msg["In-Reply-To"] = reply_to
        msg["References"] = reply_to

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    result = _request(
        "POST",
        f"{GMAIL_API}/messages/send",
        token=token,
        json_data={"raw": raw},
        provider="gmail",
    )
    return {"id": result.get("id"), "threadId": result.get("threadId"), "status": "sent"}


def read(message_id: str) -> Dict:
    """Read a specific email by message ID."""
    token = _token()
    result = _request(
        "GET",
        f"{GMAIL_API}/messages/{message_id}",
        token=token,
        params={"format": "full"},
        provider="gmail",
    )

    headers = {h["name"].lower(): h["value"] for h in result.get("payload", {}).get("headers", [])}

    # Extract body
    body = ""
    payload = result.get("payload", {})
    if payload.get("body", {}).get("data"):
        body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    elif payload.get("parts"):
        for part in payload["parts"]:
            if part.get("mimeType") in ["text/plain", "text/html"]:
                data = part.get("body", {}).get("data", "")
                if data:
                    body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                    break

    # Extract attachments info
    attachments = []
    for part in payload.get("parts", []):
        if part.get("filename"):
            attachments.append({
                "filename": part["filename"],
                "mimeType": part.get("mimeType"),
                "size": part.get("body", {}).get("size", 0),
                "attachmentId": part.get("body", {}).get("attachmentId"),
            })

    return {
        "id": result.get("id"),
        "threadId": result.get("threadId"),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "subject": headers.get("subject", ""),
        "date": headers.get("date", ""),
        "body": body,
        "snippet": result.get("snippet", ""),
        "labels": result.get("labelIds", []),
        "attachments": attachments,
    }


def search(
    query: str,
    max_results: int = 10,
    label: Optional[str] = None,
) -> List[Dict]:
    """
    Search emails in Gmail.

    Args:
        query: Gmail search query (e.g., "from:user@example.com subject:invoice has:attachment")
        max_results: Maximum number of results (default 10)
        label: Filter by label (e.g., "INBOX", "SENT", "DRAFT")

    Returns:
        List of email summaries
    """
    token = _token()
    params = {"q": query, "maxResults": min(max_results, 50)}
    if label:
        params["labelIds"] = label

    result = _request(
        "GET",
        f"{GMAIL_API}/messages",
        token=token,
        params=params,
        provider="gmail",
    )

    messages = result.get("messages", [])
    emails = []
    for msg in messages[:max_results]:
        try:
            email_data = read(msg["id"])
            emails.append(email_data)
        except Exception as e:
            emails.append({"id": msg["id"], "error": str(e)})

    return emails


def draft(
    to: str,
    subject: str,
    body: str,
    html: bool = False,
) -> Dict:
    """Create a draft email (not sent)."""
    if _via_composio():
        from ._core import composio_execute
        data = _composio_data(composio_execute(
            "GMAIL_CREATE_EMAIL_DRAFT", {"recipient_email": to, "subject": subject, "body": body, "is_html": html}))
        return {"id": data.get("id"), "status": "draft_created", "via": "composio"}
    token = _token()

    content_type = "html" if html else "plain"
    msg = MIMEText(body, content_type)
    msg["to"] = to
    msg["subject"] = subject

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    result = _request(
        "POST",
        f"{GMAIL_API}/drafts",
        token=token,
        json_data={"message": {"raw": raw}},
        provider="gmail",
    )
    return {"id": result.get("id"), "status": "draft_created"}


def list_labels() -> List[Dict]:
    """List all Gmail labels."""
    token = _token()
    result = _request("GET", f"{GMAIL_API}/labels", token=token, provider="gmail")
    return result.get("labels", [])


def download_attachment(message_id: str, attachment_id: str) -> bytes:
    """Download an email attachment."""
    token = _token()
    result = _request(
        "GET",
        f"{GMAIL_API}/messages/{message_id}/attachments/{attachment_id}",
        token=token,
        provider="gmail",
    )
    data = result.get("data", "")
    return base64.urlsafe_b64decode(data)
`;

const CALENDAR_FALLBACK = `"""
AgenticFactor SDK — Google Calendar Module
List, create, update, delete events and find free slots.
"""

import json
import uuid
from datetime import datetime, timedelta
from typing import Optional, List, Dict

from ._core import _get_token, _request

CALENDAR_API = "https://www.googleapis.com/calendar/v3"


def _token():
    return _get_token("google")


def list_events(
    start: Optional[str] = None,
    end: Optional[str] = None,
    calendar_id: str = "primary",
    max_results: int = 50,
    query: Optional[str] = None,
) -> List[Dict]:
    """
    List calendar events in a date range.

    Args:
        start: ISO date string (default: today). e.g., "2024-06-01"
        end: ISO date string (default: start + 7 days)
        calendar_id: Calendar ID (default "primary")
        max_results: Max events to return
        query: Free-text search query
    """
    token = _token()

    if not start:
        start = datetime.utcnow().strftime("%Y-%m-%d")
    if not end:
        end_dt = datetime.fromisoformat(start) + timedelta(days=7)
        end = end_dt.strftime("%Y-%m-%d")

    params = {
        "timeMin": f"{start}T00:00:00Z",
        "timeMax": f"{end}T23:59:59Z",
        "maxResults": min(max_results, 250),
        "singleEvents": "true",
        "orderBy": "startTime",
    }
    if query:
        params["q"] = query

    result = _request(
        "GET",
        f"{CALENDAR_API}/calendars/{calendar_id}/events",
        token=token,
        params=params,
        provider="calendar",
    )

    events = []
    for item in result.get("items", []):
        events.append({
            "id": item.get("id"),
            "summary": item.get("summary", "(No title)"),
            "start": item.get("start", {}).get("dateTime", item.get("start", {}).get("date")),
            "end": item.get("end", {}).get("dateTime", item.get("end", {}).get("date")),
            "location": item.get("location"),
            "description": item.get("description"),
            "attendees": [a.get("email") for a in item.get("attendees", [])],
            "status": item.get("status"),
            "htmlLink": item.get("htmlLink"),
        })

    return events


def create_event(
    summary: str,
    start: str,
    end: str,
    description: Optional[str] = None,
    location: Optional[str] = None,
    attendees: Optional[List[str]] = None,
    calendar_id: str = "primary",
    send_notifications: bool = True,
    timezone: str = "Asia/Kolkata",
    add_meet_link: bool = False,
) -> Dict:
    """
    Create a calendar event.

    Args:
        summary: Event title
        start: ISO datetime string (e.g., "2024-06-15T10:00:00")
        end: ISO datetime string
        description: Event description
        location: Event location
        attendees: List of email addresses
        send_notifications: Send email invitations to attendees
        timezone: Timezone for the event
        add_meet_link: If True, ask Google Calendar to generate a real
            Google Meet link for this event. The returned "meetLink" field
            is the actual link Google created — never invent one yourself.
    """
    token = _token()

    event_body = {
        "summary": summary,
        "start": {"dateTime": start, "timeZone": timezone},
        "end": {"dateTime": end, "timeZone": timezone},
    }
    if description:
        event_body["description"] = description
    if location:
        event_body["location"] = location
    if attendees:
        event_body["attendees"] = [{"email": e} for e in attendees]
    if add_meet_link:
        event_body["conferenceData"] = {
            "createRequest": {
                "requestId": uuid.uuid4().hex,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        }

    params = {}
    if send_notifications:
        params["sendNotifications"] = "true"
    if add_meet_link:
        # Required by the Calendar API for conferenceData to actually be processed
        params["conferenceDataVersion"] = "1"

    result = _request(
        "POST",
        f"{CALENDAR_API}/calendars/{calendar_id}/events",
        token=token,
        json_data=event_body,
        params=params,
        provider="calendar",
    )

    meet_link = result.get("hangoutLink")
    if not meet_link:
        for entry_point in result.get("conferenceData", {}).get("entryPoints", []):
            if entry_point.get("entryPointType") == "video":
                meet_link = entry_point.get("uri")
                break

    return {
        "id": result.get("id"),
        "htmlLink": result.get("htmlLink"),
        "meetLink": meet_link,
        "status": "confirmed",
        "summary": result.get("summary"),
    }


def update_event(
    event_id: str,
    summary: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    description: Optional[str] = None,
    attendees: Optional[List[str]] = None,
    calendar_id: str = "primary",
    timezone: str = "Asia/Kolkata",
) -> Dict:
    """Update an existing calendar event."""
    token = _token()

    existing = _request(
        "GET",
        f"{CALENDAR_API}/calendars/{calendar_id}/events/{event_id}",
        token=token,
        provider="calendar",
    )

    if summary:
        existing["summary"] = summary
    if start:
        existing["start"] = {"dateTime": start, "timeZone": timezone}
    if end:
        existing["end"] = {"dateTime": end, "timeZone": timezone}
    if description is not None:
        existing["description"] = description
    if attendees is not None:
        existing["attendees"] = [{"email": e} for e in attendees]

    result = _request(
        "PUT",
        f"{CALENDAR_API}/calendars/{calendar_id}/events/{event_id}",
        token=token,
        json_data=existing,
        params={"sendNotifications": "true"},
        provider="calendar",
    )
    return {"id": result.get("id"), "status": "updated"}


def delete_event(event_id: str, calendar_id: str = "primary") -> Dict:
    """Delete a calendar event."""
    token = _token()
    _request(
        "DELETE",
        f"{CALENDAR_API}/calendars/{calendar_id}/events/{event_id}",
        token=token,
        provider="calendar",
    )
    return {"status": "deleted", "event_id": event_id}


def find_free_slots(
    duration_minutes: int = 60,
    range_days: int = 7,
    calendars: Optional[List[str]] = None,
    count: int = 5,
    start_hour: int = 9,
    end_hour: int = 18,
    timezone: str = "Asia/Kolkata",
) -> List[Dict]:
    """
    Find free time slots across one or more calendars.

    Args:
        duration_minutes: Required meeting duration
        range_days: Days ahead to search
        calendars: List of calendar IDs to check (default: ["primary"])
        count: Number of free slots to find
        start_hour: Business hours start (default 9 AM)
        end_hour: Business hours end (default 6 PM)
        timezone: Timezone

    Returns:
        List of {"start": "...", "end": "..."} free slots
    """
    token = _token()

    now = datetime.utcnow()
    end_date = now + timedelta(days=range_days)

    calendar_ids = calendars or ["primary"]

    freebusy_body = {
        "timeMin": now.isoformat() + "Z",
        "timeMax": end_date.isoformat() + "Z",
        "timeZone": timezone,
        "items": [{"id": cal} for cal in calendar_ids],
    }

    result = _request(
        "POST",
        f"{CALENDAR_API}/freeBusy",
        token=token,
        json_data=freebusy_body,
        provider="calendar",
    )

    busy_periods = []
    for cal_data in result.get("calendars", {}).values():
        for busy in cal_data.get("busy", []):
            busy_periods.append((
                datetime.fromisoformat(busy["start"].replace("Z", "+00:00")),
                datetime.fromisoformat(busy["end"].replace("Z", "+00:00")),
            ))

    busy_periods.sort()

    free_slots = []
    duration = timedelta(minutes=duration_minutes)

    for day_offset in range(range_days):
        day = now + timedelta(days=day_offset)
        day_start = day.replace(hour=start_hour, minute=0, second=0, microsecond=0)
        day_end = day.replace(hour=end_hour, minute=0, second=0, microsecond=0)

        if day_start < now:
            day_start = now

        slot_start = day_start
        while slot_start + duration <= day_end and len(free_slots) < count:
            slot_end = slot_start + duration

            is_free = True
            for busy_start, busy_end in busy_periods:
                if slot_start < busy_end and slot_end > busy_start:
                    is_free = False
                    slot_start = busy_end
                    break

            if is_free:
                free_slots.append({
                    "start": slot_start.isoformat(),
                    "end": slot_end.isoformat(),
                })
                slot_start = slot_end

        if len(free_slots) >= count:
            break

    return free_slots
`;

const DRIVE_FALLBACK = `"""
AgenticFactor SDK — Google Drive Module
List, read, upload, share files on Google Drive.
"""

import base64
import json
import os
from typing import Optional, List, Dict

from ._core import _get_token, _request

DRIVE_API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"


def _token():
    return _get_token("google")


def list_files(
    query: Optional[str] = None,
    folder_id: Optional[str] = None,
    max_results: int = 20,
    file_type: Optional[str] = None,
) -> List[Dict]:
    """List files in Google Drive."""
    token = _token()
    q_parts = []
    if query:
        q_parts.append(f"name contains '{query}'")
    if folder_id:
        q_parts.append(f"'{folder_id}' in parents")
    if file_type:
        mime_map = {"pdf": "application/pdf", "doc": "application/vnd.google-apps.document",
                    "sheet": "application/vnd.google-apps.spreadsheet", "slide": "application/vnd.google-apps.presentation",
                    "folder": "application/vnd.google-apps.folder"}
        if file_type in mime_map:
            q_parts.append(f"mimeType='{mime_map[file_type]}'")
    q_parts.append("trashed=false")

    params = {"q": " and ".join(q_parts), "pageSize": min(max_results, 100),
              "fields": "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,owners)"}

    result = _request("GET", f"{DRIVE_API}/files", token=token, params=params, provider="drive")
    return result.get("files", [])


def read_file(file_id: str) -> str:
    """Read text content of a Google Drive file (exports Google Docs as plain text)."""
    token = _token()
    meta = _request("GET", f"{DRIVE_API}/files/{file_id}", token=token, params={"fields": "mimeType,name"}, provider="drive")
    mime = meta.get("mimeType", "")

    if mime.startswith("application/vnd.google-apps"):
        export_mime = "text/plain"
        if "spreadsheet" in mime:
            export_mime = "text/csv"
        import requests as req
        headers = {"Authorization": f"Bearer {token}"}
        resp = req.get(f"{DRIVE_API}/files/{file_id}/export", params={"mimeType": export_mime}, headers=headers, timeout=30)
        return resp.text
    else:
        import requests as req
        headers = {"Authorization": f"Bearer {token}"}
        resp = req.get(f"{DRIVE_API}/files/{file_id}", params={"alt": "media"}, headers=headers, timeout=30)
        return resp.text


def upload_file(name: str, content: str, mime_type: str = "text/plain", folder_id: Optional[str] = None) -> Dict:
    """Upload a file to Google Drive."""
    token = _token()
    import requests as req

    metadata = {"name": name, "mimeType": mime_type}
    if folder_id:
        metadata["parents"] = [folder_id]

    headers = {"Authorization": f"Bearer {token}"}

    files_data = {
        "metadata": (None, json.dumps(metadata), "application/json"),
        "file": (name, content.encode() if isinstance(content, str) else content, mime_type),
    }

    resp = req.post(f"{UPLOAD_API}/files?uploadType=multipart", headers=headers, files=files_data, timeout=60)
    result = resp.json()
    return {"id": result.get("id"), "name": result.get("name"), "webViewLink": result.get("webViewLink")}


def share_file(file_id: str, email: str, role: str = "reader") -> Dict:
    """Share a file with someone."""
    token = _token()
    result = _request("POST", f"{DRIVE_API}/files/{file_id}/permissions", token=token,
                      json_data={"type": "user", "role": role, "emailAddress": email},
                      params={"sendNotificationEmail": "true"}, provider="drive")
    return {"status": "shared", "permission_id": result.get("id")}


def create_folder(name: str, parent_id: Optional[str] = None) -> Dict:
    """Create a folder in Google Drive."""
    token = _token()
    metadata = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        metadata["parents"] = [parent_id]
    result = _request("POST", f"{DRIVE_API}/files", token=token, json_data=metadata, provider="drive")
    return {"id": result.get("id"), "name": result.get("name")}
`;

const SHEETS_FALLBACK = `"""
AgenticFactor SDK — Google Sheets Module
Create, read, update spreadsheets via Google Sheets API.
"""

import json
from typing import Optional, List, Dict, Any

from ._core import _get_token, _request

SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
DRIVE_API = "https://www.googleapis.com/drive/v3"


def _token():
    return _get_token("google")


def create(
    title: str,
    data: List[List[Any]],
    sheet_name: str = "Sheet1",
    share_with: Optional[List[str]] = None,
) -> Dict:
    """
    Create a new Google Sheet with data.

    Args:
        title: Spreadsheet title
        data: 2D list of data [[header1, header2], [val1, val2], ...]
        sheet_name: Name of the first sheet
        share_with: List of emails to share with (as editors)

    Returns:
        Dict with spreadsheet ID and URL
    """
    token = _token()

    body = {
        "properties": {"title": title},
        "sheets": [{"properties": {"title": sheet_name}}],
    }

    result = _request("POST", SHEETS_API, token=token, json_data=body, provider="sheets")
    spreadsheet_id = result.get("spreadsheetId")
    url = result.get("spreadsheetUrl")

    if data:
        range_name = f"{sheet_name}!A1"
        _request(
            "PUT",
            f"{SHEETS_API}/{spreadsheet_id}/values/{range_name}",
            token=token,
            params={"valueInputOption": "USER_ENTERED"},
            json_data={"values": data},
            provider="sheets",
        )

    if share_with:
        for email in share_with:
            try:
                _request(
                    "POST",
                    f"{DRIVE_API}/files/{spreadsheet_id}/permissions",
                    token=token,
                    json_data={"type": "user", "role": "writer", "emailAddress": email},
                    params={"sendNotificationEmail": "true"},
                    provider="drive",
                )
            except Exception:
                pass

    return {"spreadsheetId": spreadsheet_id, "url": url, "status": "created"}


def read(spreadsheet_id: str, range_name: str = "Sheet1") -> List[List[Any]]:
    """Read data from a Google Sheet."""
    token = _token()
    result = _request(
        "GET",
        f"{SHEETS_API}/{spreadsheet_id}/values/{range_name}",
        token=token,
        provider="sheets",
    )
    return result.get("values", [])


def update(
    spreadsheet_id: str,
    range_name: str,
    data: List[List[Any]],
) -> Dict:
    """Update cells in a Google Sheet."""
    token = _token()
    result = _request(
        "PUT",
        f"{SHEETS_API}/{spreadsheet_id}/values/{range_name}",
        token=token,
        params={"valueInputOption": "USER_ENTERED"},
        json_data={"values": data},
        provider="sheets",
    )
    return {"updatedCells": result.get("updatedCells"), "status": "updated"}


def append_rows(
    spreadsheet_id: str,
    data: List[List[Any]],
    sheet_name: str = "Sheet1",
) -> Dict:
    """Append rows to the end of a Google Sheet."""
    token = _token()
    result = _request(
        "POST",
        f"{SHEETS_API}/{spreadsheet_id}/values/{sheet_name}:append",
        token=token,
        params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
        json_data={"values": data},
        provider="sheets",
    )
    return {"updatedRows": result.get("updates", {}).get("updatedRows"), "status": "appended"}
`;

const API_FALLBACK = `"""
AgenticFactor SDK — Universal API Caller
Call ANY connector's API using stored OAuth tokens.
Works for any connector that has a token stored in tenant_permissions.
"""

import json
import os
from typing import Optional, Dict, Any, List

from ._core import _get_token, _request, PROVIDER_BASE_URLS, _get_api_key


def call(
    provider: str,
    method: str,
    endpoint: str,
    json_data: Optional[Dict] = None,
    params: Optional[Dict] = None,
    headers: Optional[Dict] = None,
    data: Optional[Any] = None,
    auth_type: str = "oauth",
    api_key_header: str = "Authorization",
) -> Any:
    """
    Universal API caller — works for ANY connector.

    Args:
        provider: Provider name (e.g., "salesforce", "hubspot", "jira")
        method: HTTP method (GET, POST, PUT, PATCH, DELETE)
        endpoint: API endpoint path (e.g., "/crm/v3/objects/contacts")
        json_data: Request body as JSON dict
        params: Query parameters
        headers: Additional headers
        data: Raw request body
        auth_type: "oauth" (Bearer token) or "api_key"
        api_key_header: Header name for API key auth

    Returns:
        API response as dict
    """
    base_url = PROVIDER_BASE_URLS.get(provider.lower(), "")

    env_url = os.environ.get(f"{provider.upper()}_BASE_URL", "")
    if env_url:
        base_url = env_url

    # endpoint may already be a full absolute URL (e.g. an LLM-generated call
    # passing "https://gmail.googleapis.com/...") — prepending base_url in
    # that case doubles the scheme/host into something like
    # "https://www.googleapis.comhttps://gmail.googleapis.com/...", which
    # fails DNS resolution entirely. Use it as-is when it's already absolute.
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        url = endpoint
    else:
        url = f"{base_url}{endpoint}" if base_url else endpoint

    if auth_type == "api_key":
        key_env = f"{provider.upper()}_API_KEY"
        api_key = os.environ.get(key_env, "")
        if not api_key:
            from ._core import _signal_missing_permission
            _signal_missing_permission(provider)
            raise PermissionError(f"API key not found: {key_env}")

        extra_headers = {api_key_header: f"Bearer {api_key}"}
        if headers:
            extra_headers.update(headers)

        return _request(
            method, url, headers=extra_headers,
            json_data=json_data, params=params, data=data,
            provider=provider,
        )
    else:
        token = _get_token(provider)
        return _request(
            method, url, token=token, headers=headers,
            json_data=json_data, params=params, data=data,
            provider=provider,
        )


def linkedin_post(content: str, visibility: str = "PUBLIC") -> Dict:
    """Post to LinkedIn feed."""
    token = _get_token("linkedin_oidc")
    profile = _request("GET", "https://api.linkedin.com/v2/userinfo", token=token, provider="linkedin")
    person_urn = f"urn:li:person:{profile.get('sub', '')}"

    body = {
        "author": person_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": content},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": visibility},
    }

    return _request("POST", "https://api.linkedin.com/v2/ugcPosts", token=token, json_data=body, provider="linkedin")


def slack_send(channel: str, text: str, thread_ts: Optional[str] = None) -> Dict:
    """Send a message to a Slack channel."""
    token = _get_token("slack")
    body = {"channel": channel, "text": text}
    if thread_ts:
        body["thread_ts"] = thread_ts
    return _request("POST", "https://slack.com/api/chat.postMessage", token=token, json_data=body, provider="slack")


def slack_channels() -> List[Dict]:
    """List Slack channels."""
    token = _get_token("slack")
    result = _request("GET", "https://slack.com/api/conversations.list", token=token,
                      params={"types": "public_channel,private_channel", "limit": 100}, provider="slack")
    return result.get("channels", [])


def github_create_issue(owner: str, repo: str, title: str, body: str = "", labels: Optional[List[str]] = None) -> Dict:
    """Create a GitHub issue."""
    token = _get_token("github")
    issue_body = {"title": title, "body": body}
    if labels:
        issue_body["labels"] = labels
    return _request("POST", f"https://api.github.com/repos/{owner}/{repo}/issues", token=token, json_data=issue_body, provider="github")


def github_list_issues(owner: str, repo: str, state: str = "open") -> List[Dict]:
    """List GitHub issues."""
    token = _get_token("github")
    return _request("GET", f"https://api.github.com/repos/{owner}/{repo}/issues", token=token, params={"state": state}, provider="github")


def notion_create_page(parent_id: str, title: str, content: str = "") -> Dict:
    """Create a Notion page."""
    token = _get_token("notion")
    body = {
        "parent": {"page_id": parent_id},
        "properties": {"title": [{"text": {"content": title}}]},
        "children": [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": content}}]}}] if content else [],
    }
    return _request("POST", "https://api.notion.com/v1/pages", token=token, json_data=body,
                    headers={"Notion-Version": "2022-06-28"}, provider="notion")


def notion_query_database(database_id: str, filter_obj: Optional[Dict] = None) -> List[Dict]:
    """Query a Notion database."""
    token = _get_token("notion")
    body = {}
    if filter_obj:
        body["filter"] = filter_obj
    result = _request("POST", f"https://api.notion.com/v1/databases/{database_id}/query", token=token, json_data=body,
                      headers={"Notion-Version": "2022-06-28"}, provider="notion")
    return result.get("results", [])
`;

const SEARCH_FALLBACK = `"""
AgenticFactor SDK — Web Search Module
Search the web via Tavily or SerpAPI.
"""

import os
import json
from typing import Optional, List, Dict

from ._core import _request


def web_search(
    query: str,
    max_results: int = 5,
    search_depth: str = "basic",
    include_answer: bool = True,
) -> Dict:
    """
    Search the web using Tavily API.

    Args:
        query: Search query string
        max_results: Number of results (default 5)
        search_depth: "basic" or "advanced" (advanced costs more)
        include_answer: Include AI-generated answer summary

    Returns:
        Dict with "answer" and "results" list
    """
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        serp_key = os.environ.get("SERPAPI_KEY", "")
        if serp_key:
            return _serpapi_search(query, max_results, serp_key)

        from ._core import _signal_missing_permission
        _signal_missing_permission("TAVILY_API_KEY")
        raise PermissionError("No search API key configured (TAVILY_API_KEY or SERPAPI_KEY)")

    result = _request(
        "POST",
        "https://api.tavily.com/search",
        json_data={
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
            "include_answer": include_answer,
        },
        provider="tavily",
    )

    return {
        "answer": result.get("answer", ""),
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "score": r.get("score", 0),
            }
            for r in result.get("results", [])
        ],
    }


def _serpapi_search(query: str, max_results: int, api_key: str) -> Dict:
    """Fallback to SerpAPI for web search."""
    result = _request(
        "GET",
        "https://serpapi.com/search",
        params={
            "q": query,
            "api_key": api_key,
            "num": max_results,
            "engine": "google",
        },
        provider="serpapi",
    )

    organic = result.get("organic_results", [])
    return {
        "answer": result.get("answer_box", {}).get("answer", ""),
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "content": r.get("snippet", ""),
                "score": 1.0 - (i * 0.1),
            }
            for i, r in enumerate(organic[:max_results])
        ],
    }


def news_search(query: str, max_results: int = 5) -> Dict:
    """Search for news articles."""
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        return web_search(f"{query} news latest", max_results)

    result = _request(
        "POST",
        "https://api.tavily.com/search",
        json_data={
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
            "topic": "news",
        },
        provider="tavily",
    )

    return {
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "published_date": r.get("published_date", ""),
            }
            for r in result.get("results", [])
        ],
    }
`;

const FILES_FALLBACK = `"""
AgenticFactor SDK — File Parsing Module
Parse PDFs, DOCX, CSV, Excel, and text files.
"""

import csv
import io
import json
import os
from typing import List, Dict, Optional


def parse_pdf(file_path_or_data, max_pages: int = 100) -> str:
    """
    Parse a PDF file and extract text content.

    Args:
        file_path_or_data: File path string, bytes content, or base64 string
        max_pages: Maximum pages to extract

    Returns:
        Extracted text content
    """
    try:
        import PyPDF2
    except ImportError:
        try:
            import subprocess
            subprocess.check_call(["pip", "install", "PyPDF2"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            import PyPDF2
        except Exception:
            return "[ERROR: PyPDF2 not available. Cannot parse PDF.]"

    if isinstance(file_path_or_data, str) and os.path.exists(file_path_or_data):
        with open(file_path_or_data, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            text_parts = []
            for i, page in enumerate(reader.pages[:max_pages]):
                text_parts.append(page.extract_text() or "")
            return "\\n\\n".join(text_parts)
    elif isinstance(file_path_or_data, bytes):
        reader = PyPDF2.PdfReader(io.BytesIO(file_path_or_data))
        text_parts = []
        for i, page in enumerate(reader.pages[:max_pages]):
            text_parts.append(page.extract_text() or "")
        return "\\n\\n".join(text_parts)
    elif isinstance(file_path_or_data, str):
        import base64
        try:
            data = base64.b64decode(file_path_or_data)
            return parse_pdf(data, max_pages)
        except Exception:
            return file_path_or_data

    return "[ERROR: Unsupported input type for PDF parsing]"


def parse_docx(file_path_or_data) -> str:
    """Parse a DOCX file and extract text."""
    try:
        from docx import Document
    except ImportError:
        try:
            import subprocess
            subprocess.check_call(["pip", "install", "python-docx"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            from docx import Document
        except Exception:
            return "[ERROR: python-docx not available]"

    if isinstance(file_path_or_data, str) and os.path.exists(file_path_or_data):
        doc = Document(file_path_or_data)
    elif isinstance(file_path_or_data, bytes):
        doc = Document(io.BytesIO(file_path_or_data))
    else:
        return "[ERROR: Unsupported input type]"

    paragraphs = [p.text for p in doc.paragraphs]

    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text for cell in row.cells]
            paragraphs.append(" | ".join(cells))

    return "\\n".join(paragraphs)


def parse_csv(file_path_or_data, delimiter: str = ",") -> List[List[str]]:
    """Parse a CSV file and return as 2D list."""
    if isinstance(file_path_or_data, str) and os.path.exists(file_path_or_data):
        with open(file_path_or_data, "r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f, delimiter=delimiter)
            return list(reader)
    elif isinstance(file_path_or_data, (str, bytes)):
        text = file_path_or_data if isinstance(file_path_or_data, str) else file_path_or_data.decode("utf-8")
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        return list(reader)
    return []


def parse_excel(file_path_or_data, sheet_name: str = None) -> List[List]:
    """Parse an Excel file and return as 2D list."""
    try:
        import openpyxl
    except ImportError:
        try:
            import subprocess
            subprocess.check_call(["pip", "install", "openpyxl"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            import openpyxl
        except Exception:
            return [["ERROR: openpyxl not available"]]

    if isinstance(file_path_or_data, str) and os.path.exists(file_path_or_data):
        wb = openpyxl.load_workbook(file_path_or_data, read_only=True)
    elif isinstance(file_path_or_data, bytes):
        wb = openpyxl.load_workbook(io.BytesIO(file_path_or_data), read_only=True)
    else:
        return [["ERROR: Unsupported input type"]]

    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
    return [[cell.value for cell in row] for row in ws.iter_rows()]


def read_text(file_path: str, encoding: str = "utf-8") -> str:
    """Read a text file."""
    with open(file_path, "r", encoding=encoding) as f:
        return f.read()
`;

const SOCIAL_FALLBACK = `"""
AgenticFactor SDK — Social Media Module
Post, read, and manage content on Twitter/X, LinkedIn, Facebook, and Instagram.

Usage:
    from agenticfactor.social import post_tweet, post_linkedin, post_facebook, post_instagram
"""
import os, json, time, requests
from ._core import _get_token, _request, APIError

def _track_social_api_call(provider: str, action: str, cost_credits: int = 1):
    """Emit a signal to track social API usage for billing."""
    signal = {
        "__social_api_call__": {
            "provider": provider,
            "action": action,
            "cost_credits": cost_credits,
            "timestamp": time.time()
        }
    }
    print(f"__SIGNAL__:{json.dumps(signal)}")


def post_tweet(text: str, reply_to: str = None, media_ids: list = None) -> dict:
    """Post a tweet. Returns the tweet data including id."""
    _track_social_api_call("twitter", "post_create", cost_credits=3)
    token = _get_token("twitter")
    payload = {"text": text}
    if reply_to:
        payload["reply"] = {"in_reply_to_tweet_id": reply_to}
    if media_ids:
        payload["media"] = {"media_ids": media_ids}
    return _request(
        "POST", "https://api.twitter.com/2/tweets",
        token=token, json_data=payload, provider="twitter"
    )

def get_tweets(query: str, max_results: int = 10) -> dict:
    """Search recent tweets."""
    _track_social_api_call("twitter", "posts_read", cost_credits=1)
    token = _get_token("twitter")
    params = {
        "query": query,
        "max_results": min(max(max_results, 10), 100),
        "tweet.fields": "created_at,author_id,public_metrics,text"
    }
    return _request(
        "GET", "https://api.twitter.com/2/tweets/search/recent",
        token=token, params=params, provider="twitter"
    )

def get_twitter_user_me() -> dict:
    """Get the authenticated Twitter user's profile."""
    _track_social_api_call("twitter", "user_read", cost_credits=2)
    token = _get_token("twitter")
    return _request(
        "GET", "https://api.twitter.com/2/users/me",
        token=token, params={"user.fields": "name,username,description,public_metrics,profile_image_url"},
        provider="twitter"
    )

def delete_tweet(tweet_id: str) -> dict:
    """Delete a tweet by ID."""
    _track_social_api_call("twitter", "post_delete", cost_credits=1)
    token = _get_token("twitter")
    return _request(
        "DELETE", f"https://api.twitter.com/2/tweets/{tweet_id}",
        token=token, provider="twitter"
    )


def get_linkedin_profile() -> dict:
    """Get the authenticated LinkedIn user's profile (sub, name, email)."""
    _track_social_api_call("linkedin", "profile_read", cost_credits=0)
    token = _get_token("linkedin_oidc")
    return _request(
        "GET", "https://api.linkedin.com/v2/userinfo",
        token=token, provider="linkedin"
    )

def post_linkedin(text: str, visibility: str = "PUBLIC") -> dict:
    """Post a text update to LinkedIn."""
    _track_social_api_call("linkedin", "post_create", cost_credits=0)
    token = _get_token("linkedin_oidc")

    profile = _request(
        "GET", "https://api.linkedin.com/v2/userinfo",
        token=token, provider="linkedin"
    )
    author = f"urn:li:person:{profile['sub']}"

    payload = {
        "author": author,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE"
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": visibility
        }
    }
    return _request(
        "POST", "https://api.linkedin.com/v2/ugcPosts",
        token=token, json_data=payload, provider="linkedin"
    )

def delete_linkedin_post(post_urn: str) -> dict:
    """Delete a LinkedIn post by URN."""
    _track_social_api_call("linkedin", "post_delete", cost_credits=0)
    token = _get_token("linkedin_oidc")
    return _request(
        "DELETE", f"https://api.linkedin.com/v2/ugcPosts/{post_urn}",
        token=token, provider="linkedin"
    )


def get_facebook_pages() -> list:
    """Get list of Facebook Pages the user manages."""
    _track_social_api_call("facebook", "pages_read", cost_credits=0)
    token = _get_token("facebook")
    result = _request(
        "GET", "https://graph.facebook.com/v19.0/me/accounts",
        token=token, params={"fields": "id,name,access_token"},
        provider="facebook"
    )
    return result.get("data", [])

def post_facebook(page_id: str, message: str, link: str = None, page_token: str = None) -> dict:
    """Post to a Facebook Page."""
    _track_social_api_call("facebook", "post_create", cost_credits=0)
    if not page_token:
        pages = get_facebook_pages()
        page = next((p for p in pages if p["id"] == page_id), None)
        if not page:
            raise APIError(404, f"Page {page_id} not found or not authorized", "facebook")
        page_token = page["access_token"]

    payload = {"message": message}
    if link:
        payload["link"] = link

    return _request(
        "POST", f"https://graph.facebook.com/v19.0/{page_id}/feed",
        token=page_token, json_data=payload, provider="facebook"
    )

def delete_facebook_post(post_id: str, page_token: str = None) -> dict:
    """Delete a Facebook post."""
    _track_social_api_call("facebook", "post_delete", cost_credits=0)
    token = page_token or _get_token("facebook")
    return _request(
        "DELETE", f"https://graph.facebook.com/v19.0/{post_id}",
        token=token, provider="facebook"
    )


def get_instagram_accounts() -> list:
    """Get Instagram Business accounts linked to Facebook Pages."""
    _track_social_api_call("instagram", "account_read", cost_credits=0)
    token = _get_token("facebook")
    pages = _request(
        "GET", "https://graph.facebook.com/v19.0/me/accounts",
        token=token, params={"fields": "id,name,instagram_business_account"},
        provider="instagram"
    )
    accounts = []
    for page in pages.get("data", []):
        ig = page.get("instagram_business_account")
        if ig:
            accounts.append({
                "page_id": page["id"],
                "page_name": page["name"],
                "ig_user_id": ig["id"]
            })
    return accounts

def post_instagram(ig_user_id: str, image_url: str, caption: str = "") -> dict:
    """Post an image to Instagram."""
    _track_social_api_call("instagram", "post_create", cost_credits=0)
    token = _get_token("facebook")

    container = _request(
        "POST", f"https://graph.facebook.com/v19.0/{ig_user_id}/media",
        token=token, json_data={"image_url": image_url, "caption": caption},
        provider="instagram"
    )
    container_id = container["id"]

    import time as _time
    _time.sleep(3)

    return _request(
        "POST", f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish",
        token=token, json_data={"creation_id": container_id},
        provider="instagram"
    )

def get_instagram_media(ig_user_id: str, limit: int = 10) -> list:
    """Get recent media from an Instagram account."""
    _track_social_api_call("instagram", "media_read", cost_credits=0)
    token = _get_token("facebook")
    result = _request(
        "GET", f"https://graph.facebook.com/v19.0/{ig_user_id}/media",
        token=token, params={"fields": "id,caption,media_type,media_url,timestamp,like_count,comments_count", "limit": limit},
        provider="instagram"
    )
    return result.get("data", [])


def post_to_all(text: str, platforms: list = None) -> dict:
    """Post the same content to multiple platforms at once."""
    if platforms is None:
        platforms = []
        for provider, env_key in [("twitter", "TWITTER_ACCESS_TOKEN"), ("linkedin", "LINKEDIN_OIDC_ACCESS_TOKEN"), ("facebook", "FACEBOOK_ACCESS_TOKEN")]:
            if os.environ.get(env_key):
                platforms.append(provider)

    results = {}
    for platform in platforms:
        try:
            if platform == "twitter":
                results["twitter"] = post_tweet(text[:280])
            elif platform == "linkedin":
                results["linkedin"] = post_linkedin(text)
            elif platform == "facebook":
                pages = get_facebook_pages()
                if pages:
                    results["facebook"] = post_facebook(pages[0]["id"], text)
                else:
                    results["facebook"] = {"error": "No Facebook Pages found"}
        except Exception as e:
            results[platform] = {"error": str(e)}

    return results
`;

const CREATIVE_FALLBACK = `"""
AgenticFactor SDK — Creative Generation Module
Image, video, and voice generation via DALL-E, Replicate (Flux), HeyGen, RunwayML, ElevenLabs.
All functions save output to /tmp/ and return the local file path + metadata.
"""

import os
import json
import time
import base64
import requests
from typing import Optional, Dict, Any, List


def _api_key(env_var: str, service: str) -> str:
    key = os.environ.get(env_var, "")
    if not key:
        from ._core import _signal_missing_permission
        _signal_missing_permission(service)
        raise PermissionError(f"Missing API key: {env_var}. Connect {service} in your AgenticFactor connectors.")
    return key


# ── Image Generation ──

def generate_image(
    prompt: str,
    provider: str = "auto",
    width: int = 1024,
    height: int = 1024,
    style: str = "photorealistic",
    save_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate an image from a text prompt.

    Args:
        prompt: Text description of the image to generate
        provider: "dalle" | "replicate" | "auto" (tries DALL-E first, falls back to Replicate)
        width: Image width in pixels (default 1024)
        height: Image height in pixels (default 1024)
        style: "photorealistic" | "illustration" | "digital-art" | "cinematic"
        save_path: Where to save the image (default: /tmp/generated_image_{timestamp}.png)

    Returns:
        Dict with "file_path", "url", "provider", "prompt"
    """
    if save_path is None:
        save_path = f"/tmp/generated_image_{int(time.time())}.png"

    # Style suffix for better results
    style_hints = {
        "photorealistic": "photorealistic, high quality, 8k, professional photography",
        "illustration": "professional illustration, clean lines, vibrant colors",
        "digital-art": "digital art, concept art, detailed",
        "cinematic": "cinematic, dramatic lighting, film still, professional",
    }
    full_prompt = f"{prompt}, {style_hints.get(style, '')}"

    openai_key = os.environ.get("OPENAI_ACCESS_TOKEN", "") or os.environ.get("DALLE_ACCESS_TOKEN", "")
    replicate_key = os.environ.get("REPLICATE_ACCESS_TOKEN", "")

    if provider == "dalle" or (provider == "auto" and openai_key):
        return _dalle_generate(full_prompt, width, height, save_path, openai_key)
    elif provider == "replicate" or (provider == "auto" and replicate_key):
        return _replicate_image(full_prompt, width, height, save_path, replicate_key)
    else:
        raise PermissionError("No image generation API key found. Connect DALL-E (OpenAI) or Replicate in your connectors.")


def _dalle_generate(prompt: str, width: int, height: int, save_path: str, api_key: str) -> Dict:
    size = f"{width}x{height}" if f"{width}x{height}" in ["1024x1024","1792x1024","1024x1792"] else "1024x1024"
    resp = requests.post(
        "https://api.openai.com/v1/images/generations",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": "dall-e-3", "prompt": prompt, "n": 1, "size": size, "quality": "hd"},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    image_url = data["data"][0]["url"]
    img_resp = requests.get(image_url, timeout=60)
    img_resp.raise_for_status()
    with open(save_path, "wb") as f:
        f.write(img_resp.content)
    return {"file_path": save_path, "url": image_url, "provider": "dalle-3", "prompt": prompt, "revised_prompt": data["data"][0].get("revised_prompt", prompt)}


def _replicate_image(prompt: str, width: int, height: int, save_path: str, api_key: str) -> Dict:
    # Use Flux Schnell — fastest high-quality model on Replicate
    resp = requests.post(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Prefer": "wait"},
        json={"input": {"prompt": prompt, "width": width, "height": height, "num_outputs": 1}},
        timeout=120,
    )
    resp.raise_for_status()
    prediction = resp.json()
    # Poll if not complete
    if prediction.get("status") not in ("succeeded", "failed"):
        for _ in range(30):
            time.sleep(3)
            poll = requests.get(f"https://api.replicate.com/v1/predictions/{prediction['id']}",
                                headers={"Authorization": f"Bearer {api_key}"}, timeout=30)
            prediction = poll.json()
            if prediction.get("status") in ("succeeded", "failed"):
                break
    if prediction.get("status") == "failed":
        raise RuntimeError(f"Replicate image generation failed: {prediction.get('error')}")
    image_url = prediction["output"][0] if isinstance(prediction.get("output"), list) else prediction.get("output")
    img_resp = requests.get(image_url, timeout=60)
    img_resp.raise_for_status()
    with open(save_path, "wb") as f:
        f.write(img_resp.content)
    return {"file_path": save_path, "url": image_url, "provider": "replicate-flux", "prompt": prompt}


def generate_image_variations(prompt: str, count: int = 3, **kwargs) -> List[Dict]:
    """Generate multiple image variations for A/B testing (e.g., ad creatives)."""
    results = []
    for i in range(count):
        variation_prompt = f"{prompt} — variation {i+1}"
        save_path = f"/tmp/image_variant_{i+1}_{int(time.time())}.png"
        results.append(generate_image(variation_prompt, save_path=save_path, **kwargs))
    return results


# ── Voice / Audio Generation ──

def text_to_speech(
    text: str,
    voice_id: str = "21m00Tcm4TlvDq8ikWAM",
    voice_name: str = "Rachel",
    stability: float = 0.5,
    similarity_boost: float = 0.75,
    save_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Convert text to speech using ElevenLabs.

    Args:
        text: The text to convert to speech
        voice_id: ElevenLabs voice ID (default: Rachel)
        voice_name: Human-readable voice name (for logging)
        stability: Voice stability 0-1 (higher = more consistent)
        similarity_boost: Voice similarity 0-1 (higher = closer to original)
        save_path: Where to save the MP3 (default: /tmp/speech_{timestamp}.mp3)

    Returns:
        Dict with "file_path", "duration_estimate_seconds", "voice", "characters"
    """
    api_key = _api_key("ELEVENLABS_ACCESS_TOKEN", "ElevenLabs")
    if save_path is None:
        save_path = f"/tmp/speech_{int(time.time())}.mp3"

    resp = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        json={"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": stability, "similarity_boost": similarity_boost}},
        timeout=60,
    )
    resp.raise_for_status()
    with open(save_path, "wb") as f:
        f.write(resp.content)
    chars = len(text)
    duration_estimate = chars / 15  # ~15 chars/sec average speech rate
    return {"file_path": save_path, "duration_estimate_seconds": round(duration_estimate, 1), "voice": voice_name, "characters": chars}


def list_voices() -> List[Dict]:
    """List available ElevenLabs voices."""
    api_key = _api_key("ELEVENLABS_ACCESS_TOKEN", "ElevenLabs")
    resp = requests.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": api_key}, timeout=30)
    resp.raise_for_status()
    voices = resp.json().get("voices", [])
    return [{"voice_id": v["voice_id"], "name": v["name"], "category": v.get("category", ""), "description": v.get("description", "")} for v in voices]


# ── Video Generation ──

def create_presenter_video(
    script: str,
    avatar_id: Optional[str] = None,
    voice_id: Optional[str] = None,
    background: str = "office",
    width: int = 1280,
    height: int = 720,
    save_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create an AI presenter video using HeyGen.
    An avatar reads the script on camera. Best for YouTube videos, product demos, explainers.

    Args:
        script: The text the avatar will speak
        avatar_id: HeyGen avatar ID (uses default if not specified)
        voice_id: HeyGen voice ID (uses avatar default if not specified)
        background: Background style ("office", "studio", "gradient", "transparent")
        width/height: Video dimensions (default 1280x720)
        save_path: Where to save the MP4 (default: /tmp/presenter_video_{timestamp}.mp4)

    Returns:
        Dict with "file_path", "video_id", "duration_seconds", "provider"
    """
    api_key = _api_key("HEYGEN_ACCESS_TOKEN", "HeyGen")
    if save_path is None:
        save_path = f"/tmp/presenter_video_{int(time.time())}.mp4"

    # List available avatars if none specified
    if not avatar_id:
        avatars_resp = requests.get("https://api.heygen.com/v2/avatars", headers={"x-api-key": api_key}, timeout=30)
        if avatars_resp.ok:
            avatars = avatars_resp.json().get("data", {}).get("avatars", [])
            avatar_id = avatars[0]["avatar_id"] if avatars else "default"

    video_payload: Dict[str, Any] = {
        "video_inputs": [{
            "character": {"type": "avatar", "avatar_id": avatar_id, "avatar_style": "normal"},
            "voice": {"type": "text", "input_text": script, "speed": 1.0},
            "background": {"type": "color", "value": "#f0f0f0"} if background == "studio" else {"type": "image", "url": f"https://files.heygen.ai/backgrounds/{background}.jpg"},
        }],
        "dimension": {"width": width, "height": height},
        "aspect_ratio": None,
    }
    if voice_id:
        video_payload["video_inputs"][0]["voice"]["voice_id"] = voice_id

    create_resp = requests.post(
        "https://api.heygen.com/v2/video/generate",
        headers={"x-api-key": api_key, "Content-Type": "application/json"},
        json=video_payload,
        timeout=30,
    )
    create_resp.raise_for_status()
    video_id = create_resp.json()["data"]["video_id"]

    # Poll for completion (HeyGen videos take 1-5 minutes)
    for attempt in range(60):
        time.sleep(10)
        status_resp = requests.get(f"https://api.heygen.com/v1/video_status.get?video_id={video_id}",
                                   headers={"x-api-key": api_key}, timeout=30)
        status_data = status_resp.json().get("data", {})
        status = status_data.get("status", "")
        if status == "completed":
            video_url = status_data.get("video_url", "")
            duration = status_data.get("duration", 0)
            # Download the video
            vid_resp = requests.get(video_url, timeout=300, stream=True)
            vid_resp.raise_for_status()
            with open(save_path, "wb") as f:
                for chunk in vid_resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            return {"file_path": save_path, "video_id": video_id, "duration_seconds": duration, "provider": "heygen", "video_url": video_url}
        elif status == "failed":
            raise RuntimeError(f"HeyGen video generation failed: {status_data.get('error')}")

    raise TimeoutError(f"HeyGen video generation timed out after 10 minutes. Video ID: {video_id}")


def generate_video_clip(
    prompt: str,
    duration: int = 5,
    provider: str = "runwayml",
    image_path: Optional[str] = None,
    save_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate a short video clip from a text prompt or image using RunwayML.
    Best for intros, transitions, B-roll footage, and creative visuals.

    Args:
        prompt: Text description of the video to generate
        duration: Video duration in seconds (5 or 10)
        provider: "runwayml" (default)
        image_path: Optional source image for image-to-video (local file path)
        save_path: Where to save the MP4 (default: /tmp/video_clip_{timestamp}.mp4)

    Returns:
        Dict with "file_path", "task_id", "duration_seconds", "provider"
    """
    api_key = _api_key("RUNWAYML_ACCESS_TOKEN", "RunwayML")
    if save_path is None:
        save_path = f"/tmp/video_clip_{int(time.time())}.mp4"

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "X-Runway-Version": "2024-11-06"}

    payload: Dict[str, Any] = {
        "model": "gen4_turbo",
        "promptText": prompt,
        "duration": duration,
        "ratio": "1280:720",
    }

    if image_path and os.path.exists(image_path):
        with open(image_path, "rb") as img_f:
            img_b64 = base64.b64encode(img_f.read()).decode()
        ext = image_path.rsplit(".", 1)[-1].lower()
        mime = "image/png" if ext == "png" else "image/jpeg"
        payload["promptImage"] = f"data:{mime};base64,{img_b64}"

    create_resp = requests.post("https://api.dev.runwayml.com/v1/image_to_video", headers=headers, json=payload, timeout=30)
    create_resp.raise_for_status()
    task_id = create_resp.json()["id"]

    # Poll for completion
    for _ in range(60):
        time.sleep(10)
        poll = requests.get(f"https://api.dev.runwayml.com/v1/tasks/{task_id}", headers=headers, timeout=30)
        task = poll.json()
        status = task.get("status", "")
        if status == "SUCCEEDED":
            video_url = task["output"][0]
            vid_resp = requests.get(video_url, timeout=300, stream=True)
            vid_resp.raise_for_status()
            with open(save_path, "wb") as f:
                for chunk in vid_resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            return {"file_path": save_path, "task_id": task_id, "duration_seconds": duration, "provider": "runwayml", "video_url": video_url}
        elif status == "FAILED":
            raise RuntimeError(f"RunwayML video generation failed: {task.get('error')}")

    raise TimeoutError(f"RunwayML generation timed out. Task ID: {task_id}")


def create_thumbnail(
    title: str,
    subtitle: str = "",
    background_prompt: str = "",
    style: str = "youtube",
    save_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate a YouTube thumbnail or ad banner image.

    Args:
        title: Main text to display on the thumbnail
        subtitle: Secondary text (optional)
        background_prompt: Image description for the background
        style: "youtube" (1280x720) | "square" (1080x1080) | "story" (1080x1920)
        save_path: Where to save the image

    Returns:
        Dict with "file_path", "url", "dimensions"
    """
    dimensions = {"youtube": (1280, 720), "square": (1080, 1080), "story": (1080, 1920)}
    w, h = dimensions.get(style, (1280, 720))

    full_prompt = (
        f"YouTube thumbnail, bold eye-catching design, text overlay space: '{title}'"
        + (f", subtitle: '{subtitle}'" if subtitle else "")
        + (f", background: {background_prompt}" if background_prompt else ", vibrant background")
        + ", professional, high contrast, 4K quality"
    )
    if save_path is None:
        save_path = f"/tmp/thumbnail_{int(time.time())}.png"

    return generate_image(full_prompt, width=w, height=h, save_path=save_path)
`;

// SDK file list — all fallbacks are embedded so Vercel serverless works even if
// outputFileTracing doesn't include the .py files from src/lib/sandbox/agenticfactor/
const SDK_FILES: { name: string; fallback: string }[] = [
  { name: '__init__.py', fallback: INIT_FALLBACK },
  { name: '_core.py', fallback: CORE_FALLBACK },
  { name: 'gmail.py', fallback: GMAIL_FALLBACK },
  { name: 'calendar.py', fallback: CALENDAR_FALLBACK },
  { name: 'drive.py', fallback: DRIVE_FALLBACK },
  { name: 'sheets.py', fallback: SHEETS_FALLBACK },
  { name: 'api.py', fallback: API_FALLBACK },
  { name: 'search.py', fallback: SEARCH_FALLBACK },
  { name: 'files.py', fallback: FILES_FALLBACK },
  { name: 'social.py', fallback: SOCIAL_FALLBACK },
  { name: 'creative.py', fallback: CREATIVE_FALLBACK },
  { name: 'buffer.py', fallback: BUFFER_FALLBACK },
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
