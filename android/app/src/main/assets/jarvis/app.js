const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const HISTORY_KEY = 'jarvis.chat.v1';
const state = {
  messages: [], provider: 'openrouter', model: 'openrouter/free', hasKey: false,
  ollama: { available: false, models: [] }, busy: false, recognition: null, toastTimer: null,
};

const CONFIG_KEY = 'jarvis.android.config.v1';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const ANDROID_SYSTEM_PROMPT = `Te llamas Jarvis. Responde en español salvo que te pidan otro idioma. Eres un asistente personal para Android: explicas, resuelves dudas, estudias con la persona y ayudas a programar. Puedes crear código y planes paso a paso, pero no puedes abrir aplicaciones ni controlar el ordenador desde el móvil. Si la persona pide controlar Windows, explícale esa limitación con claridad. Sé útil, directo y seguro. No solicites datos sensibles.`;
let deferredInstallPrompt = null;

function readConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
      provider: 'openrouter',
      model: String(config.model || 'openrouter/free'),
      apiKey: String(config.apiKey || ''),
    };
  } catch {
    return { provider: 'openrouter', model: 'openrouter/free', apiKey: '' };
  }
}

function writeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

try {
  const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (Array.isArray(stored)) state.messages = stored.filter(item => item && ['user', 'assistant', 'tool'].includes(item.role)).slice(-80);
} catch { state.messages = []; }

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.messages.slice(-80))); } catch { /* Private browsing can disable storage. */ }
}

async function api(path, body) {
  const config = readConfig();
  if (path === '/api/status') {
    return { provider: config.provider, model: config.model, keyConfigured: Boolean(config.apiKey), ollama: { available: false, models: [] } };
  }
  if (path === '/api/config') {
    if (body?.provider !== 'openrouter') throw new Error('En Android puedes usar un modelo online; Ollama solo funciona en el ordenador.');
    const model = String(body.model || '').trim().slice(0, 120);
    const apiKey = String(body.apiKey || '').trim() || config.apiKey;
    if (!model) throw new Error('Indica el nombre del modelo.');
    if (!apiKey) throw new Error('Añade tu clave de OpenRouter.');
    writeConfig({ provider: 'openrouter', model, apiKey });
    return { provider: 'openrouter', model, keyConfigured: true, ollama: { available: false, models: [] } };
  }
  if (path === '/api/action') {
    throw new Error('El control del ordenador está disponible en la aplicación de Windows, no en Android.');
  }
  if (path === '/api/chat') {
    if (!config.apiKey) throw new Error('Configura tu clave de OpenRouter en Ajustes antes de hablar con Jarvis.');
    const safeMessages = Array.isArray(body?.messages) ? body.messages.slice(-36) : [];
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rmcarmwrestling-sys.github.io/jarvis-installer/jarvis/',
        'X-Title': 'Jarvis para Android',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: ANDROID_SYSTEM_PROMPT }, ...safeMessages],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `El proveedor respondió con el error ${response.status}.`);
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('El proveedor devolvió una respuesta vacía.');
    return { message, model: data.model || config.model, approvalRequired: false };
  }
  throw new Error('Ruta no disponible en Android.');
}

function toast(message, duration = 3400) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('visible'), duration);
}

function setBusy(value) {
  state.busy = value;
  $('#sendButton').disabled = value;
  $('#messageInput').readOnly = value;
  $('#newChat').disabled = value;
  $('#newChat').style.opacity = value ? '.55' : '';
  $('#sendButton').classList.toggle('working', value);
}

function visibleHistory() {
  $('#welcome').hidden = state.messages.some(message => message.role === 'user' || (message.role === 'assistant' && (message.content || message.tool_calls?.length)));
  const conversation = $('#conversation');
  conversation.replaceChildren();
  for (const message of state.messages) {
    if (message.role === 'tool' || (message.role === 'assistant' && !readable(message.content))) continue;
    addMessageElement(message.role, readable(message.content));
  }
  scrollToBottom();
}

function readable(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text || '').filter(Boolean).join('\n');
  return '';
}

function addMessageElement(role, content) {
  if (!content) return;
  const row = document.createElement('article');
  row.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'TÚ' : 'J';
  const body = document.createElement('div');
  body.className = 'message-body';
  const head = document.createElement('div');
  head.className = 'message-head';
  const name = document.createElement('span');
  name.textContent = role === 'user' ? 'Tú' : 'Jarvis';
  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  head.append(name, time);
  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = content;
  body.append(head, text);
  if (role !== 'user') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.className = 'mini-action';
    copy.type = 'button';
    copy.textContent = 'Copiar';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(content); toast('Respuesta copiada.'); }
      catch { toast('El navegador no permitió copiar el texto.'); }
    });
    const speak = document.createElement('button');
    speak.className = 'mini-action';
    speak.type = 'button';
    speak.textContent = '▶ Escuchar';
    speak.addEventListener('click', () => speakText(content));
    actions.append(copy, speak);
    body.append(actions);
  }
  row.append(avatar, body);
  $('#conversation').append(row);
}

