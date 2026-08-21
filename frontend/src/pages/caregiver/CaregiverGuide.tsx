import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Video, Sun, Eye, Info } from 'lucide-react';
import { CaregiverPageLayout } from '../../components/ui/CaregiverPageLayout';

export const CaregiverGuide: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromRoute = searchParams.get('from') || '/settings';

  return (
    <CaregiverPageLayout title="Guia de Instalação e Suporte">
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: '#cbd5e1',
        }}
      >
        {/* Botão de Voltar */}
        <button
          onClick={() => navigate(fromRoute)}
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '0.75rem',
            color: '#f8fafc',
            padding: '0.6rem 1.2rem',
            fontSize: '0.95rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
        >
          <ArrowLeft size={18} /> Voltar
        </button>

        {/* Introdução */}
        <section
          style={{
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1.5rem',
            padding: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Info size={28} color="#3b82f6" /> Instalação e Rastreamento Ocular
          </h2>
          <p style={{ fontSize: '1.1rem', lineHeight: 1.6, margin: 0, color: '#94a3b8' }}>
            Este guia foi elaborado para ajudar o cuidador a configurar e calibrar o rastreador ocular de forma eficiente. O posicionamento correto e a boa iluminação reduzem drasticamente falsos positivos, erros e chamados de suporte.
          </p>
        </section>

        {/* Câmera */}
        <section
          style={{
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1.5rem',
            padding: '2rem',
          }}
        >
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Video size={24} color="#10b981" /> 1. Posicionamento da Câmera
          </h3>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '1.05rem', lineHeight: 1.6 }}>
            <li>
              <strong>Localização Ideal:</strong> A webcam deve ser posicionada centralizada <strong>abaixo da tela</strong> (preferencialmente) ou acima, apontada diretamente para a altura dos olhos do paciente.
            </li>
            <li>
              <strong>Distância Correta:</strong> O paciente deve se sentar a uma distância entre <strong>50 cm e 70 cm</strong> da câmera.
            </li>
            <li>
              <strong>Enquadramento:</strong> Certifique-se de que o rosto do paciente esteja totalmente visível, centralizado e nivelado (evite inclinar a câmera demais para o lado).
            </li>
          </ul>
        </section>

        {/* Iluminação */}
        <section
          style={{
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1.5rem',
            padding: '2rem',
          }}
        >
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Sun size={24} color="#f59e0b" /> 2. Iluminação do Ambiente
          </h3>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '1.05rem', lineHeight: 1.6 }}>
            <li>
              <strong>Evite Contra-Luz:</strong> Nunca posicione o paciente de costas para uma janela aberta ou lâmpada forte. A luz de fundo cega o sensor do rastreador ocular.
            </li>
            <li>
              <strong>Luz Uniforme:</strong> A face do usuário deve ser iluminada de maneira uniforme pela frente ou pelos lados.
            </li>
            <li>
              <strong>Luz Indireta:</strong> Dê preferência a lâmpadas de luz indireta para evitar reflexos nítidos nas córneas ou nas lentes.
            </li>
          </ul>
        </section>

        {/* Óculos */}
        <section
          style={{
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1.5rem',
            padding: '2rem',
          }}
        >
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Eye size={24} color="#8b5cf6" /> 3. Uso de Óculos e Lentes
          </h3>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '1.05rem', lineHeight: 1.6 }}>
            <li>
              <strong>Desvio de Reflexos:</strong> Reflexos brancos de luz nas lentes dos óculos impedem o rastreador de identificar as pupilas. Incline a câmera ou a tela ligeiramente para baixo/cima até que o reflexo saia da direção dos olhos na imagem.
            </li>
            <li>
              <strong>Limpeza Constante:</strong> Mantenha as lentes dos óculos bem limpas e secas. Poeira ou marcas de dedos causam dispersão e erros angulares.
            </li>
            <li>
              <strong>Progressivas/Bifocais:</strong> Óculos de transição multifocais ou reflexos azuis muito fortes podem diminuir a precisão. Se possível, tente alinhar o olhar pelo centro geométrico das lentes.
            </li>
          </ul>
        </section>

        {/* Resolução de Problemas */}
        <section
          style={{
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1.5rem',
            padding: '2rem',
          }}
        >
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            🛠️ O que fazer se a calibração falhar constantemente?
          </h3>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '1.05rem', lineHeight: 1.6 }}>
            <li>
              <strong>Apenas os Olhos se Movem:</strong> Oriente o paciente a mover <strong>somente os olhos</strong> para seguir os círculos de calibração, mantendo a cabeça fixa na mesma posição durante todo o processo.
            </li>
            <li>
              <strong>Distância Estável:</strong> Mantenha o paciente na mesma distância da câmera do início ao fim.
            </li>
            <li>
              <strong>Ajuste do Dwell:</strong> Se o paciente pisca demais ou se fadiga com facilidade, aumente a velocidade do dwell (tempo de fixação) nas configurações para agilizar as seleções.
            </li>
          </ul>
        </section>
      </div>
    </CaregiverPageLayout>
  );
};
