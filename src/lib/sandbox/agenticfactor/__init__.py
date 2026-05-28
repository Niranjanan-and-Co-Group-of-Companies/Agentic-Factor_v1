"""
AgenticFactor Python SDK
========================

Pre-installed in every E2B sandbox. Provides reliable, tested wrappers
for all connected platform APIs.

Usage in agent Python scripts:
    from agenticfactor import gmail, calendar, drive, sheets, search, api, files
    from agenticfactor._core import ask_user, notify_user, schedule_check

Core Modules:
    gmail     — Send, read, search, draft emails via Gmail API
    calendar  — List, create, update, delete events; find free slots
    drive     — List, read, upload, share files on Google Drive
    sheets    — Create, read, update Google Sheets
    search    — Web search via Tavily/SerpAPI
    files     — Parse PDFs, DOCX, CSV, Excel files
    api       — Universal API caller for ANY connector

Interactive:
    ask_user(question, options)    — Pause and ask user a question
    notify_user(message)           — Send notification to user
    schedule_check(delay, context) — Schedule a future re-check
"""

__version__ = "1.0.0"

from . import gmail
from . import calendar
from . import drive
from . import sheets
from . import search
from . import files
from . import api

from ._core import ask_user, notify_user, schedule_check

__all__ = [
    "gmail",
    "calendar",
    "drive",
    "sheets",
    "search",
    "files",
    "api",
    "ask_user",
    "notify_user",
    "schedule_check",
]
