"use client";
import { useEffect } from "react";

// Redirect /signup → /login in sign-up mode (the page handles both)
export default function SignupRedirect() {
  useEffect(() => {
    window.location.replace("/login?mode=signup");
  }, []);
  return null;
}
