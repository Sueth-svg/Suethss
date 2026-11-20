# Screen Share Web Live (MVP)

Primeira versão funcional de compartilhamento de tela pelo navegador, sem login.

## Requisitos
- Node.js 20 ou superior recomendado
- Dois navegadores/dispositivos para testar

## 1. Instalar dependências
Na pasta raiz do projeto:
```bash
npm install
```
Depois, instale as dependências do servidor de sinalização:
```bash
cd server
npm install
```

## 2. Iniciar o servidor de salas
Em um terminal, dentro da pasta `server`:
```bash
npm start
```
Ele ficará disponível em `ws://localhost:3001`.

## 3. Iniciar o site
Em outro terminal, na pasta raiz do projeto:
```bash
npm run dev
```
Abra `http://localhost:5173`.

## 4. Testar
1. Abra o site no navegador A e clique em **Criar sala**.
2. Clique em **Compartilhar minha tela** e escolha a tela/janela/aba.
3. Copie o convite e abra em outro navegador ou dispositivo.
4. O segundo participante entra como espectador, sem cadastro.

Para testar em dois dispositivos na mesma rede, use o endereço LAN do computador que está executando o Vite, mas configure `VITE_SIGNAL_URL` para `ws://IP-DO-COMPUTADOR:3001` antes de iniciar o Vite. O firewall do Windows precisa permitir as portas 5173 e 3001.

## Áudio
O navegador oferece áudio de compartilhamento apenas em combinações compatíveis de navegador e fonte selecionada. No Chrome/Edge, compartilhar uma aba costuma oferecer a opção de áudio da aba. A captura de áudio do sistema inteiro não é uniforme entre navegadores e sistemas operacionais.

## Limitações importantes desta versão
- O servidor de sinalização mantém as salas somente em memória. Reiniciar o servidor encerra todas as salas.
- O MVP usa STUN público para tentar conexões diretas. Para funcionar de forma confiável entre redes diferentes, será necessário configurar um servidor TURN (por exemplo, coturn) e usar HTTPS/WSS em produção.
- O anfitrião transmite para cada espectador por conexão WebRTC individual. É adequado para validar o fluxo inicial, mas não é a arquitetura escalável para muitas pessoas.
- O controle remoto ainda não está implementado.
- A sala não tem senha. Qualquer pessoa com o link/código pode tentar entrar enquanto o anfitrião estiver conectado.

## Publicação
Em produção, hospede o frontend em HTTPS e o servidor de sinalização em WSS. Defina `VITE_SIGNAL_URL=wss://SEU-DOMINIO` antes de compilar o frontend. O serviço de sinalização deve estar acessível pela internet.
