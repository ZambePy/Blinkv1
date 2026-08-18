# Auditoria — Sprint 0

> Estado do repositório em `f9d9252` (tag `v0-melhor-erro`). Consertar nada
> ainda: só documentar o que está e o que não está.

---

## A0-2 — Compilação e testes

Executado em 2026-08-18, Windows 11, Node de acordo com `package.json`
engines-implícito.

| Comando | Resultado | Notas |
|---|---|---|
| `npm install` | ✅ passou | 390 pacotes auditados, 0 removidos/adicionados; 7 vulnerabilidades (1 moderate, 6 high) reportadas. Nenhum erro de instalação. |
| `npm --prefix frontend install` | ✅ passou | 198 pacotes, 1 high vuln, aviso de peer conflict com `vite@7.3.6` requerido por `@vitest/mocker@3.2.7`. Não bloqueia. |
| `npm test` | ✅ passou | 12 arquivos, **69 testes**, todos verdes. 4,87 s. |
| `npm run build` | ✅ passou | Vite build em 4,29 s. Aviso de plugin timings (css-post 30%, worker 26%). Bundle principal `index-*.js` 210 kB / 66,5 kB gzip. |
| `npm run electron:compile` | ✅ passou | `dist-electron/main.cjs` (2,7 kB) e `preload.cjs` (806 B) em 7 ms. |

**Conclusão:** o repositório está saudável no ponto `v0-melhor-erro`. Nenhum
conserto necessário para desbloquear o Sprint 0. Vulnerabilidades de `npm
audit` ficam fora do escopo desta fase (correção de dependência pode mexer em
comportamento — regra 4 do plano).

### Ações não-bloqueantes registradas para depois

- Revisar 7 vulnerabilidades do root e 1 do frontend (`npm audit`) — decidir
  se cabem no sprint de higiene A3.
- Investigar peer conflict `vite@7.3.6` × `@vitest/mocker` — pode virar bug
  latente se `vite` ou `vitest` subirem de versão.

---

## A0-3 — Degradação silenciosa

_(a preencher pela varredura da próxima tarefa)_

## A0-4 — Estado mutável de módulo

_(a preencher)_
