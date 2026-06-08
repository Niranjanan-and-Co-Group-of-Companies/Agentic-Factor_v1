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
    "salesforce": "",  # Instance-specific
    "hubspot": "https://api.hubapi.com",
    "jira": "",  # Instance-specific
    "stripe": "https://api.stripe.com/v1",
    "shopify": "",  # Store-specific
    "twilio": "https://api.twilio.com/2010-04-01",
    "sendgrid": "https://api.sendgrid.com/v3",
    "airtable": "https://api.airtable.com/v0",
    "zendesk": "",  # Instance-specific
    "intercom": "https://api.intercom.io",
    "asana": "https://app.asana.com/api/1.0",
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
