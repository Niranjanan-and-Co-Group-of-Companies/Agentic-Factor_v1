"""
AgenticFactor SDK — Buffer Social Media Module
Publish posts to Facebook Pages, Instagram Business, LinkedIn, Twitter, TikTok,
Threads, Bluesky, Pinterest, and more via Buffer's GraphQL API.

Buffer already has Meta's approval — no separate Facebook/Instagram app review needed.

Usage:
    from agenticfactor import buffer

    # Get all connected social channels
    channels = buffer.buffer_get_channels()
    linkedin = [c for c in channels if c['service'] == 'linkedin']
    facebook = [c for c in channels if c['service'] == 'facebook']

    # Post to LinkedIn and Facebook
    buffer.buffer_create_post(linkedin[0]['id'], "Hello LinkedIn!")
    buffer.buffer_create_post(facebook[0]['id'], "Hello Facebook!", now=True)
"""
import os
import json
import time
import requests
from typing import Optional, List, Dict, Any

BUFFER_GQL = "https://api.buffer.com"


def _token() -> str:
    token = os.environ.get("BUFFER_API_KEY", "")
    if not token:
        signal = {"__missing_permission__": {"provider": "buffer", "timestamp": time.time()}}
        print(f"__SIGNAL__:{json.dumps(signal)}")
        raise PermissionError("BUFFER_API_KEY not set — connect Buffer in the Connectors page.")
    return token


