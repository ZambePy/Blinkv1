import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';

export const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Por favor, informe seu e-mail e senha para acessar seu perfil de rastreamento.');
      return;
    }
    setError(null);
    navigate('/tutorial');
  };

  return (
    <main
      role="main"
      aria-labelledby="login-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        className="glass-card animate-scale-in"
        style={{
          background: 'rgba(255, 255, 255, 0.92)',
          padding: '3rem 2.5rem',
          borderRadius: '2rem',
          boxShadow: '0 20px 40px -10px rgba(27, 84, 168, 0.1)',
          width: '100%',
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem',
        }}
      >
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src="/LOGO.png"
            alt="IrisFlow"
            aria-hidden="true"
            style={{ width: 140, height: 'auto', marginBottom: '0.25rem' }}
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          <h1 id="login-title" style={{ fontSize: '1.85rem', color: 'var(--color-text-base)', fontWeight: 800, margin: 0 }}>
            Acessar Plataforma
          </h1>
          <p style={{ color: 'var(--color-text-base)', opacity: 0.8, fontSize: '1rem', margin: 0, lineHeight: 1.5 }}>
            Identifique-se para carregar suas configurações e atuar com olhar
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
          noValidate
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label
              htmlFor="login-email"
              style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-base)', opacity: 0.9 }}
            >
              E-mail ou Usuário
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--color-bg-base)',
                border: '1px solid #cbd5e1',
                borderRadius: '1rem',
                padding: '0 1rem',
                transition: 'border-color 0.2s ease',
              }}
            >
              <Mail color="#64748b" size={20} aria-hidden="true" />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@clinica.com"
                autoComplete="username"
                required
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '1rem 0.75rem',
                  fontSize: '1.05rem',
                  width: '100%',
                  outline: 'none',
                  color: 'var(--color-text-base)',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label
              htmlFor="login-password"
              style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-base)', opacity: 0.9 }}
            >
              Senha de Acesso
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--color-bg-base)',
                border: '1px solid #cbd5e1',
                borderRadius: '1rem',
                padding: '0 1rem',
                transition: 'border-color 0.2s ease',
              }}
            >
              <Lock color="#64748b" size={20} aria-hidden="true" />
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '1rem 0.75rem',
                  fontSize: '1.05rem',
                  width: '100%',
                  outline: 'none',
                  color: 'var(--color-text-base)',
                }}
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                padding: '0.85rem 1rem',
                borderRadius: '0.85rem',
                color: '#991b1b',
                fontSize: '0.9rem',
                lineHeight: 1.4,
              }}
            >
              <AlertCircle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}

          <PrimaryButton
            type="submit"
            fullWidth
            aria-label="Entrar na plataforma"
            style={{ marginTop: '0.5rem', padding: '1rem' }}
          >
            Entrar no Sistema <LogIn size={20} aria-hidden="true" />
          </PrimaryButton>
        </form>
      </div>
    </main>
  );
};

