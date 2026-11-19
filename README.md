# Hangar

Hub local do dia, em português, que roda na sua máquina (http://127.0.0.1:8023/) e junta:

- **TickTick**: o que vence hoje, o que ficou para trás, hábitos e a agenda da semana ou do mês;
- **GitHub**: cards atribuídos a você (com status e sprint de um GitHub Project) e PRs para revisar;
- **GLPI** (opcional): métricas de um servicedesk, só leitura;
- **um vault de notas** (Obsidian ou qualquer pasta de markdown): pendências soltas, quadro de ideias e a pauta do dia;
- **Claude Code** (opcional): escreve a pauta do dia e sugere caminhos de melhoria a partir de tudo isso.

| Aba | O que mostra |
|---|---|
| **Hoje** | A pauta do dia (com checkboxes clicáveis), o que vence hoje, os cards e reviews e as pendências soltas |
| **Noite** | A noite em blocos até o horário de fim que você escolher |
| **Agenda** | Semana ou mês do TickTick |
| **Trabalho** | Cards, PRs, pendências da área de trabalho e o painel do GLPI (o nome da aba é configurável) |
| **Ideias** | Quadro Ideia → Explorando → Proposta → Virou card, e o botão "Sugerir caminhos" |
| **Ajustes** | Toda a configuração, sem editar arquivo, inclusive as cores (temas prontos ou três cores suas) e quais abas aparecem na barra lateral |

Atalhos: `1`–`6` trocam de aba, `R` sincroniza, `N` anota uma pendência.

## Requisitos

- Linux ou macOS com Python 3.10+ (só biblioteca padrão, nada para instalar com pip), `curl` e `xdg-open`/`open`.
- Opcionais, conforme as fontes que você ligar:
  - [TickTick](https://ticktick.com) **app desktop** logado (o Hangar usa a sessão dele);
  - [`gh`](https://cli.github.com) logado (`gh auth login`);
  - um GLPI com a API REST ligada (App-Token e token de usuário);
  - [Claude Code](https://claude.com/claude-code) (`claude` no PATH).

## Instalar

```bash
git clone https://github.com/luanotoni/hangar.git ~/Projetos/hangar
ln -s ~/Projetos/hangar/hangar ~/.local/bin/hangar   # ou qualquer pasta do seu PATH
hangar                                               # sobe o servidor e abre o navegador
```

Na primeira vez a página abre em **Ajustes**: preencha seu nome, a pasta do vault, ligue as fontes que você usa e salve. Para gerar a pauta todo dia sozinho (systemd do usuário):

```bash
hangar timer      # instala hangar-pauta.timer no horário escolhido em Ajustes
```

## Comandos

```
hangar              # sobe o servidor (se precisar) e abre o navegador
hangar noite        # abre direto na Noite
hangar ajustes      # abre direto nos Ajustes
hangar --no-open    # só sobe o servidor
hangar pauta        # gera a pauta de hoje no vault
hangar ideias "foco"  # gera sugestões de caminhos para um foco
hangar timer        # instala/atualiza o timer da pauta
hangar parar        # derruba o servidor
```

## Configuração

Tudo o que é seu fica fora do repositório:

| Arquivo | O quê |
|---|---|
| `~/.config/hangar/config.json` | Nome, perfil, áreas, vault, fontes, prompts, focos. A aba Ajustes lê e grava. Exemplo: [`config.example.json`](config.example.json) |
| `~/.config/hangar/hangar.env` | Segredos (URL e tokens do GLPI), com permissão 600. Exemplo: [`.env.example`](.env.example) |
| `~/.local/share/hangar/` | Cache das fontes e as sessões da noite |
| `~/.local/state/hangar/server.log` | Log do servidor |

Ordem de prioridade: padrões do código → `config.json` → variáveis de ambiente. Qualquer chave pode vir do ambiente como `HANGAR_<SEÇÃO>_<CHAVE>` (por exemplo `HANGAR_VAULT_CAMINHO`, `HANGAR_TRABALHO_GITHUB_ORG`; listas em JSON). Uma chave definida pelo ambiente aparece travada na página. Atalhos: `HANGAR_PORT`, `HANGAR_VAULT`, `HANGAR_CONFIG` e `HANGAR_ENV_FILE`.

Os tokens do GLPI podem vir de `HANGAR_GLPI_URL`, `HANGAR_GLPI_APP_TOKEN` e `HANGAR_GLPI_USER_TOKEN` (ambiente ou `hangar.env`), ou de um `.env` que você já tenha (`glpi.arquivo_credenciais` + `glpi.prefixo_credenciais`, lendo `<prefixo>BASE_URL`, `<prefixo>APP_TOKEN` e `<prefixo>USER_TOKEN`). Eles nunca vão para o navegador: a página só sabe se estão definidos.

## Como funciona

- `server.py` escuta só em 127.0.0.1 e recusa escrita sem o cabeçalho `X-Hangar` ou com outro Host/Origin.
- **Rápido por desenho:** cada fonte (`hub/store.py`) fica em memória e num snapshot em disco. A página recebe o último snapshot na hora, e o servidor busca de novo em segundo plano quando ele passa da validade (TickTick 90 s, GitHub 5 min, GLPI 15 min).
- **TickTick** (`hub/ticktick.py`): lê a sessão do app desktop (`ticktick.sessao`). Escreve só três coisas: concluir tarefa, empurrar um dia e check-in de hábito. A API usada é a mesma do app, não a pública: pode mudar sem aviso.
- **GitHub** (`hub/github.py`): `gh api graphql`, só leitura. Status vem do campo `Status` do Project; a sprint é qualquer campo de iteração.
- **GLPI** (`hub/glpi.py`): só `GET /search/Ticket`. Grupos com o prefixo configurado (ex.: `Squad `) viram as equipes do gráfico.
- **Vault** (`hub/vault.py`): lê e escreve as notas de pendências, ideias e a pauta do dia (`AAAA-MM-DD - Pauta do dia.md`). As notas continuam editáveis à mão.
- **Claude** (`hub/claude.py`): o servidor monta o contexto e chama `claude -p --tools ""` (sem ferramentas, sem sessão salva). O Claude só lê o texto que recebe e devolve markdown ou JSON; quem grava no vault é o hub. Perfil, regras extras, seções da pauta e notas de contexto saem dos Ajustes.
- Teste fora de hora: `?agora=19:30` simula o relógio na aba Noite (os botões continuam escrevendo de verdade).

Design: marinho de cabine, azul de estrutura, laranja de sinal e branco, com Oxanium e Atkinson Hyperlegible Next servidas localmente em `web/fonts/` (SIL OFL 1.1).

## Licença

[MIT](LICENSE).
