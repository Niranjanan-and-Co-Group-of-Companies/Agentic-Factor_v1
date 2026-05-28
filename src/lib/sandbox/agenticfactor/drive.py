"""
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
    # Get file metadata first
    meta = _request("GET", f"{DRIVE_API}/files/{file_id}", token=token, params={"fields": "mimeType,name"}, provider="drive")
    mime = meta.get("mimeType", "")
    
    if mime.startswith("application/vnd.google-apps"):
        # Export Google native format
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
    
    from io import BytesIO
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
