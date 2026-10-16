"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import s from "./landing.module.css";

// The theme lives on <html data-theme>, set before first paint; this reads it and follows any change.
const subscribe = (onChange: () => void) => {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
};
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("af-theme", next); } catch { /* private mode */ }
  };
  return (
    <button type="button" className={s.themeBtn} onClick={toggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
      {dark ? "Light" : "Dark"}
    </button>
  );
}