def _gql(query: str, variables: Optional[Dict] = None) -> Dict:
    """Execute a GraphQL query/mutation against the Buffer API."""
    token = _token()
    resp = requests.post(
        BUFFER_GQL,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": query, "variables": variables or {}},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"[Buffer] HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if data.get("errors"):
        raise RuntimeError(f"[Buffer] GraphQL error: {data['errors']}")
    return data.get("data", {})


# ── Public API ─────────────────────────────────────────────────────────────────

def buffer_get_channels() -> List[Dict]:
    """Return all social media channels connected to this Buffer account.

    First fetches organization IDs, then fetches channels for each org.

    Returns list of dicts:
        id (str)           — channel ID used in createPost calls
        service (str)      — 'facebook', 'instagram', 'linkedin', 'twitter',
                             'tiktok', 'threads', 'bluesky', 'pinterest', etc.
        name (str)         — channel display name (page/profile name)
        displayName (str)  — formatted display name
        avatar (str)       — profile image URL
        organizationId (str)
        isDisconnected (bool)
    """
    account_data = _gql("query { account { organizations { id name } } }")
    orgs = account_data.get("account", {}).get("organizations", [])

    all_channels: List[Dict] = []
    for org in orgs:
        result = _gql(
            """
            query GetChannels($input: ChannelsInput!) {
              channels(input: $input) {
                id
                name
                displayName
                service
                type
                avatar
                organizationId
                isDisconnected
              }
            }
            """,
            variables={"input": {"organizationId": org["id"]}},
        )
        channels = result.get("channels", [])
        all_channels.extend(
            {
                "id": c.get("id", ""),
                "service": c.get("service", ""),
                "name": c.get("name", ""),
                "displayName": c.get("displayName", ""),
                "avatar": c.get("avatar", ""),
                "organizationId": c.get("organizationId", ""),
                "isDisconnected": c.get("isDisconnected", False),
            }
            for c in channels
        )

    return all_channels


def buffer_create_post(
    channel_id: str,
    text: str,
    image_url: Optional[str] = None,
    scheduled_at: Optional[str] = None,
    now: bool = False,
) -> Dict:
    """Create a post on a social channel via Buffer.

    Args:
        channel_id:   Channel ID from buffer_get_channels()
        text:         Post content
        image_url:    Optional publicly accessible image URL to attach
        scheduled_at: ISO 8601 UTC datetime to schedule (e.g. "2024-06-15T09:00:00.000Z").
                      If None and now=False, post is added to the queue at the next slot.
        now:          If True, publish immediately instead of queuing.

    Returns:
        Dict with keys: post_id, text, due_at, status
    """
    mode = "customScheduled" if scheduled_at else "addToQueue"
    scheduling_type = "automatic"

    variables: Dict[str, Any] = {
        "input": {
            "text": text,
            "channelId": channel_id,
            "schedulingType": scheduling_type,
            "mode": mode,
        }
    }
    if scheduled_at:
        variables["input"]["dueAt"] = scheduled_at
    if image_url:
        variables["input"]["assets"] = [{"url": image_url, "type": "image"}]

    query = """
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
            status
          }
        }
        ... on MutationError {
          message
        }
      }
    }
    """
    result = _gql(query, variables=variables)
    post_result = result.get("createPost", {})
    if "message" in post_result:
        raise RuntimeError(f"[Buffer] Post creation failed: {post_result['message']}")
    post = post_result.get("post", {})
    return {
        "post_id": post.get("id", ""),
        "text": post.get("text", ""),
        "due_at": post.get("dueAt"),
        "status": post.get("status", ""),
    }


def buffer_post_to_multiple(
    channel_ids: List[str],
    text: str,
    image_url: Optional[str] = None,
    scheduled_at: Optional[str] = None,
    now: bool = False,
) -> List[Dict]:
    """Post the same content to multiple channels.

    Args:
        channel_ids:  List of channel IDs from buffer_get_channels()
        text:         Post content
        image_url:    Optional image URL
        scheduled_at: ISO 8601 UTC datetime to schedule (optional)
        now:          If True, publish all immediately

    Returns:
        List of results, one per channel, with keys: channel_id, post_id, status, error
    """
    results = []
    for cid in channel_ids:
        try:
            result = buffer_create_post(cid, text, image_url=image_url, scheduled_at=scheduled_at, now=now)
            results.append({"channel_id": cid, **result})
        except Exception as e:
            results.append({"channel_id": cid, "error": str(e)})
    return results


def buffer_get_posts(channel_id: str, status: str = "queue", first: int = 20) -> List[Dict]:
    """Get queued or sent posts for a channel.

    Args:
        channel_id: Channel ID from buffer_get_channels()
        status:     'queue' (pending), 'sent', or 'draft'
        first:      Max number of posts to return (default 20)

    Returns:
        List of post dicts with keys: id, text, due_at, status
    """
    status_map = {"queue": ["pending"], "sent": ["sent"], "draft": ["draft"]}
    statuses = status_map.get(status, ["pending"])

    result = _gql(
        """
        query GetPosts($first: Int, $input: PostsInput!) {
          posts(first: $first, input: $input) {
            edges {
              node {
                id
                text
                dueAt
                status
              }
            }
          }
        }
        """,
        variables={
            "first": first,
            "input": {
                "filter": {
                    "status": statuses,
                    "channelIds": [channel_id],
                }
            },
        },
    )
    edges = result.get("posts", {}).get("edges", [])
    return [
        {
            "id": e["node"].get("id", ""),
            "text": e["node"].get("text", ""),
            "due_at": e["node"].get("dueAt"),
            "status": e["node"].get("status", ""),
        }
        for e in edges
        if e.get("node")
    ]


def buffer_delete_post(post_id: str) -> Dict:
    """Delete a post by ID.

    Args:
        post_id: Post ID returned by buffer_create_post()

    Returns:
        {"success": True} on success.
    """
    result = _gql(
        """
        mutation DeletePost($input: DeletePostInput!) {
          deletePost(input: $input) {
            ... on PostActionSuccess {
              post { id }
            }
            ... on MutationError {
              message
            }
          }
        }
        """,
        variables={"input": {"postId": post_id}},
    )
    delete_result = result.get("deletePost", {})
    if "message" in delete_result:
        raise RuntimeError(f"[Buffer] Delete failed: {delete_result['message']}")
    return {"success": True, "deleted_id": post_id}
