import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowLeft, Check, Command, Copy, Link2, LogIn, MonitorUp, Plus, Radio, ShieldCheck, Users, Video, VideoOff, Volume2, XCircle } from 'lucide-react';

type Role = 'host' | 'viewer';
type Signal = { type: string;[key: string]: any };
const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || 'ws://localhost:3001';
const rtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export default function App() {
  const [room, setRoom] = useState('');
  const [role, setRole] = useState<Role>('host');
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingHostIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const roomUrl = room ? `${window.location.origin}${window.location.pathname}?sala=${room}` : '';

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('sala');
    if (code && /^[A-Z0-9]{6}$/i.test(code)) { setRoom(code.toUpperCase()); setRole('viewer'); setStatus('Conectando à sala...'); }
  }, []);

  const send = useCallback((payload: Signal) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const closeConnections = useCallback(() => {
    pcsRef.current.forEach(pc => pc.close());
    pcsRef.current.clear();
    wsRef.current?.close();
    wsRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setConnected(false); setSharing(false); setViewerCount(0); setHasVideo(false); setHasAudio(false);
  }, []);

  const createPeer = useCallback((peerId: string) => {
    const pc = new RTCPeerConnection(rtcConfig);
    pcsRef.current.set(peerId, pc);
    if (role === 'host' && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
    }
    pc.onicecandidate = event => { if (event.candidate) send({ type: 'ice', targetId: peerId, candidate: event.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        if (role === 'host') { pcsRef.current.delete(peerId); setViewerCount(pcsRef.current.size); }
      }
    };
    if (role === 'viewer') {
      pc.ontrack = event => {
        const stream = event.streams[0];
        if (!stream) return;

        remoteStreamRef.current = stream;
        setHasVideo(stream.getVideoTracks().length > 0);
        setHasAudio(stream.getAudioTracks().length > 0);

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          void remoteVideoRef.current.play().catch(error => {
            console.error('Erro ao reproduzir vídeo remoto:', error);
          });
        }
      };
    }
    return pc;
  }, [role, send]);

  useEffect(() => {
    if (!room) return;
    setError('');
    setStatus('Conectando ao servidor da sala...');
    const ws = new WebSocket(SIGNAL_URL);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', roomId: room, role }));
    ws.onmessage = async event => {
      let msg: Signal;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'joined') { setConnected(true); setStatus(role === 'host' ? 'Sala criada. Compartilhe o convite.' : 'Conectado. Aguardando o anfitrião iniciar a transmissão.'); }
      if (msg.type === 'error') { setError(msg.message || 'Não foi possível entrar na sala.'); setStatus(''); }
      if (msg.type === 'viewer-joined' && role === 'host') {
        const pc = createPeer(msg.peerId);
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        send({ type: 'offer', targetId: msg.peerId, description: pc.localDescription });
        setViewerCount(pcsRef.current.size);
      }
      if (msg.type === 'offer' && role === 'viewer') {
        const pc = pcsRef.current.get(msg.fromId) || createPeer(msg.fromId);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.description));
        for (const candidate of pendingIceRef.current) await pc.addIceCandidate(candidate);
        pendingIceRef.current = [];
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        send({ type: 'answer', targetId: msg.fromId, description: pc.localDescription });
        setStatus('Conectando à transmissão...');
      }
      if (msg.type === 'answer' && role === 'host') {
        const pc = pcsRef.current.get(msg.fromId);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.description));
          const queued = pendingHostIceRef.current.get(msg.fromId) || [];
          for (const candidate of queued) await pc.addIceCandidate(candidate);
          pendingHostIceRef.current.delete(msg.fromId);
        }
      }
      if (msg.type === 'ice') {
        const pc = pcsRef.current.get(msg.fromId);
        if (pc?.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        else if (role === 'viewer') pendingIceRef.current.push(msg.candidate);
        else { const queue = pendingHostIceRef.current.get(msg.fromId) || []; queue.push(msg.candidate); pendingHostIceRef.current.set(msg.fromId, queue); }
      }
      if (msg.type === 'peer-left' && role === 'host') {
        pcsRef.current.get(msg.peerId)?.close(); pcsRef.current.delete(msg.peerId); setViewerCount(pcsRef.current.size);
      }
      if (msg.type === 'room-closed') { setError(msg.reason || 'A sala foi encerrada.'); closeConnections(); }
    };
    ws.onerror = () => { setError('Não foi possível conectar ao servidor. Verifique se o servidor de salas está iniciado.'); setStatus(''); };
    ws.onclose = () => { if (wsRef.current === ws) setConnected(false); };
    return () => { ws.close(); if (wsRef.current === ws) wsRef.current = null; pcsRef.current.forEach(pc => pc.close()); pcsRef.current.clear(); };
  }, [room, role, closeConnections, createPeer, send]);

  async function startShare() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; void localVideoRef.current.play().catch(() => { }); }
      setSharing(true); setHasVideo(true); setHasAudio(stream.getAudioTracks().length > 0);
      stream.getVideoTracks()[0].addEventListener('ended', () => stopShare());
      setStatus('Sua tela está sendo transmitida.');
      pcsRef.current.forEach(pc => stream.getTracks().forEach(track => pc.addTrack(track, stream)));
      // Peers that joined before sharing need a fresh negotiation with the new media tracks.
      for (const [peerId, pc] of pcsRef.current.entries()) {
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        send({ type: 'offer', targetId: peerId, description: pc.localDescription });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível iniciar o compartilhamento.';
      setError(message.includes('Permission denied') ? 'A permissão para compartilhar a tela foi negada.' : message);
    }
  }

  function stopShare() {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setSharing(false); setHasVideo(false); setHasAudio(false); setStatus('Compartilhamento encerrado.');
    pcsRef.current.forEach(pc => pc.getSenders().forEach(sender => { if (sender.track) pc.removeTrack(sender); }));
  }

  function createRoom() {
    closeConnections();
    const code = makeCode(); setRole('host'); setRoom(code); setError(''); setStatus('Preparando sua sala...');
    history.pushState({}, '', `?sala=${code}`);
  }
  function joinRoom(e: FormEvent) {
    e.preventDefault(); const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { setError('Digite um código válido de 6 caracteres.'); return; }
    closeConnections(); setRole('viewer'); setRoom(code); setError(''); setStatus('Entrando na sala...');
    history.pushState({}, '', `?sala=${code}`);
  }
  function leaveRoom() { closeConnections(); setRoom(''); setError(''); setStatus(''); history.pushState({}, '', location.pathname); }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(roomUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError('Não foi possível copiar. Copie o endereço da barra do navegador.'); }
  }

  if (room) return <div className="live-shell">
    <header className="live-nav"><a className="live-brand" href="#" onClick={e => { e.preventDefault(); leaveRoom(); }}><span><Command size={18} /></span> NOME DO PROJETO</a><button className="ghost" onClick={leaveRoom}><ArrowLeft size={16} /> Sair da sala</button></header>
    <main className="live-main">
      <div className="live-heading"><div><div className="live-kicker"><i /> SALA PRIVADA · {room}</div><h1>{role === 'host' ? 'Sua sala está pronta.' : 'Você entrou na sala.'}</h1><p>{role === 'host' ? 'Compartilhe o convite e inicie sua transmissão.' : 'Aguarde o anfitrião compartilhar a tela.'}</p></div><div className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Conectado' : 'Conectando'}</div></div>
      {role === 'host' ? <section className="host-layout">
        <div className="screen-card"><div className="screen-top"><span><Radio size={15} /> TRANSMISSÃO</span><span className={sharing ? 'live-tag' : 'idle-tag'}>{sharing ? 'AO VIVO' : 'AGUARDANDO'}</span></div>
          <div className="screen-stage">{sharing ? <video
            ref={video => {
              localVideoRef.current = video;
              const stream = localStreamRef.current;
              if (video && stream) {
                video.srcObject = stream;
                void video.play().catch(error => console.error('Erro ao reproduzir prévia:', error));
              }
            }}
            autoPlay muted playsInline
          /> : <div className="screen-placeholder"><MonitorUp size={46} /><b>Sua tela aparecerá aqui</b><small>Quando estiver pronto, clique em iniciar transmissão.</small></div>}</div>
          <div className="screen-controls">{sharing ? <button className="danger" onClick={stopShare}><XCircle size={17} /> Parar transmissão</button> : <button className="primary-live" onClick={startShare} disabled={!connected}><MonitorUp size={17} /> Compartilhar minha tela</button>}<span><Users size={15} /> {viewerCount} participante(s)</span></div>
        </div>
        <aside className="invite-card"><div className="invite-icon"><Link2 size={20} /></div><h2>Convide alguém</h2><p>Envie o link abaixo. A pessoa entra direto, sem login.</p><label>LINK DA SALA</label><div className="invite-link">{roomUrl}</div><button className="primary-live full" onClick={copyInvite}><Copy size={16} />{copied ? 'Link copiado!' : 'Copiar convite'}</button><div className="invite-code-label">OU COMPARTILHE O CÓDIGO</div><div className="invite-code">{room}</div><div className="hint"><ShieldCheck size={15} /> Compartilhe este link apenas com quem deve assistir.</div></aside>
      </section> : <section className="viewer-card"><div className="viewer-stage">{hasVideo ? <video
        ref={video => {
          remoteVideoRef.current = video;
          const stream = remoteStreamRef.current;
          if (video && stream) {
            video.srcObject = stream;
            void video.play().catch(error => console.error('Erro ao reproduzir vídeo remoto:', error));
          }
        }}
        autoPlay playsInline controls
      /> : <div className="screen-placeholder"><MonitorUp size={48} /><b>{connected ? 'Aguardando compartilhamento...' : 'Conectando à sala...'}</b><small>Quando o anfitrião iniciar, a tela aparecerá aqui.</small></div>}</div><div className="viewer-footer"><span><Users size={15} /> Você está assistindo</span><span>{hasAudio ? <><Volume2 size={15} /> Áudio disponível</> : <><Volume2 size={15} /> Sem áudio recebido</>}</span></div></section>}
      {status && <div className="status-line">{status}</div>}{error && <div className="error-line">{error}</div>}
      <p className="browser-note">A captura de tela funciona em navegadores modernos e exige permissão do usuário. Para compartilhar áudio do sistema, a opção depende do navegador e da fonte escolhida.</p>
    </main>
  </div>;

  return <div className="live-home"><header className="live-nav"><a className="live-brand" href="#"><span><Command size={18} /></span> NOME DO PROJETO</a><a className="ghost" href="#acesso">Entrar em uma sala <ArrowRight size={15} /></a></header>
    <main className="home-main"><div className="home-copy"><div className="live-kicker"><i /> COMPARTILHAMENTO DE TELA EM TEMPO REAL</div><h1>Sua tela.<br /><em>Em qualquer lugar.</em></h1><p>Crie uma sala, compartilhe o convite e transmita sua tela diretamente pelo navegador. Sem login e sem instalação.</p><a className="primary-live" href="#acesso">Começar agora <ArrowRight size={17} /></a><div className="home-points"><span><Check size={15} /> Sem cadastro</span><span><Check size={15} /> Link instantâneo</span><span><Check size={15} /> No navegador</span></div></div><div className="home-art"><div className="art-glow" /><div className="art-window"><div><i /><i /><i /><b>SESSÃO AO VIVO</b></div><MonitorUp size={65} /><strong>Compartilhe sua tela</strong><small>Conecte-se em segundos</small><div className="art-bars"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="art-chip"><Radio size={15} /> Transmissão em tempo real</div></div></main>
    <section className="access-area" id="acesso"><div className="access-heading"><div className="live-kicker"><i /> ACESSO RÁPIDO</div><h2>Por onde vamos começar?</h2><p>Crie sua própria sala ou entre com o código que recebeu.</p></div><div className="access-grid"><article><div className="access-symbol"><Plus /></div><h3>Criar uma sala</h3><p>Gere um convite exclusivo e seja o anfitrião da transmissão.</p><button className="primary-live full" onClick={createRoom}>Criar sala <ArrowRight size={16} /></button></article><article><div className="access-symbol"><LogIn /></div><h3>Entrar em uma sala</h3><p>Digite o código de seis caracteres enviado pelo anfitrião.</p><form onSubmit={joinRoom}><input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="EX: A8K2PZ" maxLength={6} /><button className="primary-live" type="submit">Entrar <ArrowRight size={16} /></button></form></article></div>{error && <div className="error-line">{error}</div>}</section>
    <footer className="live-footer"><span>© 2026 · NOME DO PROJETO</span><span>Compartilhe com liberdade.</span></footer>
  </div>;
}