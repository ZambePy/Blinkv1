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

const STORAGE_KEY = 'irisflow_auth';

interface PersistedAuth {
  currentProfile: Profile | null;
  isCaregiver: boolean;
  authToken: string | null;
}

const loadPersisted = (): PersistedAuth => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { currentProfile: null, isCaregiver: false, authToken: null };
    return { currentProfile: null, isCaregiver: false, authToken: null, ...JSON.parse(raw) };
  } catch {
    return { currentProfile: null, isCaregiver: false, authToken: null };
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
  const initial = loadPersisted();
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(initial.currentProfile);
  const [isCaregiver, setIsCaregiver] = useState(initial.isCaregiver);
  const [authToken, setAuthToken] = useState<string | null>(initial.authToken);

  useEffect(() => {
    const data: PersistedAuth = { currentProfile, isCaregiver, authToken };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [currentProfile, isCaregiver, authToken]);

  const selectProfile = (p: Profile) => setCurrentProfile(p);

  const loginCaregiver = (pin: string) => {
    // TEMPORÁRIO: PIN vem de env var. Substituir por autenticação no backend.
    if (pin === env.caregiverPin) {
      setIsCaregiver(true);
      // Placeholder para JWT — hoje é um marcador local; será substituído pelo token do backend.
      setAuthToken('local-caregiver-session');
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentProfile(null);
    setIsCaregiver(false);
    setAuthToken(null);
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
