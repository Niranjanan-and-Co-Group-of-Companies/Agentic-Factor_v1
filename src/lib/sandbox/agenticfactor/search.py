"""
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
        # Try SerpAPI fallback
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
