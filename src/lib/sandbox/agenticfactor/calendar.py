"""
AgenticFactor SDK — Google Calendar Module
List, create, update, delete events and find free slots.
"""

import json
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
    
    params = {}
    if send_notifications:
        params["sendNotifications"] = "true"
    
    result = _request(
        "POST",
        f"{CALENDAR_API}/calendars/{calendar_id}/events",
        token=token,
        json_data=event_body,
        params=params,
        provider="calendar",
    )
    
    return {
        "id": result.get("id"),
        "htmlLink": result.get("htmlLink"),
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
    
    # First get existing event
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
    
    # Use freebusy API
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
    
    # Collect all busy periods
    busy_periods = []
    for cal_data in result.get("calendars", {}).values():
        for busy in cal_data.get("busy", []):
            busy_periods.append((
                datetime.fromisoformat(busy["start"].replace("Z", "+00:00")),
                datetime.fromisoformat(busy["end"].replace("Z", "+00:00")),
            ))
    
    busy_periods.sort()
    
    # Find free slots during business hours
    free_slots = []
    current = now
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
            
            # Check if slot conflicts with any busy period
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
