"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Template {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  tags: string[];
  is_featured: boolean;
  use_count: number;
}

const CATEGORIES = [
  { key: '', label: 'All', icon: '🌐' },
  { key: 'outreach', label: 'Outreach', icon: '📧' },
  { key: 'reporting', label: 'Reporting', icon: '📊' },
  { key: 'research', label: 'Research', icon: '🔍' },
  { key: 'crm', label: 'CRM', icon: '👥' },
  { key: 'devtools', label: 'Dev Tools', icon: '🐙' },
  { key: 'marketing', label: 'Marketing', icon: '📱' },
  { key: 'payments', label: 'Payments', icon: '💳' },
  { key: 'productivity', label: 'Productivity', icon: '📝' },
  { key: 'support', label: 'Support', icon: '🎧' },
];

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [forking, setForking] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchTemplates = useCallback(async (cat: string) => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    const res = await fetch(`/api/templates?${params}`);
    if (res.ok) {
      const data = await res.json() as { templates: Template[] };
      setTemplates(data.templates);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(category); }, [category, fetchTemplates]);

  const forkTemplate = async (slug: string) => {
    setForking(slug);
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    if (res.ok) {
      const data = await res.json() as { mission_id: string };
      router.push(`/dashboard/missions/${data.mission_id}`);
    } else {
      setForking(null);
    }
  };

  const filtered = templates.filter(t =>
    !search || t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase()) ||
    t.tags.some(tag => tag.includes(search.toLowerCase()))
  );

  const card: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 'var(--space-lg)',
  };

  return (
    <div className="page-container stack" style={{ gap: 'var(--space-lg)', maxWidth: 1100 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '1.5rem' }}>Mission Templates</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>
          Pre-built mission blueprints. Fork any template to create a new mission in one click.
        </div>
      </div>

      {/* Search + filter row */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: 'var(--space-sm) var(--space-md)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '0.9rem' }}
        />
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid var(--border)',
              background: category === c.key ? 'var(--accent)' : 'var(--surface)',
              color: category === c.key ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: '0.82rem' }}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {/* Featured */}
      {!category && !search && filtered.some(t => t.is_featured) && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 'var(--space-md)', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            ⭐ Featured
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
            {filtered.filter(t => t.is_featured).map(t => (
              <TemplateCard key={t.slug} template={t} onFork={forkTemplate} forking={forking} />
            ))}
          </div>
        </div>
      )}

      {/* All templates */}
      <div>
        {(!category && !search) && (
          <div style={{ fontWeight: 600, marginBottom: 'var(--space-md)', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            All Templates ({filtered.filter(t => !t.is_featured || category || search).length})
          </div>
        )}
        {loading ? (
          <div style={{ ...card, color: 'var(--text-muted)' }}>Loading templates...</div>
        ) : filtered.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>
            No templates found{search ? ` for "${search}"` : ''}.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
            {filtered.filter(t => !t.is_featured || category || search).map(t => (
              <TemplateCard key={t.slug} template={t} onFork={forkTemplate} forking={forking} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template: t, onFork, forking }: { template: Template; onFork: (slug: string) => void; forking: string | null }) {
  const isBusy = forking === t.slug;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
      transition: 'border-color 0.15s', cursor: 'default',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: '2rem', flexShrink: 0 }}>{t.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t.title}</div>
          {t.is_featured && (
            <span style={{ fontSize: '0.7rem', background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
              color: 'var(--accent)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>FEATURED</span>
          )}
        </div>
      </div>
      <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>
        {t.description}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {t.tags.slice(0, 4).map(tag => (
          <span key={tag} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 10,
            background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {tag}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {t.use_count > 0 ? `Used ${t.use_count}×` : 'New template'}
        </span>
        <button className="btn btn-primary" onClick={() => onFork(t.slug)} disabled={isBusy}
          style={{ padding: '6px 16px', fontSize: '0.85rem' }}>
          {isBusy ? 'Creating...' : '⚡ Use Template'}
        </button>
      </div>
    </div>
  );
}
