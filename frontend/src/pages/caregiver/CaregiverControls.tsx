import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import './caregiver.css';

/**
 * Primitivos das telas do cuidador: cartão, campo, controle segmentado,
 * interruptor, nota e chave→valor. Todos operados por mouse/teclado, por
 * isso carregam `data-no-dwell`; quem precisar de um alvo de gaze usa
 * `GazeButton` ou os `.cg-tile` do painel.
 */

type Tone = 'info' | 'ok' | 'warn' | 'danger';

interface CardProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: 'primary' | 'ok' | 'warn' | 'danger';
  /** Conteúdo à direita do título (badge, botão pequeno). */
  aside?: React.ReactNode;
  variant?: 'default' | 'soft';
  className?: string;
  id?: string;
  children?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  icon,
  iconTone = 'primary',
  aside,
  variant = 'default',
  className = '',
  id,
  children,
}) => {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`cg-card ${variant !== 'default' ? `cg-card--${variant}` : ''} ${className}`.trim()}
    >
      <div className="cg-card__head">
        {icon && (
          <div
            className={`cg-card__icon ${iconTone !== 'primary' ? `cg-card__icon--${iconTone}` : ''}`.trim()}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id={titleId} className="cg-card__title">
            {title}
          </h3>
          {description && <p className="cg-card__desc">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
};

interface FieldProps {
  label: string;
  htmlFor?: string;
  value?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

/** Rótulo + controle + dica. `value` aparece à direita do rótulo (ex.: 80%). */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, value, hint, children }) => (
  <div className="cg-field">
    <label className="cg-label" htmlFor={htmlFor}>
      <span>{label}</span>
      {value !== undefined && <span className="cg-label__value">{value}</span>}
    </label>
    {children}
    {hint && <span className="cg-hint">{hint}</span>}
  </div>
);

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

/** Grupo de rádio em forma de botões lado a lado. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className="cg-segment">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="cg-segment__opt"
          data-no-dwell="true"
        >
          <span className="cg-segment__main">
            {o.icon && <span aria-hidden="true" style={{ display: 'inline-flex' }}>{o.icon}</span>}
            {o.label}
          </span>
          {o.sub && <span className="cg-segment__sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

interface SwitchRowProps {
  id: string;
  title: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export const SwitchRow: React.FC<SwitchRowProps> = ({
  id,
  title,
  description,
  checked,
  onChange,
  icon,
  disabled,
}) => (
  <div className="cg-switch-row">
    <div className="cg-switch-row__text" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
      {icon && (
        <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 2, color: 'var(--primary)' }}>
          {icon}
        </span>
      )}
      <div>
        <div className="cg-switch-row__title" id={`${id}-label`}>
          {title}
        </div>
        {description && <div className="cg-switch-row__desc">{description}</div>}
      </div>
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="cg-switch"
      data-no-dwell="true"
    />
  </div>
);

const NOTE_ICON: Record<Tone, React.ReactNode> = {
  info: <Info size={20} aria-hidden="true" />,
  ok: <CheckCircle2 size={20} aria-hidden="true" />,
  warn: <AlertTriangle size={20} aria-hidden="true" />,
  danger: <XCircle size={20} aria-hidden="true" />,
};

interface NoteProps {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}

export const Note: React.FC<NoteProps> = ({ tone = 'info', title, children, role, className = '' }) => (
  <div className={`cg-note cg-note--${tone} ${className}`.trim()} role={role}>
    {NOTE_ICON[tone]}
    <div className="cg-note__body">
      {title && <strong>{title}</strong>}
      {children}
    </div>
  </div>
);

interface KVProps {
  items: { key: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'danger' }[];
}

/** Grade de leituras rotuladas (estado, diagnóstico). */
export const KV: React.FC<KVProps> = ({ items }) => (
  <dl className="cg-kv" style={{ margin: 0 }}>
    {items.map((it) => (
      <div key={it.key} className="cg-kv__item">
        <dt className="cg-kv__key">{it.key}</dt>
        <dd className={`cg-kv__val ${it.tone ? `cg-kv__val--${it.tone}` : ''}`.trim()} style={{ margin: 0 }}>
          {it.value}
        </dd>
      </div>
    ))}
  </dl>
);

export const Badge: React.FC<{ tone?: Tone | 'neutral'; children: React.ReactNode }> = ({
  tone = 'neutral',
  children,
}) => <span className={`cg-badge ${tone !== 'neutral' ? `cg-badge--${tone}` : ''}`.trim()}>{children}</span>;

interface SectionProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

/** Agrupa cartões sob um título âncora (a subnavegação aponta para `id`). */
export const Section: React.FC<SectionProps> = ({ id, title, icon, children }) => (
  <section id={id} aria-labelledby={`${id}-heading`} className="cg-section">
    <h2 id={`${id}-heading`} className="cg-section__title">
      {icon}
      {title}
    </h2>
    {children}
  </section>
);
