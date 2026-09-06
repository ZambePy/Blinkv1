import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Delete } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './caregiver.css';

interface CaregiverPinGateProps {
  title: string;
  hint: string;
  errorText: string;
  submitLabel?: string;
  cancelLabel?: string;
  /** Para onde "Cancelar" leva (padrão: menu do paciente). */
  cancelTo?: string;
}

const MAX_PIN = 8;

/**
 * Porta de entrada da área do cuidador: PIN com teclado numérico na tela.
 * Operada por mouse — os controles não são alvos de dwell, exceto o de
 * cancelar, que devolve o paciente ao menu caso ele chegue aqui sozinho.
 */
export const CaregiverPinGate: React.FC<CaregiverPinGateProps> = ({
  title,
  hint,
  errorText,
  submitLabel = 'Entrar',
  cancelLabel = 'Cancelar',
  cancelTo = '/menu',
}) => {
  const navigate = useNavigate();
  const { loginCaregiver } = useAuth();
  const [pin, setPin] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = loginCaregiver(pin);
    setInvalid(!ok);
    setPin('');
  };

  const push = (d: string) => {
    setInvalid(false);
    setPin((p) => (p.length < MAX_PIN ? p + d : p));
  };

  return (
    <main className="cg-gate" aria-labelledby="caregiver-gate-title">
      <div className="cg-gate__card animate-fade-in">
        <div className="cg-gate__icon" aria-hidden="true">
          <Lock size={32} />
        </div>
        <div>
          <h1 id="caregiver-gate-title" className="cg-gate__title font-display">
            {title}
          </h1>
          <p className="cg-gate__hint" style={{ marginTop: '0.5rem' }}>
            {hint}
          </p>
        </div>

        <form onSubmit={submit} className="cg-gate__form">
          <label htmlFor="caregiver-pin" className="sr-only">
            PIN do cuidador
          </label>
          <input
            id="caregiver-pin"
            type="password"
            value={pin}
            onChange={(e) => {
              setInvalid(false);
              setPin(e.target.value.replace(/\D/g, '').slice(0, MAX_PIN));
            }}
            maxLength={MAX_PIN}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="••••"
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'caregiver-pin-error' : undefined}
            className="cg-pin-input"
            data-no-dwell="true"
          />
          {invalid && (
            <p id="caregiver-pin-error" role="alert" className="cg-pin-error">
              {errorText}
            </p>
          )}

          <div className="cg-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => push(d)}
                className="cg-keypad__key"
                data-no-dwell="true"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPin('');
                setInvalid(false);
              }}
              className="cg-keypad__key cg-keypad__key--aux cg-keypad__key--clear"
              data-no-dwell="true"
            >
              Limpar
            </button>
            <button type="button" onClick={() => push('0')} className="cg-keypad__key" data-no-dwell="true">
              0
            </button>
            <button
              type="button"
              onClick={() => setPin((p) => p.slice(0, -1))}
              className="cg-keypad__key cg-keypad__key--aux"
              aria-label="Apagar último dígito"
              data-no-dwell="true"
            >
              <Delete size={22} aria-hidden="true" />
            </button>
          </div>

          <div className="cg-gate__actions">
            <button type="button" onClick={() => navigate(cancelTo)} className="btn btn--secondary">
              {cancelLabel}
            </button>
            <button type="submit" className="btn btn--primary" data-no-dwell="true">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
};
