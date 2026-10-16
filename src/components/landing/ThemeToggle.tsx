"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import s from "./landing.module.css";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.getAttribute("data-theme") === "dark"); }, []);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("af-theme", next); } catch { /* private mode */ }
    setDark(!dark);
  };
  return (
    <button type="button" className={s.themeBtn} onClick={toggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
      {dark ? "Light" : "Dark"}
    </button>
  );
}
