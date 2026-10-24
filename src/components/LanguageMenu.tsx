'use client';
// The language you speak and get replies in — saved in the account (user_metadata.language), so the
// app uses it too. Automatic: replies follow the language you write or speak in.

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Check, Languages } from 'lucide-react';

import { LANGUAGES, languageOf } from '@/lib/contracts';

const supabase = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function LanguageMenu({ compact = false }: { compact?: boolean }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const client = supabase();
    const read = (meta: Record<string, unknown> | undefined) => setCurrent(typeof meta?.language === 'string' ? meta.language : null);
    client.auth.getUser().then(({ data }) => read(data.user?.user_metadata)).catch(() => {});
    const { data } = client.auth.onAuthStateChange((_e, session) => read(session?.user.user_metadata));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const choose = async (code: string | null) => {
    setSaving(true);
    setError(null);
    const { error: e } = await supabase().auth.updateUser({ data: { language: code } });
    setSaving(false);
    if (e) return setError('Couldn’t change the language. Please try again.');
    setCurrent(code);
    setOpen(false);
  };

  const chosen = languageOf(current);
  const options = [{ code: null as string | null, label: 'Automatic', hint: 'Follows what you write or say' },
    ...LANGUAGES.map(l => ({ code: l.code as string | null, label: l.native, hint: l.native === l.name ? '' : l.name }))];

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`Language: ${chosen?.name ?? 'Automatic'}`}
        aria-label={`Language: ${chosen?.name ?? 'Automatic'}. Change`}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 7px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem' }}
      >
        <Languages size={14} strokeWidth={1.75} />
        {!compact && <span>{chosen ? chosen.native : 'Auto'}</span>}
      </button>
      {open && (
        <div role="listbox" aria-label="Language" style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, zIndex: 50, width: 240, maxHeight: 360, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 28px rgba(0,0,0,0.18)', padding: 6,
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '6px 8px 8px' }}>
            The language you speak and get replies in. Choosing one makes voice input more accurate.
          </div>
          {options.map(o => {
            const on = (o.code ?? null) === (chosen?.code ?? null);
            return (
              <button
                key={o.code ?? 'auto'}
                type="button"
                role="option"
                aria-selected={on}
                disabled={saving}
                onClick={() => void choose(o.code)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', border: 'none', borderRadius: 6,
                  background: on ? 'var(--bg-secondary)' : 'none', cursor: saving ? 'wait' : 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontSize: '0.82rem',
                }}
              >
                <span style={{ flex: 1 }}>{o.label}{o.hint && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: 6 }}>{o.hint}</span>}</span>
                {on && <Check size={14} />}
              </button>
            );
          })}
          {error && <div style={{ fontSize: '0.72rem', color: 'var(--rose)', padding: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
