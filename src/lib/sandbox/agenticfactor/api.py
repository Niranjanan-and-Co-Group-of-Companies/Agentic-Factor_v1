"""
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
    Universal API caller — works for ANY connector including custom ones.

    For custom connectors added via the Connectors page, use:
        api.call('custom_<slug>', 'GET', 'https://full.url/path', ...)
    The base URL, auth type, and auth header are read automatically from env vars
    injected by the platform (CUSTOM_<SLUG>_BASE_URL, CUSTOM_<SLUG>_AUTH_TYPE,
    CUSTOM_<SLUG>_AUTH_HEADER). No hardcoding needed.

    Args:
        provider: Provider name (e.g., "hubspot", "slack", "custom_jira")
        method: HTTP method (GET, POST, PUT, PATCH, DELETE)
        endpoint: API endpoint path or full URL for custom connectors
        json_data: Request body as JSON dict
        params: Query parameters
        headers: Additional headers
        data: Raw request body
        auth_type: "oauth" (Bearer token) or "api_key" — overridden automatically
                   for custom connectors that have CUSTOM_*_AUTH_TYPE set
        api_key_header: Header name for API key auth

    Returns:
        API response as dict
    """
    slug = provider.upper()
    base_url = PROVIDER_BASE_URLS.get(provider.lower(), "")

    # Check for instance-specific URL from env (covers custom connectors and
    # instance-based ones like Salesforce, Zendesk, Jira)
    env_url = os.environ.get(f"{slug}_BASE_URL", "")
    if env_url:
        base_url = env_url

    url = f"{base_url}{endpoint}" if base_url else endpoint

    # For custom connectors, read auth type and header from env vars injected
    # by the platform so agents don't need to hardcode connection details.
    if provider.lower().startswith("custom_"):
        token = os.environ.get(f"{slug}_ACCESS_TOKEN", "")
        if not token:
            from ._core import _signal_missing_permission
            _signal_missing_permission(provider)
            raise PermissionError(
                f"Custom connector '{provider}' is not connected. "
                f"Add it on the Connectors page (API key required)."
            )
        resolved_auth_type = os.environ.get(f"{slug}_AUTH_TYPE", "bearer").lower()
        custom_header_name  = os.environ.get(f"{slug}_AUTH_HEADER", "")
        import base64 as _b64mod
        if custom_header_name:
            auth_headers = {custom_header_name: token}
        elif resolved_auth_type == "apikey":
            auth_headers = {"X-API-Key": token}
        elif resolved_auth_type == "basic":
            auth_headers = {"Authorization": f"Basic {_b64mod.b64encode(token.encode()).decode()}"}
        elif resolved_auth_type == "token":
            auth_headers = {"Authorization": f"Token {token}"}
        else:
            auth_headers = {"Authorization": f"Bearer {token}"}
        if headers:
            auth_headers.update(headers)
        return _request(method, url, headers=auth_headers,
                        json_data=json_data, params=params, data=data,
                        provider=provider)

    if auth_type == "api_key":
        key_env = f"{slug}_API_KEY"
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


# ============================================================
# CONVENIENCE WRAPPERS FOR COMMON PROVIDERS
# ============================================================

def linkedin_post(content: str, visibility: str = "PUBLIC") -> Dict:
    """Post to LinkedIn feed."""
    token = _get_token("linkedin_oidc")
    # Get user profile URN
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
