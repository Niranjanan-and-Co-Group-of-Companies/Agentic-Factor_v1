"use client";
import { useEffect } from "react";

// Redirect /signup → /login (which handles both modes)
export default function SignupRedirect() {
  useEffect(() => {
    window.location.replace("/login");
  }, []);
  return null;
}
