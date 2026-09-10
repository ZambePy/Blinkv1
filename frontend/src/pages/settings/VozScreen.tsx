import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Download, Volume2, Trash2, ShieldCheck, Cpu, CheckCircle2, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { VOZ_MEMORIA_NECESSARIA_GB, VOZ_MEMORIA_TOTAL_MINIMA_GB, type EstadoDoMotorDeVoz } from '@tracker/voz/protocolo';
import { PageHeader } from '../../components/ui/PageHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useSettings } from '../../context/SettingsContext';
import { aquecerCache, useEstadoDaVoz, vozClonadaLiberadaPelaLicenca } from '../../services/voz';
import { falarComVozClonada, ponteDaVoz } from '../../services/voz/local';
import { falarComVozDoSistema } from '../../services/voz/sistema';

/**
 * Configurações → Voz personalizada (clonagem local).
 *
 * Tudo acontece no computador: o áudio de referência é preparado e guardado
 * na pasta do app, o modelo roda aqui, as frases ficam num cache local. A
 * única saída de rede é o download dos pesos do modelo, uma vez.
 *
 * A importação exige o termo abaixo aceito NA HORA (o main recusa sem ele):
 * voz é dado biométrico, e a pessoa cuja voz está sendo clonada muitas vezes
 * não pode mais consentir por si — o cuidador declara que tem autorização.
 */

export const TERMO_DE_CONSENTIMENTO = [
  'Declaro que o áudio que vou importar contém a voz do próprio paciente que usa este computador, ou de uma pessoa que autorizou expressamente o uso da sua voz para criar a voz sintética deste paciente.',
  'Entendo que a voz é um dado biométrico (LGPD, art. 5º, II e art. 11) e que o IrisFlow a usa exclusivamente para gerar a fala do paciente neste computador: o áudio de referência, o modelo e as frases geradas ficam armazenados apenas aqui e não são enviados à IrisFlow nem a terceiros.',
  'Sei que posso remover a voz a qualquer momento nesta tela, o que apaga o áudio de referência e todas as frases geradas, e que a voz sintética não deve ser usada para falar em nome de outra pessoa nem para enganar alguém.',
].join('\n\n');

const AMOSTRA = 'Olá! Esta é a minha voz. Obrigado por estar aqui comigo.';

const QUALIDADE = {
  boa: { rotulo: 'Boa', cor: '#15803d' },
  aceitavel: { rotulo: 'Aceitável', cor: '#b45309' },
  fraca: { rotulo: 'Fraca', cor: '#b91c1c' },
} as const;

const caixa: React.CSSProperties = {
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: '1.5rem',
  padding: '1.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  color: 'var(--color-text-base)',
};

const Linha: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.98rem', lineHeight: 1.5 }}>
    <span style={{ opacity: 0.75 }}>{rotulo}</span>
    <span style={{ fontWeight: 700, textAlign: 'right' }}>{children}</span>
  </div>
);

const Aviso: React.FC<{ tipo: 'alerta' | 'erro' | 'ok'; children: React.ReactNode }> = ({ tipo, children }) => {
  const cores = {
    alerta: { fundo: '#fffbeb', borda: '#fde68a', texto: '#92400e' },
    erro: { fundo: 'rgba(220,38,38,0.08)', borda: 'rgba(220,38,38,0.3)', texto: '#991b1b' },
    ok: { fundo: 'rgba(22,163,74,0.08)', borda: 'rgba(22,163,74,0.3)', texto: '#166534' },
  }[tipo];
  return (
    <p role={tipo === 'erro' ? 'alert' : 'status'} style={{ margin: 0, padding: '0.9rem 1.1rem', borderRadius: '1rem', background: cores.fundo, border: `1px solid ${cores.borda}`, color: cores.texto, lineHeight: 1.5 }}>
      {children}
    </p>
  );
};

function descricaoDoMotor(e: EstadoDoMotorDeVoz): string {
  if (!e.disponivel) return 'Indisponível';
  switch (e.motor) {
    case 'pronto': return e.dispositivo === 'cuda' ? 'Pronto (GPU)' : e.dispositivo === 'cpu' ? 'Pronto (CPU)' : 'Pronto (dispositivo definido ao carregar o modelo)';
    case 'iniciando': return 'Iniciando…';
    case 'erro': return 'Com erro';
    default: return 'Parado (inicia quando precisar)';
  }
}

