import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirmacao } from './DialogoDeConfirmacao';

function Tela({ aoResponder }: { aoResponder: (ok: boolean) => void }) {
  const { confirmar, dialogo } = useConfirmacao();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          aoResponder(
            await confirmar({ titulo: 'Apagar o aprendizado?', descricao: 'Volta ao padrão de fábrica.' }),
          );
        }}
      >
        abrir
      </button>
      {dialogo}
    </div>
  );
}

describe('useConfirmacao', () => {
  it('resolve true no confirmar e false no cancelar', async () => {
    const usuario = userEvent.setup();
    const respostas: boolean[] = [];
    render(<Tela aoResponder={(ok) => respostas.push(ok)} />);

    await usuario.click(screen.getByText('abrir'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await usuario.click(screen.getByText('Apagar'));
    expect(respostas).toEqual([true]);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await usuario.click(screen.getByText('abrir'));
    await usuario.click(screen.getByText('Cancelar'));
    expect(respostas).toEqual([true, false]);
  });

  it('Esc cancela — o padrão do teclado nunca apaga nada', async () => {
    const usuario = userEvent.setup();
    const respostas: boolean[] = [];
    render(<Tela aoResponder={(ok) => respostas.push(ok)} />);
    await usuario.click(screen.getByText('abrir'));
    await usuario.keyboard('{Escape}');
    expect(respostas).toEqual([false]);
  });

  it('todo botão do diálogo está fora do alcance do olhar', async () => {
    const usuario = userEvent.setup();
    render(<Tela aoResponder={() => undefined} />);
    await usuario.click(screen.getByText('abrir'));
    // O dispatcher lê `data-no-dwell` no PRÓPRIO elemento acionado: uma marca
    // só no ancestral não protegeria os botões.
    const dialogo = screen.getByRole('alertdialog');
    for (const b of Array.from(dialogo.querySelectorAll('button'))) {
      expect(b.getAttribute('data-no-dwell')).toBe('true');
    }
  });

  it('desmontar com o diálogo aberto responde "não" em vez de pendurar a promessa', async () => {
    const usuario = userEvent.setup();
    const respostas: boolean[] = [];
    const { unmount } = render(<Tela aoResponder={(ok) => respostas.push(ok)} />);
    await usuario.click(screen.getByText('abrir'));
    await act(async () => {
      unmount();
    });
    expect(respostas).toEqual([false]);
  });
});
