// Brand marks for the landing page, imported by name so only these are bundled.
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/brand/Logo";
import {
  siGmail, siGooglesheets, siGoogledrive, siGooglecalendar, siGoogledocs, siGoogleslides, siGoogleforms, siGooglemeet, siGoogleanalytics,
  siYoutube, siHubspot, siZoho, siShopify, siRazorpay, siStripe, siQuickbooks, siXero, siNotion, siAirtable, siTrello, siAsana,
  siClickup, siJira, siLinear, siTodoist, siGithub, siGitlab, siVercel, siSupabase, siSentry, siMailchimp, siBrevo, siInstagram,
  siFacebook, siX, siReddit, siFigma, siMiro, siDropbox, siBox, siTypeform, siCalendly, siZoom, siDiscord, siTelegram, siWhatsapp,
  siIntercom, siZendesk, siPaypal, siWix, siWebflow, siPerplexity, siPosthog, siMixpanel, siConfluence, siBasecamp,
} from "simple-icons";

/** A brand mark: an SVG path from simple-icons, or an image for brands it doesn't carry. */
export interface BrandIcon { title: string; hex?: string; path?: string; src?: string }

const pick = (i: { title: string; hex: string; path: string }): BrandIcon => ({ title: i.title, hex: i.hex, path: i.path });

export const BRAND = {
  gmail: pick(siGmail), sheets: pick(siGooglesheets), drive: pick(siGoogledrive), calendar: pick(siGooglecalendar),
  docs: pick(siGoogledocs), slides: pick(siGoogleslides), forms: pick(siGoogleforms), meet: pick(siGooglemeet),
  analytics: pick(siGoogleanalytics), youtube: pick(siYoutube), hubspot: pick(siHubspot), zoho: pick(siZoho),
  shopify: pick(siShopify), razorpay: pick(siRazorpay), stripe: pick(siStripe), quickbooks: pick(siQuickbooks),
  xero: pick(siXero), notion: pick(siNotion), airtable: pick(siAirtable), trello: pick(siTrello), asana: pick(siAsana),
  clickup: pick(siClickup), jira: pick(siJira), linear: pick(siLinear), todoist: pick(siTodoist), github: pick(siGithub),
  gitlab: pick(siGitlab), vercel: pick(siVercel), supabase: pick(siSupabase), sentry: pick(siSentry),
  mailchimp: pick(siMailchimp), brevo: pick(siBrevo), instagram: pick(siInstagram), facebook: pick(siFacebook),
  x: pick(siX), reddit: pick(siReddit), figma: pick(siFigma), miro: pick(siMiro), dropbox: pick(siDropbox), box: pick(siBox),
  typeform: pick(siTypeform), calendly: pick(siCalendly), zoom: pick(siZoom), discord: pick(siDiscord),
  telegram: pick(siTelegram), whatsapp: pick(siWhatsapp), intercom: pick(siIntercom), zendesk: pick(siZendesk),
  paypal: pick(siPaypal), wix: pick(siWix), webflow: pick(siWebflow), perplexity: pick(siPerplexity),
  posthog: pick(siPosthog), mixpanel: pick(siMixpanel), confluence: pick(siConfluence), basecamp: pick(siBasecamp),
  // Not in simple-icons: the official mark from Composio's logo service.
  canva: { title: "Canva", src: "https://logos.composio.dev/api/canva" },
} satisfies Record<string, BrandIcon>;

export type BrandKey = keyof typeof BRAND;

export function BrandGlyph({ icon, size = 20, color }: { icon: BrandIcon; size?: number; color?: string }) {
  if (icon.src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon.src} alt={icon.title} width={size} height={size} style={{ display: "block", flexShrink: 0, objectFit: "contain" }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={icon.title} style={{ display: "block", flexShrink: 0 }}>
      <path d={icon.path} fill={color ?? `#${icon.hex ?? "1B1814"}`} />
    </svg>
  );
}

// Brand tiles are always white, so the platform's own mark keeps its light-theme colours there.
const MARK_ON_WHITE = { "--logo-ink": "#201D18" } as CSSProperties;

/** An agent's app in a plan row. "af" is a step the platform does itself (scoring, writing). */
export function AppTile({ brand, className, size = 17 }: { brand: BrandKey | "af"; className?: string; size?: number }) {
  return (
    <span className={className} style={brand === "af" ? MARK_ON_WHITE : undefined}>
      {brand === "af" ? <LogoMark size={size + 6} /> : <BrandGlyph icon={BRAND[brand]} size={size} />}
    </span>
  );
}
