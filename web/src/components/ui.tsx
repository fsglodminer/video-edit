import React, { useCallback, useEffect, useRef, useState } from 'react';

export function Button({
  children,
  variant = 'default',
  size = 'md',
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; active?: boolean }) {
  return (
    <button {...props} className={`btn btn-${variant} btn-${size}${active ? ' is-active' : ''}${props.className ? ` ${props.className}` : ''}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children, inline }: { label: string; hint?: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <label className={`field${inline ? ' field-inline' : ''}`}>
      <span className="field-label">
        {label}
        {hint ? <em className="field-hint">{hint}</em> : null}
      </span>
      <span className="field-control">{children}</span>
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" className={`toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span className="toggle-thumb" />
      {label ? <span className="toggle-label">{label}</span> : null}
    </button>
  );
}

/** Number input you can also drag horizontally, like every NLE. */
export function NumberField({
  value,
  onChange,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 2,
  suffix,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  width?: number;
}) {
  const [text, setText] = useState(String(round(value, precision)));
  const dragging = useRef<{ x: number; start: number } | null>(null);

  useEffect(() => {
    if (!dragging.current) setText(String(round(value, precision)));
  }, [value, precision]);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = { x: e.clientX, start: value };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    const delta = (e.clientX - drag.x) * step * (e.shiftKey ? 0.1 : 1);
    const next = clamp(drag.start + delta);
    setText(String(round(next, precision)));
    onChange(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    onCommit?.();
  };

  return (
    <span className="numberfield" style={width ? { width } : undefined}>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(clamp(parsed));
        }}
        onBlur={() => {
          setText(String(round(value, precision)));
          onCommit?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const next = clamp(value + dir * step * (e.shiftKey ? 10 : 1));
            onChange(next);
            setText(String(round(next, precision)));
          }
        }}
        inputMode="decimal"
      />
      <span className="numberfield-grip" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      {suffix ? <em>{suffix}</em> : null}
    </span>
  );
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <span className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      <em>{format ? format(value) : round(value, 2)}</em>
    </span>
  );
}

export function ColorField({ value, onChange, onCommit }: { value: string; onChange: (v: string) => void; onCommit?: () => void }) {
  return (
    <span className="colorfield">
      <input type="color" value={normaliseHex(value)} onChange={(e) => onChange(e.target.value)} onBlur={() => onCommit?.()} />
      <input
        className="colorfield-hex"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.()}
        spellCheck={false}
      />
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, actions, children, scroll }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; scroll?: boolean }) {
  return (
    <section className="panel">
      {title ? (
        <header className="panel-header">
          <h2>{title}</h2>
          <div className="panel-actions">{actions}</div>
        </header>
      ) : null}
      <div className={`panel-body${scroll === false ? '' : ' is-scroll'}`}>{children}</div>
    </section>
  );
}

export function Empty({ icon, title, hint, children }: { icon?: React.ReactNode; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <p className="empty-title">{title}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

/** Runs `fn` and surfaces failures through `onError` instead of the console. */
export function useAsyncAction(onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onError]
  );
  return [busy, run] as const;
}

export const round = (v: number, p = 2) => {
  const f = 10 ** p;
  return Math.round((Number(v) || 0) * f) / f;
};

function normaliseHex(value: string) {
  const v = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff';
}

