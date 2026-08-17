"""
AgenticFactor SDK — Buffer Social Media Module
Schedule and publish posts to Facebook Pages, Instagram Business, LinkedIn, and Twitter
via Buffer's pre-approved social media API. No Meta app review required.

Usage:
    from agenticfactor import buffer

    profiles = buffer.buffer_get_profiles()
    linkedin_ids = [p['id'] for p in profiles if p['service'] == 'linkedin']
    buffer.buffer_post_text(linkedin_ids, "Hello LinkedIn!")
"""
import os
import json
import time
import requests
from typing import Optional, List, Dict, Any

BUFFER_BASE = "https://api.bufferapp.com/1"


def _token() -> str:
    token = os.environ.get("BUFFER_API_KEY", "")
    if not token:
        signal = {"__missing_permission__": {"provider": "buffer", "timestamp": time.time()}}
        print(f"__SIGNAL__:{json.dumps(signal)}")
        raise PermissionError("BUFFER_API_KEY not set — connect Buffer in the Connectors page.")
    return token


def _req(method: str, path: str, **kwargs) -> Any:
    token = _token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded"}
    resp = requests.request(
        method, f"{BUFFER_BASE}{path}",
        headers=headers, timeout=30, **kwargs
    )
    if resp.status_code >= 400:
        try:
            err = resp.json()
        except Exception:
            err = resp.text
        raise RuntimeError(f"[Buffer] HTTP {resp.status_code}: {err}")
    try:
        return resp.json()
    except Exception:
        return {"status": resp.status_code, "text": resp.text}


# ── Public API ─────────────────────────────────────────────────────────────────

def buffer_get_profiles() -> List[Dict]:
    """Return all social media profiles connected to this Buffer account.

    Returns list of dicts with keys:
        id (str)               — profile ID used in post calls
        service (str)          — 'facebook', 'instagram', 'linkedin', 'twitter', etc.
        service_username (str) — handle or page name
        formatted_username (str)
        avatar (str)           — profile image URL
    """
    data = _req("GET", "/profiles.json")
    profiles = []
    for p in (data if isinstance(data, list) else []):
        profiles.append({
            "id": p.get("id", ""),
            "service": p.get("service", ""),
            "service_username": p.get("service_username", ""),
            "formatted_username": p.get("formatted_username", ""),
            "avatar": p.get("avatar", ""),
        })
    return profiles


def buffer_post_text(
    profile_ids: List[str],
    text: str,
    scheduled_at: Optional[str] = None,
    now: bool = False,
) -> Dict:
    """Create a text post on one or more social profiles.

    Args:
        profile_ids:  List of profile IDs from buffer_get_profiles()
        text:         Post content (plain text)
        scheduled_at: ISO 8601 datetime string (e.g. "2024-06-15T09:00:00Z").
                      If None, post is added to the queue at the next scheduled slot.
        now:          If True, publish immediately instead of queuing.

    Returns:
        Buffer API response with update IDs and status.
    """
    data: Dict[str, Any] = {"text": text}
    for i, pid in enumerate(profile_ids):
        data[f"profile_ids[{i}]"] = pid
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    if now:
        data["now"] = "true"
    return _req("POST", "/updates/create.json", data=data)


def buffer_post_image(
    profile_ids: List[str],
    text: str,
    image_url: str,
    scheduled_at: Optional[str] = None,
    now: bool = False,
) -> Dict:
    """Create an image post on one or more social profiles.

    Args:
        profile_ids: List of profile IDs from buffer_get_profiles()
        text:        Post caption/text
        image_url:   Publicly accessible URL of the image
        scheduled_at: ISO 8601 datetime to schedule; None = next queue slot
        now:         If True, publish immediately

    Returns:
        Buffer API response with update IDs and status.
    """
    data: Dict[str, Any] = {
        "text": text,
        "media[photo]": image_url,
        "media[thumbnail]": image_url,
    }
    for i, pid in enumerate(profile_ids):
        data[f"profile_ids[{i}]"] = pid
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    if now:
        data["now"] = "true"
    return _req("POST", "/updates/create.json", data=data)


def buffer_create_post(
    profile_ids: List[str],
    text: str,
    media: Optional[Dict[str, str]] = None,
    scheduled_at: Optional[str] = None,
    now: bool = False,
) -> Dict:
    """Unified post creator — handles text-only and media posts.

    Args:
        profile_ids: List of profile IDs from buffer_get_profiles()
        text:        Post content
        media:       Optional dict with keys 'photo' (URL) and/or 'thumbnail' (URL)
        scheduled_at: ISO 8601 datetime; None = next queue slot
        now:         If True, publish immediately

    Returns:
        Buffer API response.
    """
    data: Dict[str, Any] = {"text": text}
    for i, pid in enumerate(profile_ids):
        data[f"profile_ids[{i}]"] = pid
    if media:
        if "photo" in media:
            data["media[photo]"] = media["photo"]
        if "thumbnail" in media:
            data["media[thumbnail]"] = media["thumbnail"]
        if "link" in media:
            data["media[link]"] = media["link"]
        if "title" in media:
            data["media[title]"] = media["title"]
        if "description" in media:
            data["media[description]"] = media["description"]
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    if now:
        data["now"] = "true"
    return _req("POST", "/updates/create.json", data=data)


def buffer_get_pending(profile_id: str) -> List[Dict]:
    """Get all pending (queued) updates for a specific profile.

    Args:
        profile_id: Profile ID from buffer_get_profiles()

    Returns:
        List of pending update dicts.
    """
    data = _req("GET", f"/profiles/{profile_id}/updates/pending.json")
    if isinstance(data, dict):
        return data.get("updates", [])
    return data if isinstance(data, list) else []


def buffer_delete_update(update_id: str) -> Dict:
    """Delete a queued (pending) update.

    Args:
        update_id: The update ID returned by buffer_post_text / buffer_post_image

    Returns:
        {"success": True} on success.
    """
    return _req("POST", f"/updates/{update_id}/destroy.json")
