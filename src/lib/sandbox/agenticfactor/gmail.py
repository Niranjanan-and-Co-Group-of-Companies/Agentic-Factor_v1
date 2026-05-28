"""
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
