import React, { createContext, useContext, useEffect, useState } from 'react';
import { env } from '../config/env';

export interface Profile {
  id: string;
  name: string;
  avatar?: string;
}

interface AuthContextData {
  currentProfile: Profile | null;
  profiles: Profile[];
  isCaregiver: boolean;
  authToken: string | null;
  selectProfile: (p: Profile) => void;
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

const mockProfiles: Profile[] = [
  {
    id: 'p1',
    name: 'Paciente A',
    avatar: 'https://ui-avatars.com/api/?name=Paciente+A&background=1B54A8&color=fff',
  },
  {
    id: 'p2',
    name: 'Paciente B',
    avatar: 'https://ui-avatars.com/api/?name=Paciente+B&background=6D28D9&color=fff',
  },
  {
    id: 'p3',
    name: 'Paciente C',
    avatar: 'https://ui-avatars.com/api/?name=Paciente+C&background=059669&color=fff',
  },
];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(
    () => loadProfile().currentProfile
  );
  const [caregiver, setCaregiver] = useState<CaregiverSession>(loadCaregiverSession);
  const { isCaregiver, authToken } = caregiver;

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
        profiles: mockProfiles,
        isCaregiver,
        authToken,
        selectProfile,
        loginCaregiver,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
