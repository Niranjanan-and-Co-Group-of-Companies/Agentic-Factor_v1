/**
 * ConnectorLogos — exact brand logos for every connector.
 *
 * Strategy:
 *  1. simple-icons (npm) — exact official SVG paths + brand hex color for ~3000 brands.
 *  2. Clearbit Logo API   — img fallback for brands not in simple-icons.
 *  3. Letter tile         — last-resort fallback (brand initial on colored bg).
 */

import {
  siGoogle, siGithub, siNotion, siDiscord, siZoho,
  siFacebook, siInstagram, siStripe, siAirtable,
  siJira, siConfluence, siTrello, siAsana, siDropbox, siBox,
  siHubspot, siMailchimp, siIntercom, siReddit,
  siAnthropic, siReplicate, siMixpanel, siVercel, siFirebase,
  siRazorpay, siWoocommerce, siPaypal, siSquare,
  siX, siShopify, siTiktok, siZapier, siMake, siSupabase,
} from 'simple-icons';

// ── simple-icons map: connector id → icon object ────────────────────────────
const SI_MAP: Record<string, { path: string; hex: string }> = {
  google:        siGoogle,
  github:        siGithub,
  notion:        siNotion,
  discord:       siDiscord,
  zoho:          siZoho,
  facebook:      siFacebook,
  instagram:     siInstagram,
  stripe:        siStripe,
  airtable:      siAirtable,
  jira:          siJira,
  confluence:    siConfluence,
  trello:        siTrello,
  asana:         siAsana,
  dropbox:       siDropbox,
  box:           siBox,
  hubspot:       siHubspot,
  mailchimp:     siMailchimp,
  intercom:      siIntercom,
  reddit:        siReddit,
  anthropic_api: siAnthropic,
  replicate:     siReplicate,
  mixpanel:      siMixpanel,
  vercel:        siVercel,
  firebase:      siFirebase,
  razorpay:      siRazorpay,
  woocommerce:   siWoocommerce,
  paypal:        siPaypal,
  square:        siSquare,
  twitter:       siX,
  shopify:       siShopify,
  tiktok:        siTiktok,
  zapier:        siZapier,
  make:          siMake,
  supabase_ext:  siSupabase,
};

// ── Clearbit fallback: connector id → company domain ────────────────────────
const CLEARBIT_MAP: Record<string, string> = {
  slack:        'slack.com',
  twilio:       'twilio.com',
  sendgrid:     'sendgrid.com',
  salesforce:   'salesforce.com',
  openai_api:   'openai.com',
  aws:          'aws.amazon.com',
  microsoft:    'microsoft.com',
  linkedin:     'linkedin.com',
  monday:       'monday.com',
  segment:      'segment.com',
  bamboohr:     'bamboohr.com',
  heygen:       'heygen.com',
  langsmith:    'langchain.com',
  hunter:       'hunter.io',
  shiprocket:   'shiprocket.in',
  workday:      'workday.com',
  zendesk:      'zendesk.com',
  gcp:          'cloud.google.com',
};

// ── Tile fallback brand colors for anything not found above ──────────────────
const TILE_COLORS: Record<string, string> = {
  hunter:        '#F36A5A',
  openai_api:    '#10a37f',
  aws:           '#FF9900',
  microsoft:     '#00A4EF',
  monday:        '#FF3D57',
  salesforce:    '#009EDB',
  sendgrid:      '#1A82E2',
  slack:         '#4A154B',
  linkedin:      '#0A66C2',
  twilio:        '#F22F46',
  bamboohr:      '#73B73B',
  heygen:        '#3D5AF1',
  langsmith:     '#1C1C1C',
  segment:       '#52BD94',
  shiprocket:    '#E31837',
  workday:       '#005CB9',
};

interface Props {
  id: string;
  size?: number;
}

export default function ConnectorLogo({ id, size = 32 }: Props) {
  const icon = SI_MAP[id];
  const clearbitDomain = CLEARBIT_MAP[id];

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.2),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  };

  // 1 — simple-icons: brand SVG on contrasting background
  if (icon) {
    const dark = isDark(icon.hex);
    return (
      <div style={{
        ...containerStyle,
        background: dark ? `#${icon.hex}` : '#ffffff',
        border: dark ? 'none' : '1px solid #e5e7eb',
      }}>
        <svg
          viewBox="0 0 24 24"
          width={size * 0.6}
          height={size * 0.6}
          fill={dark ? '#ffffff' : `#${icon.hex}`}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d={icon.path} />
        </svg>
      </div>
    );
  }

  // 2 — Clearbit: company logo img, letter tile on error
  if (clearbitDomain) {
    return (
      <div style={{ ...containerStyle, background: '#ffffff', border: '1px solid #e5e7eb', position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://logo.clearbit.com/${clearbitDomain}`}
          alt={id}
          width={size * 0.72}
          height={size * 0.72}
          style={{ objectFit: 'contain', borderRadius: 2 }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = 'flex';
          }}
        />
        <span style={{ display: 'none', position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <LetterTile id={id} size={size} />
        </span>
      </div>
    );
  }

  // 3 — Letter tile last resort
  return <LetterTile id={id} size={size} />;
}

function LetterTile({ id, size }: { id: string; size: number }) {
  const bg = TILE_COLORS[id] || '#6366f1';
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.2),
      background: bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      color: '#ffffff',
      fontWeight: 700,
      fontSize: Math.round(size * 0.45),
      fontFamily: 'system-ui, sans-serif',
      userSelect: 'none',
    }}>
      {id.charAt(0).toUpperCase()}
    </div>
  );
}

// Dark background needed when brand color luminance < 55%
function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}
