import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';

interface DwellButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onDwellClick: () => void;
  dwellTimeMs?: number;
  children: React.ReactNode;
}

const dwellByPreset: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 2500,
  normal: 1500,
  fast: 800,
};

const TICK_MS = 50;

export const DwellButton: React.FC<DwellButtonProps> = ({
  onDwellClick,
  dwellTimeMs,
  children,
  className = '',
  style,
  ...rest
}) => {
  const { settings } = useSettings();
  const totalMs = dwellTimeMs ?? dwellByPreset[settings.dwellSpeed];
  const [pct, setPct] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    startedAtRef.current = null;
    setPct(0);
    firedRef.current = false;
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    firedRef.current = false;
    startedAtRef.current = performance.now();
    intervalRef.current = setInterval(() => {
      const started = startedAtRef.current;
      if (started == null) return;
      const elapsed = performance.now() - started;
      const next = Math.min(100, (elapsed / totalMs) * 100);
      setPct(next);
      if (next >= 100 && !firedRef.current) {
        firedRef.current = true;
        clear();
        onDwellClick();
      }
    }, TICK_MS);
  }, [totalMs, onDwellClick, clear]);

  useEffect(() => () => clear(), [clear]);

  return (
    <button
      {...rest}
      className={`dwell-wrapper ${className}`.trim()}
      onMouseEnter={start}
      onMouseLeave={clear}
      onFocus={start}
      onBlur={clear}
      onClick={(e) => {
        clear();
        onDwellClick();
        rest.onMouseDown?.(e as never);
      }}
      style={{
        position: 'relative',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        ...style,
      }}
    >
      {children}
      <span
        className="dwell-progress"
        style={{ ['--dwell-pct' as never]: `${pct}%` }}
        aria-hidden="true"
      />
      {pct > 0 && (
        <span
          className="dwell-ring"
          style={{ ['--dwell-pct' as never]: `${pct}%` }}
          aria-hidden="true"
        />
      )}
    </button>
  );
};
