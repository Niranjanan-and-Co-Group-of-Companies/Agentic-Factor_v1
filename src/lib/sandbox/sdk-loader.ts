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
  "twitter": "https://api.twitter.com/2", "facebook": "https://graph.facebook.com/v19.0",
  "instagram": "https://graph.facebook.com/v19.0",
}
`;

const INIT_FALLBACK = `
__version__ = "1.1.0"
from . import gmail, calendar, drive, sheets, search, files, api, social
from ._core import ask_user, notify_user, schedule_check
__all__ = ["gmail","calendar","drive","sheets","search","files","api","social","ask_user","notify_user","schedule_check"]
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
    token = _get_token("linkedin")
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
