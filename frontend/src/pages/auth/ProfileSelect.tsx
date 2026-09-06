import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserCircle, ArrowRight } from 'lucide-react';
import { useAuth, type Profile } from '../../context/AuthContext';
import { ICON_URL } from '../../design/assets';
import '../caregiver/caregiver.css';

/**
 * Seleção de perfil (demonstração). Os cartões são alvos grandes e sem
 * `data-no-dwell`: o paciente pode escolher o próprio perfil com o olhar.
 */
export const ProfileSelect: React.FC = () => {
  const { profiles, selectProfile } = useAuth();
  const navigate = useNavigate();

  const handleSelect = (profile: Profile) => {
    selectProfile(profile);
    navigate('/calibration-check');
  };

  return (
    <main className="cg-auth" aria-labelledby="profiles-title">
      <div className="bg-orb" style={{ width: 480, height: 480, bottom: -200, left: -160 }} aria-hidden="true" />
      <div className="cg-auth__inner animate-fade-in-up">
        <div className="cg-auth__brand">
          <img src={ICON_URL} alt="" aria-hidden="true" style={{ width: 72 }} onError={(e) => (e.currentTarget.hidden = true)} />
          <span className="cg-eyebrow">
            <Users size={18} aria-hidden="true" /> Selecione o perfil
          </span>
          <h1 id="profiles-title" className="font-display" style={{ fontSize: 'var(--fs-32)' }}>
            Quem vai navegar com o olhar hoje?
          </h1>
          <p className="cg-auth__lead">Escolha o perfil para carregar as calibrações e o vocabulário salvos.</p>
        </div>

        <div className="cg-profiles">
          {profiles.map((p) => (
            <button key={p.id} type="button" onClick={() => handleSelect(p)} className="cg-profile" aria-label={`Iniciar sessão como ${p.name}`}>
              {p.avatar ? (
                <img src={p.avatar} alt="" className="cg-profile__avatar" />
              ) : (
                <span className="cg-profile__avatar" aria-hidden="true">
                  <UserCircle size={56} />
                </span>
              )}
              <span className="cg-profile__name">{p.name}</span>
              <span className="cg-profile__cta">
                Iniciar sessão <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
};
