import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Confirmação própria, no lugar de `window.confirm`.
 *
 * O `confirm` nativo é desenhado pelo Chromium FORA da árvore do React, e isso
 * tem três consequências ruins aqui:
 *
 *   1. O cursor de olhar não existe para ele. O dispatcher de dwell trabalha
 *      com `elementFromPoint` sobre o documento; a caixa nativa não está no
 *      documento. Quem só se comunica pelo olhar via uma pergunta na tela sem
 *      nenhuma forma de responder — e, pior, com o app inteiro travado atrás.
 *   2. Ele bloqueia o event loop do renderer enquanto está aberto: o
 *      rastreamento para, a fila da nuvem para, um pedido de socorro em curso
 *      para.
 *   3. Não tem o tipo de letra, o contraste nem o tamanho do resto do
 *      aplicativo, que foram escolhidos para esta população.
 *
 * As ações que passam por aqui são destrutivas (apagar registros, apagar o que
 * o assistente aprendeu, remover a voz). Por isso os botões levam
 * `data-no-dwell` no PRÓPRIO botão — o dispatcher lê a marca no elemento
 * acionado, não no ancestral — e a confirmação continua sendo, de propósito,
 * uma decisão de mouse: uma fixação acidental não pode apagar nada. O padrão
 * do teclado é "Cancelar" (Esc fecha, foco inicial no cancelar). Clicar no
 * fundo escuro não faz nada de propósito: sair de uma pergunta destrutiva é
 * uma escolha explícita, no botão ou no Esc.
 */

export interface PedidoDeConfirmacao {
  titulo: string;
  descricao?: string;
  confirmar?: string;
  cancelar?: string;
  /** Pinta o botão de confirmação de vermelho. Padrão: sim. */
  destrutivo?: boolean;
}

interface Props extends PedidoDeConfirmacao {
  aberto: boolean;
  onResposta: (ok: boolean) => void;
}

export const DialogoDeConfirmacao: React.FC<Props> = ({
  aberto,
  titulo,
  descricao,
  confirmar = 'Apagar',
  cancelar = 'Cancelar',
  destrutivo = true,
  onResposta,
}) => {
  const cancelarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    cancelarRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResposta(false);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, onResposta]);

  if (!aberto) return null;

  return (
    <div
      data-no-dwell="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147482500,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmacao-titulo"
        aria-describedby={descricao ? 'confirmacao-descricao' : undefined}
        data-no-dwell="true"
        style={{
          width: 560,
          maxWidth: '100%',
          background: 'var(--color-card-bg, #ffffff)',
          color: 'var(--color-text-base, #1e293b)',
          borderRadius: '1.5rem',
          border: '2px solid var(--color-card-border, #e2e8f0)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
          padding: '1.75rem',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <AlertTriangle
            size={32}
            color={destrutivo ? '#b91c1c' : '#F0A030'}
            aria-hidden="true"
            style={{ flex: '0 0 auto', marginTop: 2 }}
          />
          <div style={{ flex: 1 }}>
            <h2 id="confirmacao-titulo" style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800 }}>
              {titulo}
            </h2>
            {descricao && (
              <p
                id="confirmacao-descricao"
                style={{ margin: '0.75rem 0 0', fontSize: '1rem', lineHeight: 1.6, opacity: 0.9 }}
              >
                {descricao}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.75rem', flexWrap: 'wrap' }}>
          <button
            ref={cancelarRef}
            type="button"
            data-no-dwell="true"
            onClick={() => onResposta(false)}
            style={{
              padding: '0.85rem 1.4rem',
              background: 'transparent',
              color: 'var(--color-text-base, #1e293b)',
              border: '2px solid var(--color-card-border, #cbd5e1)',
              borderRadius: '1rem',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '1rem',
            }}
          >
            {cancelar}
          </button>
          <button
            type="button"
            data-no-dwell="true"
            onClick={() => onResposta(true)}
            style={{
              padding: '0.85rem 1.4rem',
              background: destrutivo ? '#b91c1c' : '#1B54A8',
              color: '#ffffff',
              border: 'none',
              borderRadius: '1rem',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: '1rem',
            }}
          >
            {confirmar}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Uso:
 *
 *   const { confirmar, dialogo } = useConfirmacao();
 *   ...
 *   if (!(await confirmar({ titulo: 'Apagar?' }))) return;
 *   ...
 *   return (<>{dialogo}...</>);
 *
 * A promessa resolve `false` se a tela for desmontada com o diálogo aberto —
 * nunca fica pendurada, e "não respondeu" nunca vira "apagou".
 */
export function useConfirmacao() {
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const responder = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () => () => {
      responder.current?.(false);
      responder.current = null;
    },
    [],
  );

  const confirmar = useCallback((p: PedidoDeConfirmacao) => {
    // Um segundo pedido enquanto o primeiro está aberto encerra o anterior
    // como "cancelado": duas confirmações empilhadas seriam impossíveis de ler.
    responder.current?.(false);
    setPedido(p);
    return new Promise<boolean>((resolve) => {
      responder.current = resolve;
    });
  }, []);

  const onResposta = useCallback((ok: boolean) => {
    const r = responder.current;
    responder.current = null;
    setPedido(null);
    r?.(ok);
  }, []);

  const dialogo = (
    <DialogoDeConfirmacao
      aberto={pedido !== null}
      titulo={pedido?.titulo ?? ''}
      descricao={pedido?.descricao}
      confirmar={pedido?.confirmar}
      cancelar={pedido?.cancelar}
      destrutivo={pedido?.destrutivo}
      onResposta={onResposta}
    />
  );

  return { confirmar, dialogo };
}
