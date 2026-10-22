import { IconChevronDown } from '@tabler/icons-react';
import { type ReactNode, useId, useState } from 'react';
import { DAYS } from '../lib/days.ts';

interface Base {
  label: ReactNode;
  hint?: ReactNode;
}

interface TextProps extends Base {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'number' | 'time' | 'search' | 'url' | 'email';
  placeholder?: string;
  unit?: string;
  mono?: boolean;
  inputMode?: 'numeric' | 'decimal' | 'text' | 'url';
  required?: boolean;
  readOnly?: boolean;
  name?: string;
  autoFocus?: boolean;
}

export function TextField({ label, hint, value, onChange, type = 'text', unit, mono, ...rest }: TextProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const password = type === 'password';
  return (
    <label className="input" htmlFor={id}>
      {label}
      <span className="box">
        <input
          id={id}
          type={password && shown ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={mono ? 'mono-in' : undefined}
          autoComplete="off"
          spellCheck={false}
          {...rest}
        />
        {unit ? <span className="unit">{unit}</span> : null}
        {password ? (
          <button
            type="button"
            className="reveal"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
          >
            {shown ? 'Hide' : 'Show'}
          </button>
        ) : null}
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export type Option<V extends string | number> = readonly [value: V, label: string];

interface SelectProps<V extends string | number> extends Base {
  value: V;
  options: readonly Option<V>[];
  onChange: (value: V) => void;
}

export function SelectField<V extends string | number>({ label, hint, value, options, onChange }: SelectProps<V>) {
  const id = useId();
  return (
    <label className="input" htmlFor={id}>
      {label}
      <span className="select">
        <select
          id={id}
          value={String(value)}
          onChange={(e) => {
            const picked = options.find(([v]) => String(v) === e.target.value);
            if (picked) onChange(picked[0]);
          }}
        >
          {options.map(([v, l]) => (
            <option key={String(v)} value={String(v)}>
              {l}
            </option>
          ))}
        </select>
        <IconChevronDown size={14} />
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

interface SwitchProps extends Base {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A labelled on/off row. */
export function SwitchRow({ label, hint, checked, onChange, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="field-row">
      <div>
        <label htmlFor={id}>{label}</label>
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Switch({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  label?: string;
}) {
  return (
    <span className="switch">
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span />
    </span>
  );
}

export const Row2 = ({ children }: { children: ReactNode }) => <div className="limits">{children}</div>;

export function WeekPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <fieldset className="week">
      <legend className="sr-only">Days</legend>
      {DAYS.map(([d, label]) => (
        <label className="day" key={d}>
          <input
            type="checkbox"
            checked={value.includes(d)}
            onChange={(e) => onChange((e.target.checked ? [...value, d] : value.filter((x) => x !== d)).sort())}
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** A set of toggle chips: categories, networks, days. */
export function ChipPicker<V extends string | number>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly Option<V>[];
  value: V[];
  onChange: (value: V[]) => void;
}) {
  const picked = new Set(value);
  return (
    <fieldset className="tags">
      <legend>{legend}</legend>
      {options.map(([v, l]) => (
        <label className="day" key={String(v)}>
          <input
            type="checkbox"
            checked={picked.has(v)}
            onChange={(e) => onChange(e.target.checked ? [...value, v] : value.filter((x) => x !== v))}
          />
          <span>{l}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: readonly (readonly [V, ReactNode])[];
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <fieldset className="seg">
      <legend className="sr-only">{label}</legend>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </fieldset>
  );
}
