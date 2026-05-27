# SeoTime Multi-Bot

Multi-Session Automation System para SeoTime.biz

## Funcionalidades

- Login automático via API mobile do SeoTime
- Múltiplas contas simultâneas (até 20)
- Múltiplas sessões por conta
- Coleta automática de views
- Interface web em tempo real com Socket.IO
- Logs detalhados de atividade
- Painel admin
- Suporte a proxy (DataImpulse)

## Como Usar

1. Acesse a interface web
2. Adicione suas contas SeoTime (email + senha)
3. Configure o número de sessões por conta
4. Clique em "INICIAR TODAS"
5. Acompanhe os ganhos em tempo real

## Deploy

### Railway
1. Conecte o repositório ao Railway
2. O deploy é automático via Dockerfile

### Local
```bash
pnpm install
node server.js
```

## Tecnologias

- Node.js + Express
- Socket.IO (tempo real)
- API Mobile SeoTime (reverse-engineered)
- HMAC-SHA256 para autenticação

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| PORT | Porta do servidor | 3000 |

## Aviso

Use por sua conta e risco. Este projeto é apenas para fins educacionais.
