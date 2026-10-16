// Emoji → icon. Older UI strings and server-sent agent icons use emojis; every place that shows one
// renders it through Glyph so the product speaks one visual language (line icons, theme colours).
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AlarmClock, Award, Ban, Bell, BookOpen, Bot, Brain, Briefcase, Building2, Calendar, Camera, ChartColumn, Check, CircleCheck,
  CircleX, Clapperboard, ClipboardList, Clock, Cloud, Code, Coins, Compass, CreditCard, Database, Download, Eye, FileText, Film,
  Flame, FlaskConical, FolderOpen, Gamepad2, Gift, Globe, Hand, Headphones, Hourglass, Image, Inbox, KeyRound, Lightbulb, Link,
  Lock, Magnet, Mail, MapPin, Megaphone, MessageCircle, Mic, Microscope, OctagonX, Package, Palette, PartyPopper, Pause, Pencil,
  Phone, Pin, Play, Plug, Plus, Puzzle, Receipt, Repeat, RefreshCw, Rocket, Ruler, Save, ScrollText, Search, Send, Settings,
  ShieldCheck, ShoppingBag, Smartphone, Sparkle, Sparkles, Square, Star, Tag, Target, Telescope, Timer, Trash2, TrendingUp,
  TriangleAlert, Trophy, Upload, UserRound, Users, Video, Volume2, Wallet, X, Zap,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  "✅": CircleCheck, "✔": Check, "☑": CircleCheck, "❌": CircleX, "✖": X, "⚡": Zap, "⚠": TriangleAlert, "🎯": Target,
  "🚀": Rocket, "🔌": Plug, "💬": MessageCircle, "🗨": MessageCircle, "📎": Link, "📊": ChartColumn, "🔒": Lock, "🔐": Lock,
  "📅": Calendar, "🗓": Calendar, "📋": ClipboardList, "🤖": Bot, "🔍": Search, "🔎": Search, "🔑": KeyRound, "🗝": KeyRound,
  "📧": Mail, "✉": Mail, "📨": Mail, "📩": Mail, "🔗": Link, "🧠": Brain, "⏳": Hourglass, "⌛": Hourglass, "📝": FileText,
  "👥": Users, "✏": Pencil, "🎬": Clapperboard, "🎞": Film, "📄": FileText, "📃": FileText, "🎙": Mic, "🎤": Mic, "⚙": Settings,
  "🎉": PartyPopper, "🥳": PartyPopper, "💳": CreditCard, "⬇": Download, "📥": Inbox, "📤": Upload, "⬆": Upload, "🗑": Trash2,
  "⏰": AlarmClock, "⏱": Timer, "🕒": Clock, "🕐": Clock, "📞": Phone, "☎": Phone, "📈": TrendingUp, "📉": TrendingUp,
  "🐙": Code, "💻": Code, "💼": Briefcase, "✨": Sparkles, "✦": Sparkle, "⏸": Pause, "⏹": Square, "▶": Play, "🛡": ShieldCheck,
  "👤": UserRound, "🪙": Coins, "➕": Plus, "💾": Save, "🎮": Gamepad2, "🐦": MessageCircle, "🎨": Palette, "📣": Megaphone,
  "📢": Megaphone, "🖼": Image, "💰": Wallet, "💸": Wallet, "💡": Lightbulb, "🔭": Telescope, "🔄": RefreshCw, "🔁": Repeat,
  "🛍": ShoppingBag, "🛒": ShoppingBag, "📘": BookOpen, "📚": BookOpen, "📖": BookOpen, "📸": Camera, "☁": Cloud, "🔊": Volume2,
  "🎥": Video, "📹": Video, "📱": Smartphone, "📲": Smartphone, "🎧": Headphones, "🧲": Magnet, "🛑": OctagonX, "🚫": Ban,
  "📐": Ruler, "📦": Package, "★": Star, "⭐": Star, "☆": Star, "🏢": Building2, "📜": ScrollText, "👋": Hand, "🔬": Microscope,
  "🧪": FlaskConical, "🌐": Globe, "🌍": Globe, "🗂": FolderOpen, "📁": FolderOpen, "📂": FolderOpen, "🔔": Bell, "🧾": Receipt,
  "🧭": Compass, "🔥": Flame, "🧩": Puzzle, "📌": Pin, "📍": MapPin, "🏷": Tag, "🗄": Database, "🏆": Trophy, "🏅": Award,
  "🎁": Gift, "👁": Eye, "📡": Send, "🔵": Sparkle, "🟢": CircleCheck, "🔴": CircleX,
};

/** The icon for an emoji (variation selectors ignored), or undefined if it has no mapping. */
export function glyphFor(emoji: string | null | undefined): LucideIcon | undefined {
  if (!emoji) return undefined;
  return MAP[emoji.replace(/[︎️‍]/g, "").trim()];
}

export default function Glyph({ e, size = 16, strokeWidth = 1.75, fallback = Sparkle, style, ...rest }: { e?: string | null; size?: number; strokeWidth?: number; fallback?: LucideIcon | null } & Omit<LucideProps, "ref">) {
  const Icon = glyphFor(e) ?? fallback;
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden {...rest} style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0, ...style }} />;
}
