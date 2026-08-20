import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { SettingsProvider, useSettings } from './SettingsContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe('SettingsContext', () => {
  it('inicia com defaults sensatos', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.settings.dwellSpeed).toBe('normal');
    expect(result.current.settings.keyboardLayout).toBe('frequency');
    expect(result.current.settings.soundEnabled).toBe(true);
  });

  it('atualiza parcialmente e persiste', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => {
      result.current.updateSettings({ dwellSpeed: 'fast', keyboardLayout: 'qwerty' });
    });
    expect(result.current.settings.dwellSpeed).toBe('fast');
    expect(result.current.settings.keyboardLayout).toBe('qwerty');
    const raw = localStorage.getItem('irisflow_settings');
    expect(raw).toContain('fast');
    expect(raw).toContain('qwerty');
  });

  it('permite definir layout de varredura hierárquica', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => {
      result.current.updateSettings({ keyboardLayout: 'hierarchical' });
    });
    expect(result.current.settings.keyboardLayout).toBe('hierarchical');
    const raw = localStorage.getItem('irisflow_settings');
    expect(raw).toContain('hierarchical');
  });
});
