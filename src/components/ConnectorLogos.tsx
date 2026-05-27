// Connector platform logos as inline SVGs — crisp at any size, no external assets needed
import React from "react";

const logos: Record<string, (size: number) => React.JSX.Element> = {
  google: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
  ),
  linkedin: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#0A66C2"/><path d="M7.5 9.5h-2v7h2v-7zm-1-3.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm10 3.2h-2.1c0 0 0 .9 0 1.4 0 0-1.2-1.6-3-1.6-2.2 0-3.4 1.5-3.4 3.7s1.1 3.5 3.2 3.5c1.5 0 2.4-.8 2.8-1.4h.1v1.2h2.1v-4.3c0-2.7-1.7-2.8-1.7-2.8zm-1.9 5.3c-1.2 0-1.8-.9-1.8-2s.6-2 1.8-2 1.7.9 1.7 2-.6 2-1.7 2z" fill="white"/></svg>
  ),
  github: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.026 2.747-1.026.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" fill="#E6EDF3"/></svg>
  ),
  slack: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/><path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/><path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/><path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/></svg>
  ),
  notion: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#fff"/><path d="M4.459 4.209c.466.377.65.328.99.305l10.298-.7c.342 0 .057-.343-.057-.371l-1.715-1.222c-.514-.38-.12-.833.357-.857l12.238-.833c.643-.057.8.371.414.643l-1.771 1.286c-.2.143-.114.371.086.371l10.528.7c.943.057 1.143.643.743.986l-1.543 1.2c-.171.143-.085.371.086.371l6.4.428c.543.029.657.343.371.6L18.4 19.565c-.257.229-.171.543.114.572l2.914.2c.343.028.4.228.114.428l-8.857 5.143c-.571.343-.943.114-1.2-.228l-2.571-3.886c-.171-.257-.486-.343-.771-.2l-4.286 2.486c-.486.285-.914.057-.971-.4l-.886-11.057c-.028-.4.143-.685.457-.828L4.459 4.209z" fill="#000" transform="scale(0.8) translate(3,3)"/></svg>
  ),
  discord: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#5865F2"/><path d="M16.942 7.132a12.52 12.52 0 0 0-3.09-.96.047.047 0 0 0-.05.024c-.133.237-.281.546-.384.79a11.56 11.56 0 0 0-3.466 0 8.001 8.001 0 0 0-.39-.79.049.049 0 0 0-.05-.024 12.5 12.5 0 0 0-3.09.96.044.044 0 0 0-.02.017C4.506 10.088 3.995 12.96 4.246 15.797a.052.052 0 0 0 .02.036 12.578 12.578 0 0 0 3.787 1.914.05.05 0 0 0 .054-.017c.292-.398.552-.818.775-1.259a.048.048 0 0 0-.026-.067 8.28 8.28 0 0 1-1.185-.565.049.049 0 0 1-.005-.081c.08-.06.16-.121.236-.184a.047.047 0 0 1 .049-.007c2.487 1.135 5.18 1.135 7.637 0a.047.047 0 0 1 .05.006c.076.063.157.125.237.185a.049.049 0 0 1-.004.08 7.777 7.777 0 0 1-1.186.566.048.048 0 0 0-.026.068c.228.441.487.86.774 1.258a.048.048 0 0 0 .054.018 12.54 12.54 0 0 0 3.793-1.914.049.049 0 0 0 .02-.035c.3-3.112-.504-5.96-2.131-8.648a.039.039 0 0 0-.02-.018zM9.68 14.16c-.75 0-1.367-.688-1.367-1.533s.605-1.533 1.367-1.533c.769 0 1.381.695 1.367 1.533 0 .845-.605 1.533-1.367 1.533zm5.052 0c-.75 0-1.367-.688-1.367-1.533s.605-1.533 1.367-1.533c.769 0 1.381.695 1.367 1.533 0 .845-.598 1.533-1.367 1.533z" fill="white"/></svg>
  ),
  zoho: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#C8202B"/><text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill="white" fontFamily="Arial">Z</text></svg>
  ),
  azure: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><path d="M13.05 4.24l-4.26 12.3h-3.5L9.55 4.24h3.5zm-1.12 6.93L17.72 19h-4.2l-3.05-4.68 1.46-3.15zM14.26 4.24L21 16.54l-3.78 2.7-7.43-11.5h4.47z" fill="#0089D6"/></svg>
  ),
  twitter: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#000"/><path d="M13.3 10.75L18.18 5h-1.15l-4.24 4.99L9.32 5H5l5.11 7.53L5 18.5h1.15l4.47-5.26 3.57 5.26H19l-5.3-7.81L13.3 10.75zm-1.58 1.86l-.52-.75L6.7 5.94h1.78l3.33 4.83.52.75 4.33 6.28h-1.78l-3.16-4.59z" fill="white"/></svg>
  ),
  teams: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#6264A7"/><path d="M15.5 8h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2V8zm-1 6H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h5.5v6zM12 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm4 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM9 15h5v2a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-2z" fill="white"/></svg>
  ),
  stripe: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#635BFF"/><path d="M12.5 8.7c0-.7.6-1 1.5-1 1.3 0 3 .4 4.3 1.1V5.2c-1.4-.6-2.9-.8-4.3-.8C11 4.4 9 6 9 8.8c0 4.4 6 3.7 6 5.6 0 .8-.7 1.1-1.7 1.1-1.5 0-3.4-.6-4.9-1.4v3.7c1.7.7 3.3 1 4.9 1 3.1 0 5.2-1.5 5.2-4.4C18.5 10.4 12.5 11.2 12.5 8.7z" fill="white"/></svg>
  ),
  shopify: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#96BF48"/><path d="M15.3 5.4s-.1-.5-.4-.7c-.3-.2-.7-.2-.7-.2l-1.6.1-.4-.4c-.5-.5-1.1-.1-1.1-.1L9.9 4.7c-.4-.9-1.1-.8-1.1-.8-.8.1-1.3 1-1.3 1L6 8.6l8.8-1.6.5-1.6zM10.5 7.9l-3.6.7.9-3.1c.2.2.5.4.8.4.6.2 1.1.1 1.1.1l.8 1.9zm2.2-.4l-1.5.3-.5-1.5s.6-.1.9.1c.4.3.6.5 1.1 1.1zm.6-.1L12.8 6s.4-.1.7.2c.3.3.4.6.4.6l-.6.6z" fill="white"/><path d="M14.9 7.4l-.1.1-5.5 1-1.5 5.5-.7-4.8s.1-.2.3-.3l-.1-.1L6 8.6l1.8 11.2 6.3-1.2c.2-1.4 1.4-9.9 1.4-10l-.6-1.2z" fill="#5E8E3E"/></svg>
  ),
  salesforce: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#00A1E0"/><path d="M10 7c1.1-1 2.5-1.5 4-1.3 1.2.2 2.2.8 3 1.7.6-.3 1.3-.4 2-.3 2 .3 3.3 2 3 4-.2 1.5-1.3 2.7-2.7 3H7.5C5.6 14 4 12.5 4 10.8c0-1.6 1.3-3 3-3.2.5 0 1 .1 1.5.2C9 7.5 9.5 7.2 10 7z" fill="white"/></svg>
  ),
  hubspot: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#FF7A59"/><circle cx="12" cy="12" r="3" fill="none" stroke="white" strokeWidth="1.5"/><circle cx="12" cy="6" r="1.5" fill="white"/><circle cx="12" cy="18" r="1.5" fill="white"/><circle cx="6.5" cy="9" r="1.5" fill="white"/><circle cx="17.5" cy="15" r="1.5" fill="white"/><line x1="12" y1="7.5" x2="12" y2="9" stroke="white" strokeWidth="1.2"/><line x1="12" y1="15" x2="12" y2="16.5" stroke="white" strokeWidth="1.2"/></svg>
  ),
  jira: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#0052CC"/><path d="M12 4L4 12l8 8 8-8-8-8zm0 2.83L17.17 12 12 17.17 6.83 12 12 6.83z" fill="white"/></svg>
  ),
  confluence: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#172B4D"/><path d="M5.5 16.5c.3-.5 1-.6 1.5-.3 1.5 1 3.2 1.5 5 1.5s3.5-.5 5-1.5c.5-.3 1.2-.2 1.5.3s.2 1.2-.3 1.5c-1.8 1.2-4 1.8-6.2 1.8s-4.4-.6-6.2-1.8c-.5-.3-.6-1-.3-1.5z" fill="#1868DB"/><path d="M18.5 7.5c-.3.5-1 .6-1.5.3-1.5-1-3.2-1.5-5-1.5s-3.5.5-5 1.5c-.5.3-1.2.2-1.5-.3s-.2-1.2.3-1.5C7.6 5.3 9.8 4.7 12 4.7s4.4.6 6.2 1.8c.5.3.6 1 .3 1.5z" fill="#1868DB"/></svg>
  ),
  airtable: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#18BFFF"/><path d="M4 8l8-3 8 3v2L12 14 4 10V8z" fill="#FCB400"/><path d="M12 14l8-4v6l-8 4v-6z" fill="#F82B60"/><path d="M12 14L4 10v6l8 4v-6z" fill="#7C39ED"/></svg>
  ),
  twilio: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#F22F46"/><circle cx="12" cy="12" r="6" fill="none" stroke="white" strokeWidth="1.5"/><circle cx="9.5" cy="9.5" r="1.3" fill="white"/><circle cx="14.5" cy="9.5" r="1.3" fill="white"/><circle cx="9.5" cy="14.5" r="1.3" fill="white"/><circle cx="14.5" cy="14.5" r="1.3" fill="white"/></svg>
  ),
  sendgrid: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#1A82E2"/><path d="M8 8h4v4H8V8zm4 0h4v4h-4V8zm-4 4h4v4H8v-4z" fill="white" opacity="0.9"/><path d="M12 12h4v4h-4v-4z" fill="white" opacity="0.5"/></svg>
  ),
  mailchimp: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#FFE01B"/><text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#241C15" fontFamily="Arial">M</text></svg>
  ),
  zendesk: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#03363D"/><path d="M12 6l6 4v8H12V6zM6 6v12h6L6 14V6z" fill="white"/></svg>
  ),
  intercom: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#1F8DED"/><path d="M7 9v6M10 7v10M12 7v10M14 7v10M17 9v6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
  ),
  aws: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#232F3E"/><path d="M8 14c2.5 1.5 5.5 1.5 8 0" stroke="#FF9900" strokeWidth="1.5" fill="none" strokeLinecap="round"/><text x="12" y="12" textAnchor="middle" fontSize="6" fontWeight="800" fill="white" fontFamily="Arial">AWS</text></svg>
  ),
  gcp: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#4285F4"/><path d="M12 7l5 3v4l-5 3-5-3v-4l5-3z" fill="none" stroke="white" strokeWidth="1.3"/><circle cx="12" cy="7" r="1" fill="#EA4335"/><circle cx="17" cy="10" r="1" fill="#FBBC05"/><circle cx="17" cy="14" r="1" fill="#34A853"/><circle cx="12" cy="17" r="1" fill="#4285F4"/><circle cx="7" cy="14" r="1" fill="#EA4335"/><circle cx="7" cy="10" r="1" fill="#FBBC05"/></svg>
  ),
  vercel: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#000"/><path d="M12 6l8 12H4L12 6z" fill="white"/></svg>
  ),
  supabase_ext: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#3ECF8E"/><path d="M13 4v8h5l-6 8v-8H7l6-8z" fill="white"/></svg>
  ),
  firebase: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#1A73E8"/><path d="M7 17L9 5l3 6-2 3L7 17z" fill="#FFA000"/><path d="M17 17L10 14l2-3 5 6z" fill="#F57C00"/><path d="M7 17l5.5-3L17 17H7z" fill="#FFCA28"/></svg>
  ),
  openai_api: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#000"/><path d="M12 4C7.6 4 4 7.6 4 12s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0 14c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z" fill="white" opacity="0.3"/><path d="M12 7v5l3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
  ),
  anthropic_api: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#D4A574"/><path d="M8 17L12 6l4 11h-2.5l-1.5-4.5L10.5 17H8z" fill="white"/></svg>
  ),
  replicate: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#262626"/><rect x="6" y="6" width="4" height="12" rx="1" fill="white"/><rect x="12" y="8" width="4" height="10" rx="1" fill="white" opacity="0.6"/><rect x="18" y="10" width="2" height="8" rx="1" fill="white" opacity="0.3"/></svg>
  ),
  segment: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#52BD94"/><path d="M6 9h12M6 12h8M6 15h10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><circle cx="16" cy="9" r="1.5" fill="white"/></svg>
  ),
  mixpanel: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#7856FF"/><rect x="5" y="13" width="3" height="5" rx="1" fill="white"/><rect x="10.5" y="9" width="3" height="9" rx="1" fill="white"/><rect x="16" y="6" width="3" height="12" rx="1" fill="white"/></svg>
  ),
  google_analytics: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#E37400"/><rect x="5" y="14" width="3" height="4" rx="1.5" fill="white"/><rect x="10.5" y="10" width="3" height="8" rx="1.5" fill="white"/><rect x="16" y="6" width="3" height="12" rx="1.5" fill="white"/></svg>
  ),
  dropbox: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#0061FF"/><path d="M8 6l4 2.5L8 11l-4-2.5L8 6zm8 0l4 2.5L16 11l-4-2.5L16 6zM8 13.5l4-2.5 4 2.5-4 2.5-4-2.5zm-4-5L8 11l4-2.5-4-2.5zm12 0L16 11l-4-2.5 4-2.5z" fill="white"/></svg>
  ),
  box: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#0061D5"/><path d="M6 10l6 4 6-4M6 10V8l6-3 6 3v2M6 10v4l6 4 6-4v-4" fill="none" stroke="white" strokeWidth="1.2"/></svg>
  ),
  google_drive: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><path d="M8.5 5h7l5 8.5H3.5L8.5 5z" fill="#0066DA"/><path d="M15.5 5l5 8.5-3 5.5-5-8.5L15.5 5z" fill="#00AC47"/><path d="M3.5 13.5l3 5.5h11l-3-5.5H3.5z" fill="#EA4335"/></svg>
  ),
  zapier: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#FF4A00"/><path d="M12 6v12M6 12h12M7.8 7.8l8.4 8.4M16.2 7.8L7.8 16.2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
  ),
  make: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#6D00CC"/><circle cx="8" cy="12" r="2.5" fill="none" stroke="white" strokeWidth="1.3"/><circle cx="16" cy="12" r="2.5" fill="none" stroke="white" strokeWidth="1.3"/><line x1="10.5" y1="12" x2="13.5" y2="12" stroke="white" strokeWidth="1.3"/></svg>
  ),
  monday: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#FF3D57"/><circle cx="8" cy="15" r="2" fill="white"/><circle cx="12" cy="11" r="2" fill="#00CA72"/><circle cx="16" cy="8" r="2" fill="#FDAB3D"/></svg>
  ),
  asana: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#F06A6A"/><circle cx="12" cy="7" r="2.5" fill="white"/><circle cx="7" cy="14" r="2.5" fill="white"/><circle cx="17" cy="14" r="2.5" fill="white"/></svg>
  ),
  trello: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#0079BF"/><rect x="5" y="5" width="5.5" height="13" rx="1.5" fill="white"/><rect x="13.5" y="5" width="5.5" height="8" rx="1.5" fill="white"/></svg>
  ),
  paypal: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#003087"/><path d="M9 18l1-6h3c3 0 4.5-2 4.5-4S16 4 13 4H8L5 18h4z" fill="white" opacity="0.5"/><path d="M10 16l1-6h3c3 0 4.5-2 4.5-4S17 2 14 2H9L6 16h4z" fill="white"/></svg>
  ),
  square: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#006AFF"/><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="white" strokeWidth="1.5"/><rect x="9" y="9" width="6" height="6" rx="1" fill="white"/></svg>
  ),
  woocommerce: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#96588A"/><text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="800" fill="white" fontFamily="Arial">Woo</text></svg>
  ),
  bamboohr: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#73C41D"/><path d="M12 5c-1 0-2 4-2 8s1 6 2 6 2-2 2-6-1-8-2-8z" fill="white"/><path d="M8 8c-.5.5-1 4 0 7s2 4 2.5 3.5" stroke="white" strokeWidth="1" fill="none"/><path d="M16 8c.5.5 1 4 0 7s-2 4-2.5 3.5" stroke="white" strokeWidth="1" fill="none"/></svg>
  ),
  workday: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#005CB9"/><circle cx="12" cy="9" r="3" fill="white" opacity="0.8"/><path d="M7 18c0-3 2.2-5 5-5s5 2 5 5" fill="white" opacity="0.6"/></svg>
  ),
  instagram: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor="#FFDC80"/><stop offset="25%" stopColor="#F77737"/><stop offset="50%" stopColor="#C13584"/><stop offset="75%" stopColor="#833AB4"/><stop offset="100%" stopColor="#405DE6"/></linearGradient></defs><rect width="24" height="24" rx="4" fill="url(#ig)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="white" strokeWidth="1.5"/><circle cx="12" cy="12" r="3" fill="none" stroke="white" strokeWidth="1.5"/><circle cx="16.5" cy="7.5" r="1" fill="white"/></svg>
  ),
  tiktok: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#000"/><path d="M16 4v8c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4V6c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6V8.5c.9.5 1.9.8 3 .8V7c-2.8 0-5-1.3-5-3z" fill="white"/></svg>
  ),
  reddit: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#FF4500"/><circle cx="12" cy="13" r="5" fill="white"/><circle cx="9.5" cy="12" r="1" fill="#FF4500"/><circle cx="14.5" cy="12" r="1" fill="#FF4500"/><path d="M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5" fill="none" stroke="#FF4500" strokeWidth="0.8" strokeLinecap="round"/><circle cx="17" cy="7" r="1.5" fill="white"/><line x1="14" y1="5" x2="17" y2="7" stroke="white" strokeWidth="1"/><circle cx="14" cy="5" r="1" fill="white"/></svg>
  ),
  microsoft_teams: (s) => (
    <svg viewBox="0 0 24 24" width={s} height={s}><rect width="24" height="24" rx="4" fill="#6264A7"/><path d="M15.5 8h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2V8zm-1 6H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h5.5v6zM12 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm4 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM9 15h5v2a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-2z" fill="white"/></svg>
  ),
};

// Fallback: colored circle with initial letter
const FallbackLogo = ({ name, size }: { name: string; size: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}>
    <rect width="24" height="24" rx="4" fill="hsl(215, 20%, 25%)"/>
    <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="white" fontFamily="Inter, sans-serif">
      {name.charAt(0).toUpperCase()}
    </text>
  </svg>
);

export function ConnectorLogo({ id, size = 32 }: { id: string; size?: number }) {
  const render = logos[id];
  if (render) return <span style={{ display: 'inline-flex', flexShrink: 0 }}>{render(size)}</span>;
  return <FallbackLogo name={id} size={size} />;
}

export default ConnectorLogo;
