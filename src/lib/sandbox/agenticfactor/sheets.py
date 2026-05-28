"""
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
    
    # Create spreadsheet
    body = {
        "properties": {"title": title},
        "sheets": [{"properties": {"title": sheet_name}}],
    }
    
    result = _request("POST", SHEETS_API, token=token, json_data=body, provider="sheets")
    spreadsheet_id = result.get("spreadsheetId")
    url = result.get("spreadsheetUrl")
    
    # Write data
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
    
    # Share if requested
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
