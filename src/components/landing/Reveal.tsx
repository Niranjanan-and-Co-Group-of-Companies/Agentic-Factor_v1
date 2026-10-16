"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import s from "./landing.module.css";

/** Fades and lifts its content into place the first time it scrolls into view. `i` staggers siblings. */
export default function Reveal({ children, i = 0, className = "", style }: { children: ReactNode; i?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { el.dataset.visible = "true"; return; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { el.dataset.visible = "true"; io.disconnect(); }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${s.reveal} ${className}`} style={{ ...style, ["--i" as string]: i }}>
      {children}
    </div>
  );
}
