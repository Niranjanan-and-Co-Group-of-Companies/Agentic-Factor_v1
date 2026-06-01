"""
AgenticFactor SDK — Social Media Module
Post, read, and manage content on Twitter/X, LinkedIn, Facebook, and Instagram.

Usage:
    from agenticfactor.social import post_tweet, post_linkedin, post_facebook, post_instagram
"""
import os, json, time, requests
from ._core import _get_token, _request, APIError

# ── Credit Tracking Signal ──
def _track_social_api_call(provider: str, action: str, cost_credits: int = 1):
    """Emit a signal to track social API usage for billing.
    This is emitted BEFORE the API call so we charge even on failure."""
    signal = {
        "__social_api_call__": {
            "provider": provider,
            "action": action,
            "cost_credits": cost_credits,
            "timestamp": time.time()
        }
    }
    print(f"__SIGNAL__:{json.dumps(signal)}")


# ============================================================
# TWITTER / X — API v2
# ============================================================

def post_tweet(text: str, reply_to: str = None, media_ids: list = None) -> dict:
    """Post a tweet. Returns the tweet data including id.
    
    Args:
        text: Tweet text (max 280 chars)
        reply_to: Optional tweet ID to reply to
        media_ids: Optional list of media IDs (upload media first)
    """
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
    """Search recent tweets.
    
    Args:
        query: Search query string
        max_results: Number of results (10-100)
    """
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


# ============================================================
# LINKEDIN — Share API v2
# ============================================================

def get_linkedin_profile() -> dict:
    """Get the authenticated LinkedIn user's profile (sub, name, email)."""
    _track_social_api_call("linkedin", "profile_read", cost_credits=0)
    token = _get_token("linkedin_oidc")
    return _request(
        "GET", "https://api.linkedin.com/v2/userinfo",
        token=token, provider="linkedin"
    )

def post_linkedin(text: str, visibility: str = "PUBLIC") -> dict:
    """Post a text update to LinkedIn.
    
    Args:
        text: Post content
        visibility: "PUBLIC" or "CONNECTIONS"
    """
    _track_social_api_call("linkedin", "post_create", cost_credits=0)
    token = _get_token("linkedin_oidc")
    
    # First get the user's LinkedIn ID (sub)
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


# ============================================================
# FACEBOOK — Graph API v19.0
# ============================================================

def get_facebook_pages() -> list:
    """Get list of Facebook Pages the user manages.
    Returns list of {id, name, access_token}."""
    _track_social_api_call("facebook", "pages_read", cost_credits=0)
    token = _get_token("facebook")
    result = _request(
        "GET", "https://graph.facebook.com/v19.0/me/accounts",
        token=token, params={"fields": "id,name,access_token"},
        provider="facebook"
    )
    return result.get("data", [])

def post_facebook(page_id: str, message: str, link: str = None, page_token: str = None) -> dict:
    """Post to a Facebook Page.
    
    Args:
        page_id: The Facebook Page ID
        message: Post content
        link: Optional URL to attach
        page_token: Page access token (get from get_facebook_pages())
    """
    _track_social_api_call("facebook", "post_create", cost_credits=0)
    if not page_token:
        # Auto-fetch page token
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


# ============================================================
# INSTAGRAM — Graph API via Facebook
# ============================================================

def get_instagram_accounts() -> list:
    """Get Instagram Business accounts linked to Facebook Pages.
    Returns list of {id, name, ig_user_id}."""
    _track_social_api_call("instagram", "account_read", cost_credits=0)
    token = _get_token("facebook")  # Instagram uses Facebook token
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
    """Post an image to Instagram.
    
    Args:
        ig_user_id: Instagram Business Account ID (from get_instagram_accounts())
        image_url: Public URL of the image to post
        caption: Post caption
    """
    _track_social_api_call("instagram", "post_create", cost_credits=0)
    token = _get_token("facebook")  # Instagram uses Facebook token
    
    # Step 1: Create media container
    container = _request(
        "POST", f"https://graph.facebook.com/v19.0/{ig_user_id}/media",
        token=token, json_data={"image_url": image_url, "caption": caption},
        provider="instagram"
    )
    container_id = container["id"]
    
    # Step 2: Publish the container
    import time as _time
    _time.sleep(3)  # Wait for Instagram to process the image
    
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


# ============================================================  
# MULTI-PLATFORM HELPERS
# ============================================================

def post_to_all(text: str, platforms: list = None) -> dict:
    """Post the same content to multiple platforms at once.
    
    Args:
        text: Content to post
        platforms: List of platforms ["twitter", "linkedin", "facebook"]
                   Defaults to all connected platforms.
    """
    if platforms is None:
        platforms = []
        # Auto-detect connected platforms
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