function appendMessage(message) {
  state.messages.push(message);
  state.messages = state.messages.slice(-80);
  saveHistory();
  if (message.role === 'user' || (message.role === 'assistant' && readable(message.content))) {
    $('#welcome').hidden = true;
    addMessageElement(message.role, readable(message.content));
  }
  scrollToBottom();
}

function scrollToBottom() {
  const stage = $('#chatStage');
  requestAnimationFrame(() => { stage.scrollTop = stage.scrollHeight; });
}

function typingIndicator() {
  const row = document.createElement('article');
  row.className = 'message assistant';
  row.id = 'typingIndicator';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = 'J';
  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = '<div class="message-head">Jarvis</div><div class="typing" aria-label="Jarvis está pensando"><i></i><i></i><i></i></div>';
  row.append(avatar, body);
  $('#conversation').append(row);
  scrollToBottom();
  return row;
}

const toolNames = {
  get_system_info: ['Consultar este equipo', 'Jarvis verá datos básicos del sistema.'],
  list_projects: ['Ver tus proyectos', 'Jarvis consultará los nombres de los proyectos de su carpeta.'],
  read_project_file: ['Leer un archivo local', args => `Jarvis leerá «${args.project || ''}/${args.file || ''}».`],
  create_project: ['Crear un proyecto', args => `Jarvis guardará ${Array.isArray(args.files) ? args.files.length : 'varios'} archivo(s) en «${args.name || ''}».`],
  write_project_file: ['Guardar un archivo', args => `Jarvis guardará cambios en «${args.project || ''}/${args.file || ''}». Si ya existe, conservará una copia anterior.`],
  open_app: ['Abrir una aplicación', args => `Se abrirá ${args.app || 'la aplicación seleccionada'}.`],
  open_url: ['Abrir un enlace', args => `El navegador abrirá ${args.url || 'la dirección seleccionada'}.`],
  open_project: ['Abrir un proyecto', args => `Se abrirá «${args.project || ''}/${args.file || 'index.html'}» en el navegador.`],
  run_powershell: ['Controlar Windows con PowerShell', args => `${args.purpose || 'Jarvis ejecutará un script.'} Se ejecutará con los permisos de tu cuenta de Windows; revisa el script antes de permitirlo.`],
};

function actionDescription(name, args) {
  const meta = toolNames[name] || ['Usar una herramienta local', 'Jarvis solicita permiso para continuar.'];
  return { title: meta[0], caption: typeof meta[1] === 'function' ? meta[1](args) : meta[1] };
}

function requestApproval(call) {
  let args = {};
  try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function.arguments || {}); }
  catch { args = { aviso: 'Los parámetros no se pudieron interpretar.' }; }
  const description = actionDescription(call.function.name, args);
  const card = document.createElement('div');
  card.className = 'action-card';
  const top = document.createElement('div');
  top.className = 'action-top';
  const symbol = document.createElement('div');
  symbol.className = 'action-symbol';
  symbol.textContent = '⌁';
  const copy = document.createElement('div');
  copy.className = 'action-copy';
  const title = document.createElement('div');
  title.className = 'action-title';
  title.textContent = description.title;
  const caption = document.createElement('div');
  caption.className = 'action-caption';
  caption.textContent = description.caption;
  copy.append(title, caption);
  top.append(symbol, copy);
  const details = document.createElement('details');
  details.className = 'action-details';
  if (call.function.name === 'run_powershell') details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Ver detalles de la acción';
  const preview = document.createElement('pre');
  const previewText = JSON.stringify(args, null, 2);
  preview.textContent = call.function.name === 'run_powershell' ? previewText : previewText.slice(0, 12000);
  details.append(summary, preview);
  const footer = document.createElement('div');
  footer.className = 'action-footer';
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = 'Esperando tu autorización';
  const deny = document.createElement('button');
  deny.className = 'deny-button';
  deny.type = 'button';
  deny.textContent = 'Rechazar';
  const allow = document.createElement('button');
  allow.className = 'allow-button';
  allow.type = 'button';
  allow.textContent = 'Permitir';
  footer.append(status, deny, allow);
  card.append(top, details, footer);
  $('#pendingArea').append(card);
  scrollToBottom();

  return new Promise(resolve => {
    let settled = false;
    const finish = approved => {
      if (settled) return;
      settled = true;
      allow.disabled = true;
      deny.disabled = true;
      status.textContent = approved ? 'Autorizada · ejecutando…' : 'Acción rechazada';
      if (!approved) card.dataset.finished = 'true';
      resolve({ approved, args, card, status });
    };
    allow.addEventListener('click', () => finish(true));
    deny.addEventListener('click', () => finish(false));
  });
}

