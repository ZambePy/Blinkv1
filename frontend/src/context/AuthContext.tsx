import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { env } from '../config/env';
import { definirPerfilAtivo } from '../utils/clinicalLogger';
import {
  listarPerfis,
  criarPerfil,
  removerPerfil,
  type NovoPerfil,
  type PerfilLocal,
} from '../services/local/profiles';

export interface Profile {
  id: string;
  name: string;
  /** Data URL da foto. Local, como todo o resto do perfil. */
  avatar?: string;
  age?: number;
  condition?: string;
  createdAt?: string;
}

interface AuthContextData {
  currentProfile: Profile | null;
  profiles: Profile[];
  isCaregiver: boolean;
  authToken: string | null;
  selectProfile: (p: Profile) => void;
  createProfile: (dados: NovoPerfil) => Profile;
  removeProfile: (id: string) => void;
  loginCaregiver: (pin: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

// O perfil do paciente persiste entre sessões (localStorage). O acesso do
// cuidador NÃO: vive só na aba/sessão atual (sessionStorage), para fechar o
// app não deixar a área do cuidador destravada para o paciente.
const PROFILE_KEY = 'irisflow_auth';
const CAREGIVER_SESSION_KEY = 'irisflow_caregiver_session';

interface PersistedProfile {
  currentProfile: Profile | null;
}

interface CaregiverSession {
  isCaregiver: boolean;
  authToken: string | null;
}

const loadProfile = (): PersistedProfile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { currentProfile: null };
    const parsed = JSON.parse(raw) as Partial<PersistedProfile>;
    return { currentProfile: parsed.currentProfile ?? null };
  } catch {
    return { currentProfile: null };
  }
};

const loadCaregiverSession = (): CaregiverSession => {
  try {
    const raw = sessionStorage.getItem(CAREGIVER_SESSION_KEY);
    if (!raw) return { isCaregiver: false, authToken: null };
    const parsed = JSON.parse(raw) as Partial<CaregiverSession>;
    return { isCaregiver: parsed.isCaregiver === true, authToken: parsed.authToken ?? null };
  } catch {
    return { isCaregiver: false, authToken: null };
  }
};

/**
 * Os perfis vêm do armazenamento local (`services/local/profiles`), nunca do
 * servidor: nome, idade, condição e foto de um paciente com ELA são dado de
 * saúde, e o termo de privacidade promete que não saem desta máquina.
 *
 * Antes havia três perfis fictícios cravados aqui ("Paciente A/B/C"). Num
 * produto clínico isso leva o cuidador a calibrar no perfil errado e perder a
 * sessão inteira do paciente.
 */
const paraProfile = (p: PerfilLocal): Profile => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt,
  ...(p.age !== undefined ? { age: p.age } : {}),
  ...(p.condition !== undefined ? { condition: p.condition } : {}),
  ...(p.avatarDataUrl !== undefined ? { avatar: p.avatarDataUrl } : {}),
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(
    () => loadProfile().currentProfile
  );
  const [caregiver, setCaregiver] = useState<CaregiverSession>(loadCaregiverSession);
  const [profiles, setProfiles] = useState<Profile[]>(() => listarPerfis().map(paraProfile));
  const { isCaregiver, authToken } = caregiver;

  // O histórico clínico é gravado POR PACIENTE, e quem sabe qual é o paciente é
  // este contexto. Sem isto o logger não teria a quem atribuir e não gravaria
  // nada — que é o lado certo de falhar, mas silencioso demais para deixar.
  useEffect(() => {
    definirPerfilAtivo(currentProfile?.id ?? null);
  }, [currentProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ currentProfile }));
    } catch {
      // Storage indisponível: o perfil vale só nesta sessão.
    }
  }, [currentProfile]);

  useEffect(() => {
    try {
      if (caregiver.isCaregiver) {
        sessionStorage.setItem(CAREGIVER_SESSION_KEY, JSON.stringify(caregiver));
      } else {
        sessionStorage.removeItem(CAREGIVER_SESSION_KEY);
      }
    } catch {
      // Idem.
    }
  }, [caregiver]);

  const selectProfile = (p: Profile) => setCurrentProfile(p);

  const createProfile = useCallback((dados: NovoPerfil): Profile => {
    const criado = paraProfile(criarPerfil(dados));
    setProfiles((antes) => [...antes, criado]);
    return criado;
  }, []);

  const removeProfile = useCallback((id: string) => {
    removerPerfil(id);
    setProfiles((antes) => antes.filter((p) => p.id !== id));
    // Um perfil removido não pode continuar selecionado: a calibração
    // carregada ficaria sem dono e o app apontaria para algo que não existe.
    setCurrentProfile((atual) => (atual?.id === id ? null : atual));
  }, []);

  const loginCaregiver = (pin: string) => {
    // TEMPORÁRIO: PIN vem de env var. Substituir por autenticação no backend.
    if (pin === env.caregiverPin) {
      // Placeholder para JWT — hoje é um marcador local; será substituído pelo token do backend.
      setCaregiver({ isCaregiver: true, authToken: 'local-caregiver-session' });
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentProfile(null);
    setCaregiver({ isCaregiver: false, authToken: null });
  };

  return (
    <AuthContext.Provider
      value={{
        currentProfile,
        profiles,
        isCaregiver,
        authToken,
        selectProfile,
        createProfile,
        removeProfile,
        loginCaregiver,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
