# ai-memory (mod do herdr)

Painel que mostra, por cada projeto ai-memory onde há um agente a correr no herdr:
agentes (clicar foca-o), páginas da wiki, mensagens pendentes (com assunto),
handoffs abertos e avisos de captura (servidor em baixo, harness sem hooks,
hooks do Codex por aprovar).

Abrir:  herdr-app do pane.split '{"direction":"right","mod":"ai-memory"}'
        (ou, na paleta ctrl+shift+p, dividir o painel com o mod ai-memory)
Fechar: fecha o pane como qualquer outro.

## Depois de atualizar herdr ou ai-memory

    ~/.config/herdr-app/mods/ai-memory/check.sh [pasta de um projeto]

- Falha do lado ai-memory -> corrigir só `data.js` (lê apenas `--json`).
- Falha do lado herdr     -> corrigir `main.js` (usa só terminals, exec, theme, run).

Atualização: refresh completo a cada 60 s; agentes em pastas novas são
detetados em 5 s. Agentes noutras máquinas (machine/tN) são ignorados.