async function handleTool(call) {
  const approval = await requestApproval(call);
  let result;
  if (!approval.approved) {
    result = { error: 'La persona rechazó esta acción. No se ejecutó.' };
  } else {
    try {
      result = await api('/api/action', { approved: true, name: call.function.name, arguments: approval.args });
      approval.status.textContent = 'Acción completada';
      approval.status.style.color = '#9bd6c0';
      const resultLine = document.createElement('div');
      resultLine.className = 'action-result';
      resultLine.textContent = JSON.stringify(result.result);
      approval.card.append(resultLine);
      if (call.function.name === 'create_project' || call.function.name === 'write_project_file') refreshProjectsLabel();
    } catch (error) {
      result = { error: error.message };
      approval.status.textContent = 'No se pudo completar';
      approval.status.style.color = '#e8a099';
      const resultLine = document.createElement('div');
      resultLine.className = 'action-result error';
      resultLine.textContent = error.message;
      approval.card.append(resultLine);
    }
  }
  const payload = JSON.stringify(result);
  return { role: 'tool', tool_call_id: call.id, name: call.function.name, content: payload };
}

async function sendCurrent(textOverride) {
  if (state.busy) return;
  const text = (textOverride ?? $('#messageInput').value).trim();
  if (!text) return;
  $('#messageInput').value = '';
  resizeInput();
  appendMessage({ role: 'user', content: text });
  setBusy(true);
  let indicator = typingIndicator();
  try {
    let completed = false;
    for (let turn = 0; turn < 6; turn++) {
      indicator?.remove();
      indicator = typingIndicator();
      const response = await api('/api/chat', { messages: state.messages });
      indicator?.remove();
      indicator = null;
      const assistant = response.message || { role: 'assistant', content: 'No recibí una respuesta.' };
      if (!assistant.role) assistant.role = 'assistant';
      appendMessage(assistant);
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      if (!calls.length) { completed = true; break; }
      for (const item of calls) {
        const call = { ...item, id: item.id || `call_${crypto.randomUUID().replaceAll('-', '')}` };
        const toolMessage = await handleTool(call);
        appendMessage(toolMessage);
      }
    }
    if (!completed) toast('He detenido la secuencia tras varias acciones. Puedes pedirme que continúe.', 4500);
  } catch (error) {
    indicator?.remove();
    const message = `No he podido completar la respuesta. ${error.message}`;
    appendMessage({ role: 'assistant', content: message });
    toast(error.message, 4500);
  } finally {
    setBusy(false);
    $('#messageInput').focus();
    scrollToBottom();
  }
}

