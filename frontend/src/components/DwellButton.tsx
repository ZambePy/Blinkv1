import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useGaze } from '../context/GazeContext';

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
// After firing, ignore gaze on this button for REFRACTORY_MS to avoid a second
// dwell being armed while the user's eye is still on the target.
const REFRACTORY_MS = 800;

export const DwellButton: React.FC<DwellButtonProps> = ({
  onDwellClick,
  dwellTimeMs,
  children,
  className = '',
  style,
  ...rest
}) => {
  const { settings } = useSettings();
  const { subscribe } = useGaze();
  const totalMs = dwellTimeMs ?? dwellByPreset[settings.dwellSpeed];
  const [pct, setPct] = useState(0);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const refractoryUntilRef = useRef<number>(0);
  const gazeInsideRef = useRef(false);
  const disabledRef = useRef<boolean>(!!rest.disabled);

  useEffect(() => {
    disabledRef.current = !!rest.disabled;
  }, [rest.disabled]);

  const stopTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    startedAtRef.current = null;
    setPct(0);
  }, []);

  const startTick = useCallback(() => {
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
        refractoryUntilRef.current = performance.now() + REFRACTORY_MS;
        stopTick();
        onDwellClick();
      }
    }, TICK_MS);
  }, [totalMs, onDwellClick, stopTick]);

  // Gaze-driven hit-test replaces the OS-cursor `onMouseEnter`. Kept as fallback below
  // for pointer users, but the dwell loop is driven by the gaze subscription.
  useEffect(() => {
    const unsubscribe = subscribe((sample) => {
      const node = btnRef.current;
      if (!node) return;
      if (disabledRef.current) {
        if (gazeInsideRef.current) {
          gazeInsideRef.current = false;
          stopTick();
        }
        return;
      }

      // When face is lost, freeze the dwell — do not advance progress, but keep
      // gazeInsideRef so recovery within refractory doesn't immediately restart.
      if (!sample.hasFace) {
        if (intervalRef.current) stopTick();
        return;
      }

      if (performance.now() < refractoryUntilRef.current) {
        return;
      }

      const rect = node.getBoundingClientRect();
      const inside =
        sample.x >= rect.left &&
        sample.x <= rect.right &&
        sample.y >= rect.top &&
        sample.y <= rect.bottom;

      if (inside && !gazeInsideRef.current) {
        gazeInsideRef.current = true;
        startTick();
      } else if (!inside && gazeInsideRef.current) {
        gazeInsideRef.current = false;
        stopTick();
      }
    });
    return () => {
      unsubscribe();
      stopTick();
    };
  }, [subscribe, startTick, stopTick]);

  return (
    <button
      {...rest}
      ref={btnRef}
      className={`dwell-wrapper ${className}`.trim()}
      onMouseEnter={startTick}
      onMouseLeave={stopTick}
      onFocus={startTick}
      onBlur={stopTick}
      onClick={(e) => {
        stopTick();
        // A real click always fires (accessibility + pointer users). Refractory
        // is only for dwell-driven fires.
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
