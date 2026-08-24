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

export function Panel({ title, actions, children, scroll }: { title?: string; actions?: React.ReactNode; children?: React.ReactNode; scroll?: boolean }) {
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

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={value === tab.value ? 'is-active' : ''}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Small dropdown anchored under its trigger; closes on outside click or Esc. */
export function Menu({
  trigger,
  children,
  align = 'right',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open ? <div className={`menu menu-${align}`}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export const Icon = {
  play: <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>,
  pause: <svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>,
  skipStart: <svg viewBox="0 0 24 24"><path d="M7 5h2v14H7zM19 5.5v13l-9-6.5z" /></svg>,
  skipEnd: <svg viewBox="0 0 24 24"><path d="M15 5h2v14h-2zM5 5.5l9 6.5-9 6.5z" /></svg>,
  frameBack: <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM18 5.5v13L9 12z" /></svg>,
  frameNext: <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM6 5.5l9 6.5-9 6.5z" /></svg>,

  media: <svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm2 2v2h2V7zm12 0v2h2V7zM5 11v4h14v-4zm0 6v2h2v-2zm12 0v2h2v-2z" /></svg>,
  record: <svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z" /></svg>,
  content: <svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>,
  templates: <svg viewBox="0 0 24 24"><path d="M3 4h18v4H3zm0 6h11v10H3zm13 0h5v10h-5z" /></svg>,
  transitions: <svg viewBox="0 0 24 24"><path d="M3 5h8v14H3z" opacity=".55" /><path d="M13 5h8v14h-8z" /><path d="M11 11h2v2h-2z" /></svg>,
  text: <svg viewBox="0 0 24 24"><path d="M4 5h16v3.2h-6.2V19h-3.6V8.2H4z" /></svg>,
  captions: <svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm4.2 5.2v3.6h3.6v-1.1H8.4v-1.4h2.4v-1.1zm6 0v3.6h3.6v-1.1h-2.4v-1.4h2.4v-1.1z" /></svg>,
  brand: <svg viewBox="0 0 24 24"><path d="M12 3l2.4 5.6L20 9.6l-4.2 4 1.1 5.9L12 16.7 7.1 19.5l1.1-5.9L4 9.6l5.6-1z" /></svg>,
  audio: <svg viewBox="0 0 24 24"><path d="M4 9h3l4-4v14l-4-4H4zM15 8.5a5 5 0 0 1 0 7l1.5 1.5a7 7 0 0 0 0-10z" /></svg>,

  split: <svg viewBox="0 0 24 24"><path d="M11 2h2v20h-2z" /><path d="M3 6h6v5H3zM15 13h6v5h-6z" opacity=".55" /></svg>,
  duplicate: <svg viewBox="0 0 24 24"><path d="M8 3h11v11h-3V6H8z" /><path d="M5 8h11v13H5z" /></svg>,
  trash: <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7zM9 3.5h6L16 6H8z" /></svg>,
  crop: <svg viewBox="0 0 24 24"><path d="M6 2h2v14h14v2H6zM2 6h2v2H2zM16 22h2V8h-2z" /></svg>,
  fade: <svg viewBox="0 0 24 24"><path d="M3 19 21 5v14z" /></svg>,
  filters: <svg viewBox="0 0 24 24"><path d="M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3z" opacity=".5" /><path d="M15 9a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" /></svg>,
  adjust: <svg viewBox="0 0 24 24"><path d="M4 6h10v2H4zm14 0h2v2h-2zM4 11h4v2H4zm8 0h8v2h-8zM4 16h12v2H4zm16 0h0v2h0z" /><path d="M14 4h2v6h-2zM8 9h2v6H8zM16 14h2v6h-2z" /></svg>,
  speed: <svg viewBox="0 0 24 24"><path d="M12 4a9 9 0 0 0-9 9h3a6 6 0 1 1 12 0h3a9 9 0 0 0-9-9z" /><path d="M11 13.5 16 8l-2.5 6.5a1.8 1.8 0 1 1-2.5-1z" /></svg>,
  greenscreen: <svg viewBox="0 0 24 24"><path d="M3 4h18v13H3z" opacity=".45" /><path d="M8.5 10.5 11 13l4.5-5 3.5 9H5z" /></svg>,
  magnet: <svg viewBox="0 0 24 24"><path d="M4 5h5v7.5a3 3 0 0 0 6 0V5h5v7.5a8 8 0 0 1-16 0z" /><path d="M4 15.5h5V19H4zM15 15.5h5V19h-5z" opacity=".4" /></svg>,

  undo: <svg viewBox="0 0 24 24"><path d="M7 8h7a5 5 0 0 1 0 10h-4v-2h4a3 3 0 0 0 0-6H7l3 3-1.5 1.5L3.5 9 8.5 4 10 5.5z" /></svg>,
  redo: <svg viewBox="0 0 24 24"><path d="M17 8h-7a5 5 0 0 0 0 10h4v-2h-4a3 3 0 0 1 0-6h7l-3 3 1.5 1.5L20.5 9 15.5 4 14 5.5z" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" /></svg>,
  minus: <svg viewBox="0 0 24 24"><path d="M4 11h16v2H4z" /></svg>,
  close: <svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>,
  chevronDown: <svg viewBox="0 0 24 24"><path d="M12 15.5 5.5 9 7 7.6l5 5 5-5L18.5 9z" /></svg>,
  chevronRight: <svg viewBox="0 0 24 24"><path d="M9.5 18.5 8 17l5-5-5-5 1.5-1.5L16 12z" /></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M9.6 16.2 5.4 12l-1.4 1.4 5.6 5.6L20.4 8.2 19 6.8z" /></svg>,
  export: <svg viewBox="0 0 24 24"><path d="M12 3l5 5h-3v7h-4V8H7zM4 18h16v3H4z" /></svg>,
  camera: <svg viewBox="0 0 24 24"><path d="M9 4h6l1.5 2H21v14H3V6h4.5zM12 9a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z" /></svg>,
  webcam: <svg viewBox="0 0 24 24"><path d="M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 19h14v2H5z" /></svg>,
  screen: <svg viewBox="0 0 24 24"><path d="M3 4h18v12H3zM9 18h6v2H9z" /><path d="M8 20h8v1.5H8z" /></svg>,
  mic: <svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M6 11a6 6 0 0 0 12 0h2a8 8 0 0 1-7 7.9V22h-2v-3.1A8 8 0 0 1 4 11z" /></svg>,
  folder: <svg viewBox="0 0 24 24"><path d="M3 5h6l2 2h10v12H3z" /></svg>,
  image: <svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm3 9 3-3 3 3 3-4 4 5H6z" /></svg>,
  film: <svg viewBox="0 0 24 24"><path d="M3 4h18v16H3zm2 2v2h2V6zm12 0v2h2V6zM5 10v4h14v-4zm0 6v2h2v-2zm12 0v2h2v-2z" /></svg>,
  wave: <svg viewBox="0 0 24 24"><path d="M3 11h2v2H3zm4-4h2v10H7zm4-3h2v16h-2zm4 5h2v6h-2zm4 2h2v2h-2z" /></svg>,
  scissors: <svg viewBox="0 0 24 24"><path d="M6 4l8 10-1.5 2L4 6zM18 4l-8 10 1.5 2L20 6z" /><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="19" r="2.5" /></svg>,
  sparkle: <svg viewBox="0 0 24 24"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" /></svg>,
  eye: <svg viewBox="0 0 24 24"><path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24"><path d="M3 4.5 19.5 21 21 19.5 4.5 3zM12 5c5 0 9 4.5 9 7 0 1-.7 2.3-1.8 3.5l-2.2-2.2A3.5 3.5 0 0 0 12 8.5c-.4 0-.8.1-1.2.2L8.9 6.8A9.6 9.6 0 0 1 12 5zM4.8 8.5l2.3 2.3a3.5 3.5 0 0 0 4.6 4.6l1.7 1.7c-.4.1-.9.1-1.4.1-5 0-9-4.5-9-7 0-.5.6-1.5 1.8-2.7z" /></svg>,
  volume: <svg viewBox="0 0 24 24"><path d="M4 9h3l4-4v14l-4-4H4zM15 8.5a5 5 0 0 1 0 7l1.5 1.5a7 7 0 0 0 0-10z" /></svg>,
  mute: <svg viewBox="0 0 24 24"><path d="M4 9h3l4-4v14l-4-4H4zM15.5 9.5 17 8l2 2 2-2 1.5 1.5-2 2 2 2L21 15l-2-2-2 2-1.5-1.5 2-2z" /></svg>,
  lock: <svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1v10H6V10zm2 0h6V8a3 3 0 0 0-6 0z" /></svg>,
  rotate: <svg viewBox="0 0 24 24"><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /></svg>,
  aspect: <svg viewBox="0 0 24 24"><path d="M3 6h18v12H3zm2 2v8h14V8z" /></svg>,
};