function resizeInput() {
  const input = $('#messageInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function setConnection(status) {
  state.provider = status.provider || 'openrouter';
  state.model = status.model || (state.provider === 'ollama' ? '' : 'openrouter/free');
  state.hasKey = Boolean(status.keyConfigured);
  state.ollama = { available: false, models: [] };
  const label = state.hasKey ? 'ONLINE' : 'CONFIGURAR';
  $('#connectionLabel').textContent = label;
  $('#localLabel').textContent = 'APLICACIÓN ANDROID';
  $('#providerLine').innerHTML = '';
  const text = document.createElement('span');
  text.textContent = state.hasKey ? 'Modelo online conectado' : 'Conecta un modelo online';
  const arrow = document.createElement('span');
  arrow.textContent = '›';
  $('#providerLine').append(text, arrow);
  $('#providerSelect').value = state.provider;
  $('#remoteModel').value = state.provider === 'openrouter' ? state.model : 'openrouter/free';
  if (state.provider === 'ollama') $('#localModel').value = state.model;
  const list = $('#ollamaModels');
  list.replaceChildren();
  state.ollama.models.forEach(model => { const option = document.createElement('option'); option.value = model; list.append(option); });
  updateSettingsDetails();
}

async function refreshStatus() {
  try { setConnection(await api('/api/status')); }
  catch { $('#connectionLabel').textContent = 'SIN CONEXIÓN'; }
}

function updateSettingsDetails() {
  const local = false;
  $('#providerSelect').value = 'openrouter';
  $('#localDetails').hidden = true;
  $('#remoteDetails').hidden = false;
  const status = $('#ollamaStatus');
  status.classList.toggle('offline', !state.ollama.available);
  status.replaceChildren();
  const dot = document.createElement('i');
  const text = document.createElement('span');
  text.textContent = 'Los modelos locales están disponibles en la aplicación de Windows';
  status.append(dot, text);
}

function openSettings() {
  $('#settingsError').hidden = true;
  $('#apiKeyInput').value = '';
  if (state.provider === 'openrouter') $('#remoteModel').value = state.model || 'openrouter/free';
  if (state.provider === 'ollama') $('#localModel').value = state.model || '';
  updateSettingsDetails();
  $('#settingsDialog').showModal();
}

async function saveSettings() {
  const button = $('#saveSettings');
  const provider = 'openrouter';
  const model = $('#remoteModel').value.trim();
  const key = $('#apiKeyInput').value.trim();
  const error = $('#settingsError');
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Guardando…';
  try {
    const result = await api('/api/config', { provider, model, apiKey: key });
    $('#settingsDialog').close();
    await refreshStatus();
    toast('Jarvis ya puede responder desde Android.');
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Guardar ajustes <span>→</span>';
  }
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return toast('Este navegador no ofrece voz sintética.');
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
  utterance.lang = 'es-ES';
  const voice = speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith('es'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return toast('Este navegador no ofrece reconocimiento de voz. Prueba con Microsoft Edge o Chrome.');
  if (state.recognition) { state.recognition.stop(); return; }
  const recognition = new Recognition();
  state.recognition = recognition;
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => { $('#voiceStatus').hidden = false; $('#micButton').classList.add('listening'); };
  recognition.onresult = event => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) sendCurrent(transcript);
  };
  recognition.onerror = event => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') toast('Permite el micrófono en el navegador y vuelve a intentarlo.');
    else if (event.error !== 'no-speech' && event.error !== 'aborted') toast('No se pudo reconocer la voz. Inténtalo de nuevo.');
  };
  recognition.onend = () => {
    state.recognition = null;
    $('#voiceStatus').hidden = true;
    $('#micButton').classList.remove('listening');
  };
  try { recognition.start(); }
  catch { state.recognition = null; toast('No se pudo activar el micrófono.'); }
}

function setVoiceCapability() {
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  $('#voiceRibbon').textContent = supported ? 'VOZ DISPONIBLE' : 'VOZ NO COMPATIBLE';
  $('#voiceRibbon').classList.toggle('voice-unavailable', !supported);
}

async function refreshProjectsLabel() {
  // Project names are available through Jarvis after authorization.
}

$('#composerForm').addEventListener('submit', event => { event.preventDefault(); sendCurrent(); });
$('#messageInput').addEventListener('input', resizeInput);
$('#messageInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendCurrent(); }
});
$('#micButton').addEventListener('click', startVoice);
$('#stopVoice').addEventListener('click', () => state.recognition?.stop());
$('#settingsOpen').addEventListener('click', openSettings);
$('#settingsTop').addEventListener('click', openSettings);
$('#providerLine').addEventListener('click', openSettings);
$('#providerSelect').addEventListener('change', updateSettingsDetails);
$('#saveSettings').addEventListener('click', saveSettings);
$('#cancelSettings').addEventListener('click', () => $('#settingsDialog').close());
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const button = $('#installApp');
  if (button) button.textContent = 'Instalar Jarvis';
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('Jarvis se instaló correctamente en Android.');
});
$('#installApp')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    toast('Abre el menú del navegador y elige «Instalar aplicación».');
    return;
  }
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (result.outcome === 'accepted') toast('Jarvis se está instalando en Android.');
});
$('#newChat').addEventListener('click', () => {
  if (state.busy) return;
  state.messages = [];
  saveHistory();
  $('#conversation').replaceChildren();
  $('#pendingArea').replaceChildren();
  $('#welcome').hidden = false;
  $('#messageInput').focus();
});
$('#chatLink').addEventListener('click', () => $('#messageInput').focus());
$('#projectsLink').addEventListener('click', async () => {
  toast('El control de archivos y aplicaciones está disponible en la aplicación de Windows.');
});
$$('.prompt-card').forEach(button => button.addEventListener('click', () => sendCurrent(button.dataset.prompt)));

visibleHistory();
refreshStatus();
setVoiceCapability();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
