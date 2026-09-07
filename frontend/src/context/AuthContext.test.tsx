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

  it('não inventa perfis: começa com a lista vazia', () => {
    // Antes existiam "Paciente A/B/C" cravados no código. Num produto clínico,
    // perfil fictício leva o cuidador a calibrar no perfil errado.
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.profiles).toEqual([]);
  });

  it('cria um perfil, que aparece na lista e sobrevive a um novo boot', () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.createProfile({ name: 'Joana', age: 58, condition: 'ELA' });
    });

    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.profiles[0].name).toBe('Joana');
    expect(result.current.profiles[0].age).toBe(58);

    unmount();
    const segundoBoot = renderHook(() => useAuth(), { wrapper });
    expect(segundoBoot.result.current.profiles).toHaveLength(1);
  });

  it('remove um perfil da lista', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      result.current.createProfile({ name: 'Joana' });
      result.current.createProfile({ name: 'Carlos' });
    });

    act(() => {
      result.current.removeProfile(result.current.profiles[0].id);
    });

    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.profiles[0].name).toBe('Carlos');
  });

  it('remover o perfil em uso limpa a seleção', () => {
    // Sem isto o app seguiria apontando para um perfil que não existe mais, e
    // a calibração carregada não teria dono.
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      const p = result.current.createProfile({ name: 'Joana' });
      result.current.selectProfile(p);
    });
    expect(result.current.currentProfile?.name).toBe('Joana');

    act(() => {
      result.current.removeProfile(result.current.profiles[0].id);
    });

    expect(result.current.currentProfile).toBeNull();
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
