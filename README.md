# Evolution QR

Gera um link para o cliente conectar o WhatsApp no momento em que puder. A página mostra o QR Code atual da Evolution API e acompanha cada renovação, sem o cliente precisar recarregar.

## Como funciona

1. No painel, você escolhe a instância, o nome do cliente e a validade, e copia o link.
2. O cliente abre o link. A página busca o QR a cada 2 segundos.
3. Quando o WhatsApp conecta, a página confirma e o link é encerrado.

Regras importantes:

- **A Evolution só é consultada com alguém na página.** Um link enviado e ainda não aberto não consome nada, então o cliente pode abrir horas depois.
- **O link serve para uma conexão.** Depois de conectado ele não gera outro QR, mesmo que a instância caia. Para reconectar, gere um novo link.
- **Quem tem o link pode parear o WhatsApp na instância.** Envie só para o cliente e use a menor validade que atender. Dá para cancelar um link no painel.
- **A chave da Evolution fica no servidor.** O navegador do cliente não vê a chave nem o nome da instância.
- **A página pausa depois de 10 minutos** e mostra um botão para voltar ao QR. Isso evita que uma aba esquecida fique abrindo sessões na Evolution.

O sistema não configura webhook. A Evolution guarda um webhook por instância, e registrar outro apagaria o que você já usa (n8n, Chatwoot etc.).

## Instalação no Easypanel

### 1. Postgres

No seu projeto, crie um serviço **Postgres** e copie a **Internal Connection URL**. Pode ser um banco que você já tenha: a tabela `links` é criada sozinha na primeira execução.

### 2. Aplicação

1. Crie um serviço **App**.
2. Em **Source**, aponte para o repositório Git deste projeto ou envie a pasta por upload.
3. Em **Build**, escolha **Dockerfile**.
4. Em **Environment**, preencha as variáveis:

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | A Internal Connection URL do passo 1 |
   | `EVOLUTION_URL` | Endereço da sua Evolution, sem barra no final |
   | `EVOLUTION_API_KEY` | A chave global (`AUTHENTICATION_API_KEY` da Evolution) |
   | `ADMIN_PASSWORD` | Senha do painel |

5. Em **Domains**, adicione o domínio (por exemplo `conectar.seudominio.com`) com a porta **3000**. Use HTTPS, porque o botão Copiar do painel depende dele.
6. Clique em **Deploy** e acesse o domínio para entrar no painel.

Se a Evolution estiver no mesmo projeto do Easypanel, você pode usar o endereço interno dela em `EVOLUTION_URL`.

### Confira na sua Evolution

- **`DEL_INSTANCE`**: se tiver um número de minutos, a Evolution apaga instâncias não conectadas depois desse tempo, e o link para de funcionar antes de o cliente abrir. Deixe como `false` ou use um tempo maior que a validade dos links.
- **`QRCODE_LIMIT`**: quantos QRs a Evolution gera por sessão. Ao chegar no limite, a sessão fecha e a página abre outra sozinha, com uma espera curta.

## Desenvolvimento

```bash
cp .env.example .env
npm install
npm run dev
```

Os testes precisam de um Postgres descartável. **A tabela `links` desse banco é apagada a cada execução.**

```bash
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/teste npm test
```
