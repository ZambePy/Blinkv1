import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from './AuthContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext', () => {
  it('inicia sem perfil selecionado', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.isCaregiver).toBe(false);
    expect(result.current.authToken).toBeNull();
  });

  it('seleciona um perfil e persiste em localStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      result.current.selectProfile({ id: 'p1', name: 'Paciente A' });
    });
    expect(result.current.currentProfile?.id).toBe('p1');
    const raw = localStorage.getItem('irisflow_auth');
    expect(raw).toContain('p1');
  });

  it('rejeita PIN incorreto', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    let ok = true;
    act(() => {
      ok = result.current.loginCaregiver('9999');
    });
    expect(ok).toBe(false);
    expect(result.current.isCaregiver).toBe(false);
  });

  it('aceita PIN da env var (default 1234)', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    let ok = false;
    act(() => {
      ok = result.current.loginCaregiver('1234');
    });
    expect(ok).toBe(true);
    expect(result.current.isCaregiver).toBe(true);
    expect(result.current.authToken).not.toBeNull();
  });

  it('logout limpa perfil, cuidador e token', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      result.current.selectProfile({ id: 'p1', name: 'Paciente A' });
      result.current.loginCaregiver('1234');
    });
    act(() => {
      result.current.logout();
    });
    expect(result.current.currentProfile).toBeNull();
    expect(result.current.isCaregiver).toBe(false);
    expect(result.current.authToken).toBeNull();
  });
});
