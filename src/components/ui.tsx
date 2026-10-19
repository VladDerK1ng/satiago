import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { haptic } from '../platform/haptics';
export { Sheet } from '../ui/Sheet';

export function Page({ title, back, actions, children }: { title: string; back?: boolean; actions?: ReactNode; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <>
      <header className="page">
        {back && (
          <button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}>
            ←
          </button>
        )}
        <h1 className="ellipsis">{title}</h1>
        {actions}
      </header>
      {children}
    </>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => (haptic('select'), onChange(e.target.checked))} />
      <span />
    </label>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => (o.value !== value && haptic('select'), onChange(o.value))}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="row setting-row" style={{ padding: '10px 0' }}>
      <div className="grow">
        <div>{title}</div>
        {desc && <div className="muted small">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function NumField({
  value,
  onChange,
  step = 1,
  min,
  placeholder,
  className = 'field',
  ariaLabel,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      className={className}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Number(v));
      }}
    />
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div style={{ fontSize: '2rem' }}>{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)', margin: '6px 0' }}>{title}</div>
      {children}
    </div>
  );
}

export const confirmDo = (msg: string, fn: () => void) => {
  if (window.confirm(msg)) fn();
};