export const Icon = {
  play: <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>,
  pause: <svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>,
  skipStart: <svg viewBox="0 0 24 24"><path d="M7 5h2v14H7zM19 5.5v13l-9-6.5z" /></svg>,
  skipEnd: <svg viewBox="0 0 24 24"><path d="M15 5h2v14h-2zM5 5.5l9 6.5-9 6.5z" /></svg>,
  split: <svg viewBox="0 0 24 24"><path d="M11 3h2v18h-2z" /><path d="M4 6h5v5H4zM15 13h5v5h-5z" opacity=".55" /></svg>,
  trash: <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7zM9 4h6l1 2H8z" /></svg>,
  undo: <svg viewBox="0 0 24 24"><path d="M7 8h7a5 5 0 0 1 0 10h-4v-2h4a3 3 0 0 0 0-6H7l3 3-1.5 1.5L3.5 9 8.5 4 10 5.5z" /></svg>,
  redo: <svg viewBox="0 0 24 24"><path d="M17 8h-7a5 5 0 0 0 0 10h4v-2h-4a3 3 0 0 1 0-6h7l-3 3 1.5 1.5L20.5 9 15.5 4 14 5.5z" /></svg>,
  magnet: (
    <svg viewBox="0 0 24 24">
      <path d="M4 5h5v7.5a3 3 0 0 0 6 0V5h5v7.5a8 8 0 0 1-16 0z" />
      <path d="M4 15.5h5V19H4zM15 15.5h5V19h-5z" fill="#000" opacity=".38" />
    </svg>
  ),
  text: <svg viewBox="0 0 24 24"><path d="M4 5h16v3h-6v11h-4V8H4z" /></svg>,
  film: <svg viewBox="0 0 24 24"><path d="M3 4h18v16H3zm2 2v2h2V6zm12 0v2h2V6zM5 10v4h14v-4zm0 6v2h2v-2zm12 0v2h2v-2z" /></svg>,
  wave: <svg viewBox="0 0 24 24"><path d="M3 11h2v2H3zm4-4h2v10H7zm4-3h2v16h-2zm4 5h2v6h-2zm4 2h2v2h-2z" /></svg>,
  captions: <svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm4 5h4v1.5H8.5v1H11V14H7zm6 0h4v1.5h-2.5v1H17V14h-4z" /></svg>,
  export: <svg viewBox="0 0 24 24"><path d="M12 3l5 5h-3v7h-4V8H7zM4 18h16v3H4z" /></svg>,
  scissors: <svg viewBox="0 0 24 24"><path d="M6 4l8 10-1.5 2L4 6zM18 4l-8 10 1.5 2L20 6z" /><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="19" r="2.5" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" /></svg>,
  eye: <svg viewBox="0 0 24 24"><path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24"><path d="M3 4.5L19.5 21 21 19.5 4.5 3zM12 5c5 0 9 4.5 9 7 0 1-.7 2.3-1.8 3.5l-2.2-2.2A3.5 3.5 0 0 0 12 8.5c-.4 0-.8.1-1.2.2L8.9 6.8A9.6 9.6 0 0 1 12 5zM4.8 8.5l2.3 2.3a3.5 3.5 0 0 0 4.6 4.6l1.7 1.7c-.4.1-.9.1-1.4.1-5 0-9-4.5-9-7 0-.5.6-1.5 1.8-2.7z" /></svg>,
  volume: <svg viewBox="0 0 24 24"><path d="M4 9h3l4-4v14l-4-4H4zM15 8.5a5 5 0 0 1 0 7l1.5 1.5a7 7 0 0 0 0-10z" /></svg>,
  mute: <svg viewBox="0 0 24 24"><path d="M4 9h3l4-4v14l-4-4H4zM15.5 9.5L17 8l2 2 2-2 1.5 1.5-2 2 2 2L21 15l-2-2-2 2-1.5-1.5 2-2z" /></svg>,
  lock: <svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1v10H6V10zm2 0h6V8a3 3 0 0 0-6 0z" /></svg>,
  folder: <svg viewBox="0 0 24 24"><path d="M3 5h6l2 2h10v12H3z" /></svg>,
  image: <svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm3 9l3-3 3 3 3-4 4 5H6z" /></svg>,
  sparkle: <svg viewBox="0 0 24 24"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" /></svg>,
  close: <svg viewBox="0 0 24 24"><path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>,
  camera: <svg viewBox="0 0 24 24"><path d="M9 4h6l1.5 2H21v14H3V6h4.5zM12 9a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z" /></svg>,
};