export const VozScreen: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { currentProfile } = useAuth();
  const { settings, updateSettings } = useSettings();
  const estado = useEstadoDaVoz();
  const ponte = ponteDaVoz();
  const liberada = vozClonadaLiberadaPelaLicenca();

  // Aviso de máquina apertada: o modelo em CPU ocupa ~3,5 GB; com pouca
  // memória livre o computador inteiro vai para o swap e "trava". Melhor
  // dizer antes do que o paciente descobrir travando.
  const mq = estado?.maquina;
  const memoriaApertada = !!mq && mq.memoriaTotalGb > 0 && mq.memoriaTotalGb < VOZ_MEMORIA_TOTAL_MINIMA_GB;
  const memoriaLivreInsuficiente = !!mq && mq.memoriaTotalGb > 0 && mq.memoriaLivreGb < VOZ_MEMORIA_NECESSARIA_GB;

  const [termoAberto, setTermoAberto] = useState(false);
  const [aceito, setAceito] = useState(false);
  const [ocupado, setOcupado] = useState<null | 'importando' | 'amostra' | 'aquecendo' | 'removendo'>(null);
  const [ultimoResultado, setUltimoResultado] = useState<string | null>(null);

  // Espelha em `settings.voiceGender` para quem ainda lê esse campo — sem
  // pisar numa escolha "male"/"female" do cuidador quando a clonada não está
  // em uso: só troca de/para `cloned`.
  useEffect(() => {
    if (!estado) return;
    const clonadaEmUso = estado.voz.importada && estado.ativa;
    if (clonadaEmUso && settings.voiceGender !== 'cloned') updateSettings({ voiceGender: 'cloned' });
    else if (!clonadaEmUso && settings.voiceGender === 'cloned') updateSettings({ voiceGender: 'female' });
  }, [estado?.voz.importada, estado?.ativa]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esta tela é quem acorda o motor para mostrar status e dispositivo; o
  // resto do app não sobe um processo Python só para exibir "nenhuma voz".
  useEffect(() => {
    void ponte?.sondar().catch(() => undefined);
  }, [ponte]);

  const importar = async () => {
    if (!ponte || !aceito) return;
    setOcupado('importando');
    setUltimoResultado(null);
    try {
      const r = await ponte.importar({ texto: TERMO_DE_CONSENTIMENTO, aceitoEm: new Date().toISOString(), perfilId: currentProfile?.id ?? null });
      if (!r.ok) {
        if (!r.cancelado) toast.error(r.erro);
        return;
      }
      setTermoAberto(false);
      setAceito(false);
      const q = QUALIDADE[r.qualidade];
      setUltimoResultado(`Voz importada: ${r.duracaoS.toFixed(0)} s de fala útil, qualidade ${q.rotulo.toLowerCase()}.${r.avisos.length ? ' ' + r.avisos.join(' ') : ''}`);
      toast.success('Voz importada. Toque em "Ouvir amostra" para conferir.');
    } finally {
      setOcupado(null);
    }
  };

  const ouvirAmostra = async () => {
    setOcupado('amostra');
    try {
      const r = await falarComVozClonada(AMOSTRA);
      if (!r.ok) {
        const motivo = r.motivo === 'sem_modelo' ? 'o modelo ainda não foi baixado' : r.motivo === 'inativa' ? 'a voz clonada está desligada' : r.erro ?? r.motivo;
        toast.error(`Não foi possível usar a voz clonada (${motivo}). Tocando a voz do sistema.`);
        await falarComVozDoSistema(AMOSTRA);
      } else if (!r.deCache) {
        toast.info(`Frase gerada em ${(r.ms / 1000).toFixed(1)} s. Frases repetidas saem do cache, instantâneas.`);
      }
    } finally {
      setOcupado(null);
    }
  };

  const aquecer = async () => {
    setOcupado('aquecendo');
    try {
      const [{ TEXTOS_DAS_FRASES_RAPIDAS }, { TEXTOS_DOS_PICTOGRAMAS }] = await Promise.all([
        import('../QuickPhrasesScreen'),
        import('../core/PictogramScreen'),
      ]);
      const n = await aquecerCache([...TEXTOS_DOS_PICTOGRAMAS, ...TEXTOS_DAS_FRASES_RAPIDAS]);
      toast.success(n > 0 ? `${n} frases preparadas no cache.` : 'Nenhuma frase nova para preparar.');
    } finally {
      setOcupado(null);
    }
  };

  const remover = async () => {
    if (!ponte) return;
    if (!window.confirm('Remover a voz importada? O áudio de referência e todas as frases geradas serão apagados deste computador.')) return;
    setOcupado('removendo');
    try {
      await ponte.remover();
      setUltimoResultado(null);
      toast.success('Voz removida.');
    } finally {
      setOcupado(null);
    }
  };

  const baixar = async () => {
    if (!ponte) return;
    const r = await ponte.baixarModelo();
    if (!r.ok) toast.error(r.erro ?? 'O download falhou.');
  };

  return (
    <main role="main" style={{ minHeight: '100vh', background: 'var(--color-bg-base)', padding: '2rem 2.5rem' }}>
      <PageHeader
        title="Voz personalizada"
        subtitle="A voz do paciente, recriada a partir de uma gravação e usada em tudo que ele diz pelo IrisFlow. Tudo fica neste computador."
        icon={<Mic color="#1B54A8" size={28} aria-hidden="true" />}
      />

      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {!liberada && (
          <Aviso tipo="alerta">
            O plano desta conta não inclui a voz personalizada. Ela faz parte do plano <strong>IrisFlow Voz</strong> — o cuidador pode
            mudar de plano em Conta e assinatura. Enquanto isso, o paciente fala com a voz do sistema.
          </Aviso>
        )}

        {estado && !estado.disponivel && (
          <Aviso tipo="alerta">{estado.indisponivelPorque}</Aviso>
        )}
        {estado?.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}

        {/* Estado */}
        <section aria-labelledby="voz-estado" style={caixa}>
          <h2 id="voz-estado" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Cpu size={22} aria-hidden="true" /> Motor de voz
          </h2>
          {!estado ? (
            <p style={{ margin: 0, opacity: 0.8 }}>{ponte ? 'Consultando o motor…' : 'A voz personalizada só existe no aplicativo instalado.'}</p>
          ) : (
            <>
              <Linha rotulo="Motor">{descricaoDoMotor(estado)}</Linha>
              <Linha rotulo="Modelo (Chatterbox multilíngue)">
                {estado.modelo.baixado
                  ? 'Baixado'
                  : estado.modelo.baixando
                    ? `Baixando… ${estado.modelo.progresso ?? 0}%${estado.modelo.etapa ? ` (${estado.modelo.etapa})` : ''}`
                    : 'Não baixado (~1,5 GB, uma vez)'}
              </Linha>
              {estado.modelo.baixando && (
                <div aria-hidden="true" style={{ height: 10, borderRadius: 5, background: 'var(--color-card-border)', overflow: 'hidden' }}>
                  <div style={{ width: `${estado.modelo.progresso ?? 0}%`, height: '100%', background: '#1B54A8', transition: 'width .3s' }} />
                </div>
              )}
              <Linha rotulo="Cache de frases">{estado.cache.itens} frases · {estado.cache.mb} MB</Linha>
              {mq && mq.memoriaTotalGb > 0 && (
                <Linha rotulo="Este computador">
                  {mq.memoriaTotalGb.toFixed(0)} GB de memória ({mq.memoriaLivreGb.toFixed(1)} GB livres) · {mq.nucleos} núcleos
                </Linha>
              )}
              {memoriaLivreInsuficiente && (
                <Aviso tipo="erro">
                  Memória livre abaixo de {VOZ_MEMORIA_NECESSARIA_GB} GB: o motor vai recusar carregar o modelo até
                  fechar outros programas. Enquanto isso o paciente fala com a voz do sistema.
                </Aviso>
              )}
              {!memoriaLivreInsuficiente && memoriaApertada && (
                <Aviso tipo="alerta">
                  Computador com menos de {VOZ_MEMORIA_TOTAL_MINIMA_GB} GB de memória: a voz personalizada funciona, mas
                  a primeira frase pode demorar bastante e deixar o computador lento enquanto o modelo carrega.
                  Feche navegador e outros programas antes de testar.
                </Aviso>
              )}
              {estado.disponivel && !estado.modelo.baixado && !estado.modelo.baixando && (
                <PrimaryButton type="button" onClick={() => void baixar()} style={{ alignSelf: 'flex-start' }}>
                  <Download size={20} aria-hidden="true" /> Baixar o modelo agora
                </PrimaryButton>
              )}
            </>
          )}
        </section>

        {/* Voz */}
        <section aria-labelledby="voz-referencia" style={caixa}>
          <h2 id="voz-referencia" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Mic size={22} aria-hidden="true" /> Voz do paciente
          </h2>
          {estado?.voz.importada ? (
            <>
              <Linha rotulo="Situação">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#15803d' }}>
                  <CheckCircle2 size={18} aria-hidden="true" /> Importada
                </span>
              </Linha>
              <Linha rotulo="Arquivo de origem">{estado.voz.nomeDoArquivo ?? '—'}</Linha>
              <Linha rotulo="Fala útil encontrada">{estado.voz.duracaoS !== undefined ? `${estado.voz.duracaoS.toFixed(0)} s` : '—'}</Linha>
              <Linha rotulo="Qualidade da gravação">
                {estado.voz.qualidade ? <span style={{ color: QUALIDADE[estado.voz.qualidade].cor }}>{QUALIDADE[estado.voz.qualidade].rotulo}</span> : '—'}
              </Linha>
              <Linha rotulo="Consentimento aceito em">{estado.voz.consentimentoEm ? new Date(estado.voz.consentimentoEm).toLocaleString('pt-BR') : '—'}</Linha>
              {estado.voz.avisos && estado.voz.avisos.length > 0 && (
                <Aviso tipo="alerta">
                  <AlertTriangle size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  {estado.voz.avisos.join(' ')}
                </Aviso>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: '0.75rem 0' }}>
                <input
                  type="checkbox"
                  checked={estado.ativa}
                  disabled={!liberada}
                  onChange={(e) => void ponte?.ativar(e.target.checked)}
                  style={{ width: 24, height: 24 }}
                />
                Usar a voz clonada quando o paciente falar
              </label>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <PrimaryButton type="button" onClick={() => void ouvirAmostra()} disabled={ocupado !== null || !liberada}>
                  {ocupado === 'amostra' ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />} Ouvir amostra
                </PrimaryButton>
                <PrimaryButton type="button" variant="secondary" onClick={() => void aquecer()} disabled={ocupado !== null || !liberada || !estado.ativa}>
                  {ocupado === 'aquecendo' ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />} Preparar frases rápidas
                </PrimaryButton>
                <PrimaryButton type="button" variant="secondary" onClick={() => setTermoAberto(true)} disabled={ocupado !== null}>
                  <Mic size={20} aria-hidden="true" /> Trocar o áudio
                </PrimaryButton>
                <PrimaryButton type="button" variant="danger" onClick={() => void remover()} disabled={ocupado !== null}>
                  <Trash2 size={20} aria-hidden="true" /> Remover voz
                </PrimaryButton>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, lineHeight: 1.6, opacity: 0.9 }}>
                Escolha uma gravação com a voz do paciente: nota de voz, vídeo, áudio antigo. Qualquer formato comum serve. O
                IrisFlow limpa o ruído, corta silêncios e usa os melhores 12 segundos. Quanto mais limpa e longa a gravação (a
                partir de 15 s de fala sem música ao fundo), mais parecida fica a voz.
              </p>
              <PrimaryButton type="button" onClick={() => setTermoAberto(true)} disabled={!estado?.disponivel || ocupado !== null} style={{ alignSelf: 'flex-start' }}>
                <Mic size={20} aria-hidden="true" /> Importar áudio da voz
              </PrimaryButton>
            </>
          )}
          {ultimoResultado && <Aviso tipo="ok">{ultimoResultado}</Aviso>}
        </section>

        {/* Termo */}
        {termoAberto && (
          <section aria-labelledby="voz-termo" style={{ ...caixa, border: '2px solid #1B54A8' }}>
            <h2 id="voz-termo" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <ShieldCheck size={22} aria-hidden="true" /> Termo de consentimento
            </h2>
            {TERMO_DE_CONSENTIMENTO.split('\n\n').map((p, i) => (
              <p key={i} style={{ margin: 0, lineHeight: 1.6 }}>{p}</p>
            ))}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
              <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} style={{ width: 24, height: 24, flexShrink: 0 }} />
              Li e aceito o termo. Tenho autorização para usar esta voz.
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <PrimaryButton type="button" onClick={() => void importar()} disabled={!aceito || ocupado !== null}>
                {ocupado === 'importando' ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
                {ocupado === 'importando' ? 'Preparando o áudio…' : 'Aceitar e escolher o arquivo'}
              </PrimaryButton>
              <PrimaryButton type="button" variant="secondary" onClick={() => { setTermoAberto(false); setAceito(false); }} disabled={ocupado !== null}>
                Cancelar
              </PrimaryButton>
            </div>
          </section>
        )}

        <section style={{ ...caixa, gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1B54A8' }}>Como funciona e o que esperar</h3>
          <p style={{ margin: 0, lineHeight: 1.6, opacity: 0.9, fontSize: '0.95rem' }}>
            A voz é gerada por um modelo aberto (Chatterbox multilíngue, licença MIT) rodando neste computador. Em CPU, uma
            frase nova leva alguns segundos para sair; frases já ditas ficam no cache e saem na hora. Com placa de vídeo NVIDIA
            a geração é quase imediata. Alarmes de emergência e as mensagens lidas do cuidador continuam na voz do sistema —
            a voz clonada é só do paciente.
          </p>
          <PrimaryButton type="button" variant="secondary" onClick={() => navigate('/settings')} style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}>
            Voltar às configurações
          </PrimaryButton>
        </section>
      </div>
    </main>
  );
};
