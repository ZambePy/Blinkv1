import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Note } from '../caregiver/CaregiverControls';
import { LOGO_URL } from '../../design/assets';
import '../caregiver/caregiver.css';

/** Tela de demonstração: não há backend de login, só valida o preenchimento. */
export const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Informe e-mail e senha para carregar o perfil de rastreamento.');
      return;
    }
    setError(null);
    navigate('/tutorial');
  };

  return (
    <main className="cg-auth" aria-labelledby="login-title">
      <div className="bg-orb" style={{ width: 420, height: 420, top: -140, right: -120 }} aria-hidden="true" />
      <div className="cg-auth__inner">
        <div className="cg-auth__card animate-fade-in-up">
          <div className="cg-auth__brand">
            <img src={LOGO_URL} alt="" aria-hidden="true" onError={(e) => (e.currentTarget.hidden = true)} />
            <h1 id="login-title" className="cg-auth__title font-display">
              Acessar plataforma
            </h1>
            <p className="cg-auth__lead">Identifique-se para carregar suas configurações e usar o olhar.</p>
          </div>

          <form onSubmit={handleLogin} className="cg-auth__form" noValidate>
            <div className="cg-field">
              <label htmlFor="login-email" className="cg-label">
                E-mail ou usuário
              </label>
              <div className="cg-input-group">
                <Mail size={20} aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@clinica.com"
                  autoComplete="username"
                  required
                  data-no-dwell="true"
                />
              </div>
            </div>

            <div className="cg-field">
              <label htmlFor="login-password" className="cg-label">
                Senha de acesso
              </label>
              <div className="cg-input-group">
                <Lock size={20} aria-hidden="true" />
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  data-no-dwell="true"
                />
              </div>
            </div>

            {error && (
              <Note tone="danger" role="alert">
                {error}
              </Note>
            )}

            <PrimaryButton type="submit" fullWidth icon={<LogIn size={20} />} style={{ minHeight: 52 }}>
              Entrar no sistema
            </PrimaryButton>
          </form>
        </div>
      </div>
    </main>
  );
};
