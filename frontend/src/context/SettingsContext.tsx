import React, { createContext, useContext, useState } from 'react';

type DwellSpeed = 'slow' | 'normal' | 'fast';
type KeyboardLayout = 'frequency' | 'alphabetical' | 'qwerty';

interface Settings {
  dwellSpeed: DwellSpeed;
  keyboardLayout: KeyboardLayout;
  soundEnabled: boolean;
  voiceGender: 'female' | 'male' | 'cloned';
  voiceProfileId?: string;
  eyeDominance: 'left' | 'right' | 'both';
}

const defaultSettings: Settings = {
  dwellSpeed: 'normal',
  keyboardLayout: 'frequency',
  soundEnabled: true,
  voiceGender: 'female',
  eyeDominance: 'both',
};

const SettingsContext = createContext<{
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;
}>({ settings: defaultSettings, updateSettings: () => {} });

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('irisflow_settings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  });

  const updateSettings = (partial: Partial<Settings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    localStorage.setItem('irisflow_settings', JSON.stringify(next));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
