import { useId } from 'react';

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  mono,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="input" htmlFor={id}>
      {label}
      <span className="box box-area">
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          className={mono ? 'mono-in' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
