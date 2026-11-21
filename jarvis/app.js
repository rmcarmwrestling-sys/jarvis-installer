const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const HISTORY_KEY = 'jarvis.chat.v1';
const APP_OPENING_PERMISSION_KEY = 'jarvis.app-opening-authorized.v1';
const STUDY_HISTORY_KEY = 'jarvis.study.history.v1';
const MOBILE_CONFIG_KEY = 'jarvis.android.config.v2';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const IS_ANDROID_APP = Boolean(window.JarvisAndroid) || location.hostname === 'appassets.androidplatform.net';

const MOBILE_SYSTEM_PROMPT = `Te llamas Jarvis. Responde en español salvo que te pidan otro idioma. Estás instalado en el dispositivo de la persona y debes trabajar sobre ese dispositivo, no sobre Windows ni sobre otro ordenador. Puedes conversar, estudiar, crear proyectos y usar las herramientas Android disponibles: abrir aplicaciones instaladas, abrir enlaces, compartir texto, abrir ajustes, abrir la cámara o galería, consultar datos básicos del dispositivo y vibrar. Antes de una acción que cambie el dispositivo, explica qué vas a hacer y espera a que la persona pulse Permitir. No afirmes que una acción se realizó hasta recibir el resultado. Para Study devuelve los exámenes en el formato que solicite la aplicación. Para multimedia crea instrucciones y resultados compatibles con el móvil; no prometas cuotas ilimitadas de los proveedores externos.`;

function readMobileConfig() {
  try {
    const value = JSON.parse(localStorage.getItem(MOBILE_CONFIG_KEY) || '{}');
    return { provider: 'openrouter', model: String(value.model || 'openrouter/free'), apiKey: String(value.apiKey || '') };
  } catch { return { provider: 'openrouter', model: 'openrouter/free', apiKey: '' }; }
}

function writeMobileConfig(config) {
  try { localStorage.setItem(MOBILE_CONFIG_KEY, JSON.stringify(config)); }
  catch { throw new Error('Android no pudo guardar los ajustes en este dispositivo.'); }
}

const mobileTools = [
  { type: 'function', function: { name: 'get_system_info', description: 'Consultar información básica del dispositivo Android.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'open_app', description: 'Abrir una aplicación instalada en este dispositivo Android por su nombre.', parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'], additionalProperties: false } } },
  { type: 'function', function: { name: 'open_url', description: 'Abrir una dirección web en el navegador de este dispositivo.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } } },
  { type: 'function', function: { name: 'share_text', description: 'Abrir el panel de compartir de Android con un texto o enlace.', parameters: { type: 'object', properties: { text: { type: 'string' }, title: { type: 'string' } }, required: ['text'], additionalProperties: false } } },
  { type: 'function', function: { name: 'open_settings', description: 'Abrir una pantalla de Ajustes Android, por ejemplo Wi-Fi, Bluetooth, aplicaciones o ajustes generales.', parameters: { type: 'object', properties: { section: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'open_camera', description: 'Abrir la cámara del dispositivo.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'open_gallery', description: 'Abrir el selector de imágenes y vídeos del dispositivo.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'vibrate', description: 'Hacer vibrar el dispositivo durante unos milisegundos.', parameters: { type: 'object', properties: { milliseconds: { type: 'integer', minimum: 50, maximum: 2000 } }, additionalProperties: false } } },
];

function loadStudyHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(STUDY_HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object').slice(0, 40) : [];
  } catch { return []; }
}

function loadAppOpeningPermission() {
  try { return localStorage.getItem(APP_OPENING_PERMISSION_KEY) === 'true'; }
  catch { return false; }
}

const state = {
  messages: [], provider: 'openrouter', model: 'openrouter/free', hasKey: false,
  ollama: { available: false, models: [] }, appOpeningAuthorized: loadAppOpeningPermission(), busy: false, recognition: null, toastTimer: null,
  studyImages: [], studyExam: null, studyAnswers: {}, studyTimer: null, studyTimerEnds: 0, studyHistory: loadStudyHistory(), studyPage: 'dashboard', activeView: 'chat', attachments: [],
};

try {
  const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (Array.isArray(stored)) state.messages = stored.filter(item => item && ['user', 'assistant', 'tool'].includes(item.role)).slice(-80);
} catch { state.messages = []; }

function saveHistory() {
  const saved = state.messages.slice(-80).map(message => {
    const result = { ...message };
    if (Array.isArray(result.content)) result.content = result.content.map(part => part?.type === 'image_url' ? { type: 'text', text: '[Imagen adjunta; no se guarda el archivo en el historial local.]' } : part);
    if (Array.isArray(result.attachments)) result.attachments = result.attachments.map(item => ({ id: item.id, kind: item.kind, name: item.name, type: item.type, size: item.size, poster: item.poster }));
    return result;
  });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(saved)); } catch { /* Private browsing can disable storage. */ }
}

function saveAppOpeningPermission() {
  try { localStorage.setItem(APP_OPENING_PERMISSION_KEY, 'true'); state.appOpeningAuthorized = true; renderAppOpeningPermission(); return true; }
  catch { return false; }
}

function revokeAppOpeningPermission() {
  try { localStorage.removeItem(APP_OPENING_PERMISSION_KEY); } catch { /* Keep the visible state accurate for this session. */ }
  state.appOpeningAuthorized = false;
  renderAppOpeningPermission();
  toast('Permiso revocado. Jarvis volverá a preguntar antes de abrir aplicaciones.');
}

function renderAppOpeningPermission() {
  const status = $('#appOpeningPermissionStatus');
  const revoke = $('#revokeAppOpeningPermission');
  if (!status || !revoke) return;
  status.textContent = state.appOpeningAuthorized ? 'Autorizado · Jarvis puede abrir cualquier aplicación sin volver a preguntar.' : 'No autorizado · Jarvis preguntará antes de la primera apertura.';
  status.classList.toggle('permission-active', state.appOpeningAuthorized);
  revoke.hidden = !state.appOpeningAuthorized;
}

async function refreshRobloxBridgeStatus() {
  const status = $('#robloxBridgeStatus');
  const button = $('#refreshRobloxBridge');
  if (!status || !button) return;
  button.disabled = true;
  status.textContent = 'Comprobando el complemento local…';
  try {
    const result = await api('/api/roblox/status');
    status.classList.toggle('bridge-connected', Boolean(result.connected));
    status.textContent = !result.pluginInstalled
      ? 'No se pudo instalar el complemento Jarvis en Roblox Studio.'
      : result.connected
        ? 'Conectado a Roblox Studio. Las acciones de edición seguirán pidiendo tu autorización.'
        : 'Complemento instalado; Studio todavía no está conectado. Abre Studio, pulsa Jarvis en la pestaña Plugins y permite la conexión local.';
  } catch (error) {
    status.classList.remove('bridge-connected');
    status.textContent = `No se pudo comprobar la conexión. ${error.message}`;
  } finally { button.disabled = false; }
}

function mobileJsonContent(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = [text.indexOf('{'), text.indexOf('[')].filter(index => index >= 0);
  if (!start.length) throw new Error('El modelo no devolvió un examen en formato JSON.');
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  try { return JSON.parse(text.slice(Math.min(...start), end + 1)); }
  catch { throw new Error('El modelo devolvió un examen no válido.'); }
}

async function mobileStudyExam(data, config) {
  const topic = String(data?.topic || '').trim().slice(0, 5000);
  const title = String(data?.title || '').trim().slice(0, 160) || (topic ? `Examen de ${topic}` : 'Examen generado por Jarvis');
  const difficulty = ['facil', 'medio', 'dificil', 'mixto'].includes(String(data?.difficulty || '').toLowerCase()) ? String(data.difficulty).toLowerCase() : 'medio';
  const count = Math.min(200, Math.max(1, Number.parseInt(data?.count, 10) || 10));
  const timeLimit = Math.min(180, Math.max(0, Number.parseInt(data?.timeLimit, 10) || 0));
  const images = Array.isArray(data?.images) ? data.images.filter(image => /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(String(image)) && String(image).length <= 900000).slice(0, 5) : [];
  if (!topic && !images.length) throw new Error('Indica un tema o añade al menos una imagen para crear el examen.');
  const allowed = ['multiple_choice', 'true_false', 'short_answer'];
  const selected = Array.isArray(data?.questionTypes) ? data.questionTypes.filter(type => allowed.includes(type)) : allowed;
  const questionTypes = selected.length ? selected : allowed;
  const schema = 'Devuelve SOLO JSON válido, sin Markdown: {"questions":[{"type":"multiple_choice|true_false|short_answer","question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}. Para multiple_choice incluye 4 opciones y answer es el índice 0-3. Para true_false usa options ["Verdadero","Falso"] y answer true o false. Para short_answer no uses options y answer es una respuesta breve. Todas deben poder corregirse.';
  const batchSize = Math.min(20, count);
  const batches = [];
  for (let offset = 0; offset < count; offset += batchSize) batches.push(Math.min(batchSize, count - offset));
  const deadline = Date.now() + 118000;
  const requestBatch = async needed => {
    const prompt = `${schema}\nTema: ${topic || 'el contenido de las imágenes adjuntas'}\nDificultad: ${difficulty}\nTipos permitidos: ${questionTypes.join(', ')}\nGenera exactamente ${needed} preguntas distintas, con explicaciones breves y didácticas.`;
    const content = [{ type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(5000, Math.min(45000, deadline - Date.now())));
    try {
      const response = await fetch(OPENROUTER_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': location.href, 'X-Title': 'Jarvis Study Android' }, body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: 'Eres un profesor que crea exámenes rigurosos y corregibles.' }, { role: 'user', content }], temperature: 0.35, max_tokens: Math.min(9000, Math.max(1600, needed * 330)), }), signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message || `El proveedor respondió con el error ${response.status}.`);
      const parsed = mobileJsonContent(result?.choices?.[0]?.message?.content || '');
      return Array.isArray(parsed) ? parsed : parsed.questions;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Study ha alcanzado el límite de 2 minutos. Reduce el número de preguntas o prueba otro modelo.');
      throw error;
    } finally { clearTimeout(timer); }
  };
  const questions = [];
  for (let start = 0; start < batches.length; start += 4) {
    if (Date.now() >= deadline) throw new Error('Study ha alcanzado el límite de 2 minutos.');
    const wave = await Promise.all(batches.slice(start, start + 4).map(requestBatch));
    wave.flat().forEach(question => { if (question && typeof question.question === 'string' && question.question.trim()) questions.push({ ...question, id: `q_${questions.length + 1}` }); });
  }
  if (!questions.length) throw new Error('El modelo no devolvió preguntas válidas.');
  return { exam: { id: `exam_${Date.now()}`, title, topic, difficulty, timeLimit, questions: questions.slice(0, count) } };
}

async function api(path, body) {
  if (!IS_ANDROID_APP) {
    const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    return data;
  }
  const config = readMobileConfig();
  if (path === '/api/status') return { provider: 'openrouter', model: config.model, keyConfigured: Boolean(config.apiKey), ollama: { available: false, models: [] } };
  if (path === '/api/config') {
    const model = String(body?.model || '').trim().slice(0, 120);
    const apiKey = String(body?.apiKey || '').trim() || config.apiKey;
    if (!model) throw new Error('Indica el nombre del modelo.');
    if (!apiKey) throw new Error('Añade tu clave de OpenRouter.');
    writeMobileConfig({ provider: 'openrouter', model, apiKey });
    return { provider: 'openrouter', model, keyConfigured: true, ollama: { available: false, models: [] } };
  }
  if (path === '/api/study/generate') {
    if (!config.apiKey) throw new Error('Configura tu clave de OpenRouter antes de generar exámenes.');
    return mobileStudyExam(body, config);
  }
  if (path === '/api/action') {
    const name = String(body?.name || '');
    const args = body?.arguments || {};
    if (name === 'generate_image') {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) throw new Error('Falta la descripción de la imagen.');
      return { result: { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${Math.min(1536, Math.max(256, Number(args.width) || 1024))}&height=${Math.min(1536, Math.max(256, Number(args.height) || 1024))}&nologo=true`, dispositivo: 'Android' } };
    }
    if (!window.JarvisAndroid?.performAction) throw new Error('El puente de acciones de Android no está disponible. Reinstala Jarvis desde la APK más reciente.');
    const raw = window.JarvisAndroid.performAction(name, JSON.stringify(args));
    let result; try { result = JSON.parse(raw || '{}'); } catch { result = { result: raw }; }
    if (result?.error) throw new Error(result.error);
    return result.result === undefined ? { result } : result;
  }
  if (path === '/api/chat') {
    if (!config.apiKey) throw new Error('Configura tu clave de OpenRouter en Ajustes antes de hablar con Jarvis.');
    const safeMessages = Array.isArray(body?.messages) ? body.messages.slice(-36) : [];
    const response = await fetch(OPENROUTER_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': location.href, 'X-Title': 'Jarvis Android' }, body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: MOBILE_SYSTEM_PROMPT }, ...safeMessages], tools: mobileTools, tool_choice: 'auto', temperature: 0.7, max_tokens: 4096 }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `El proveedor respondió con el error ${response.status}.`);
    if (!data?.choices?.[0]?.message) throw new Error('El proveedor devolvió una respuesta vacía.');
    return { message: data.choices[0].message, model: data.model || config.model };
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
  $('#welcome').hidden = state.messages.some(message => message.role === 'user' || (message.role === 'assistant' && (message.content || message.tool_calls?.length)) || message.attachments?.length);
  const conversation = $('#conversation');
  conversation.replaceChildren();
  for (const message of state.messages) {
    if (message.role === 'tool' || (message.role === 'assistant' && !readable(message.content))) continue;
    addMessageElement(message.role, readable(message.content), Array.isArray(message.attachments) ? message.attachments : []);
  }
  scrollToBottom();
}

function readable(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text || '').filter(Boolean).join('\n');
  return '';
}

function appendAttachmentPreview(parent, item) {
  const card = document.createElement('div');
  card.className = 'message-attachment';
  if (item.url || item.poster) {
    if (item.kind === 'video') {
      const video = document.createElement('video');
      video.controls = true; video.preload = 'metadata';
      if (item.poster) video.poster = item.poster;
      if (item.url) video.src = item.url;
      card.append(video);
    } else {
      const image = document.createElement('img');
      image.loading = 'lazy'; image.alt = item.name || 'Imagen adjunta'; image.src = item.url || item.poster; card.append(image);
    }
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'message-attachment-placeholder';
    placeholder.textContent = item.kind === 'video' ? '🎬' : '🖼️'; card.append(placeholder);
  }
  const info = document.createElement('div');
  info.className = 'message-attachment-info';
  info.textContent = item.name || (item.kind === 'video' ? 'Vídeo' : 'Imagen');
  const meta = document.createElement('small');
  meta.textContent = `${window.JarvisAttachments?.formatBytes?.(item.size) || ''}${item.kind === 'video' ? ' · vista previa' : ''}`;
  info.append(meta); card.append(info); parent.append(card);
}

function addMessageElement(role, content, attachments = []) {
  if (!content && !attachments.length) return;
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
  body.append(head);
  if (content) {
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = content;
    body.append(text);
  }
  if (attachments.length) {
    const gallery = document.createElement('div');
    gallery.className = 'message-attachments';
    attachments.forEach(item => appendAttachmentPreview(gallery, item));
    body.append(gallery);
  }
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
    addMessageElement(message.role, readable(message.content), message.attachments || []);
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
  generate_image: ['Crear una imagen', args => `Jarvis generará una imagen desde el texto indicado${args.referenceUrl ? ' y la referencia pública indicada' : args.referencePath ? ' y la referencia local indicada' : ''}. El resultado se guardará localmente.`],
  generate_video: ['Crear un vídeo', args => `Jarvis creará un vídeo de ${args.duration || 6} segundo(s) desde el texto${args.referencePath || args.referenceUrl ? ' y la referencia indicada' : ''}. Puede preparar FFmpeg gratuitamente la primera vez.`],
  generate_3d: ['Crear un objeto 3D', args => `Jarvis generará un objeto OBJ desde «${args.prompt || ''}»${args.referencePath || args.referenceUrl ? ' con la textura de referencia indicada' : ''}.`],
  write_project_file: ['Guardar un archivo', args => `Jarvis guardará cambios en «${args.project || ''}/${args.file || ''}». Si ya existe, conservará una copia anterior.`],
  open_app: ['Autorizar la apertura de aplicaciones', args => `Jarvis buscará «${args.app || 'la aplicación seleccionada'}» en ${IS_ANDROID_APP ? 'este dispositivo Android' : 'este ordenador'} y la abrirá. Al pulsar «Permitir siempre», recordará la autorización para futuras aperturas.`],
  open_url: ['Abrir un enlace', args => `El navegador de ${IS_ANDROID_APP ? 'este dispositivo' : 'este ordenador'} abrirá ${args.url || 'la dirección seleccionada'}.`],
  share_text: ['Compartir contenido', args => `Android abrirá el panel de compartir con ${String(args.text || '').slice(0, 180)}.`],
  open_settings: ['Abrir Ajustes del dispositivo', args => `Se abrirá la sección de ajustes «${args.section || 'general'}» en este dispositivo.`],
  open_camera: ['Abrir la cámara', 'Se abrirá la cámara de este dispositivo.'],
  open_gallery: ['Abrir la galería', 'Se abrirá el selector de imágenes y vídeos de este dispositivo.'],
  vibrate: ['Hacer vibrar el dispositivo', args => `El dispositivo vibrará durante ${args.milliseconds || 300} milisegundos.`],
  open_project: ['Abrir un proyecto', args => `Se abrirá «${args.project || ''}/${args.file || 'index.html'}» en el navegador.`],
  roblox_studio: ['Conectar con Roblox Studio', args => {
    const actions = { status: 'consultar el estado del complemento', inspect: `leer la jerarquía de «${args.path || 'game'}»`, create_script: `crear ${args.scriptClass || 'un script'} llamado «${args.name || ''}» en «${args.parentPath || 'ServerScriptService'}»`, update_script: `reemplazar el código de «${args.path || ''}»`, create_part: `crear la pieza «${args.name || 'Part'}» en «${args.parentPath || 'Workspace'}»`, create_folder: `crear la carpeta «${args.name || ''}» en «${args.parentPath || 'Workspace'}»`, delete_instance: `borrar «${args.path || ''}» del proyecto abierto` };
    const privacy = args.operation === 'inspect' && state.provider !== 'ollama' ? ' Los nombres y la jerarquía del proyecto se enviarán al proveedor de IA para que responda.' : '';
    return `Jarvis intentará ${actions[args.operation] || 'usar Roblox Studio'}.${privacy}`;
  }],
  get_display_info: ['Consultar las pantallas', 'Jarvis verá el nombre y las dimensiones de tus pantallas.'],
  capture_screen: ['Capturar una pantalla', args => `Se capturará la pantalla ${Number(args.screenIndex) + 1} para ${args.purpose || 'analizarla'}. ${state.provider === 'ollama' ? 'La imagen se analizará en este equipo.' : 'La imagen completa se enviará a OpenRouter y al proveedor del modelo configurado.'}`],
  mouse_click: ['Usar el ratón', args => `Se hará un clic ${args.button || ''} en la posición ${args.x}, ${args.y}.`],
  keyboard_type: ['Escribir en la ventana activa', args => `Se escribirá este texto en la aplicación que esté activa: «${String(args.text || '').slice(0, 300)}${String(args.text || '').length > 300 ? '…' : ''}»`],
  press_key: ['Pulsar una tecla', args => `Se enviará ${args.key || 'la tecla indicada'} a la ventana activa.`],
  scroll_screen: ['Desplazar la pantalla', args => `Se desplazará ${args.direction || ''} ${args.notches || 1} paso(s) en la posición ${args.x}, ${args.y}.`],
  run_powershell: ['Controlar Windows con PowerShell', args => `${args.purpose || 'Jarvis ejecutará un script.'} Se ejecutará con los permisos de tu cuenta de Windows; revisa el script antes de permitirlo.`],
};

function actionDescription(name, args) {
  const meta = toolNames[name] || ['Usar una herramienta local', 'Jarvis solicita permiso para continuar.'];
  return { title: meta[0], caption: typeof meta[1] === 'function' ? meta[1](args) : meta[1] };
}

function readToolArguments(call) {
  let args = {};
  try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function.arguments || {}); }
  catch { args = { aviso: 'Los parámetros no se pudieron interpretar.' }; }
  return args;
}

function requestApproval(call, preparedArgs) {
  const args = preparedArgs === undefined ? readToolArguments(call) : preparedArgs;
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
  if (['run_powershell', 'capture_screen', 'keyboard_type', 'press_key', 'mouse_click', 'scroll_screen', 'roblox_studio', 'generate_image', 'generate_video', 'generate_3d'].includes(call.function.name)) details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Ver detalles de la acción';
  const preview = document.createElement('pre');
  const previewText = JSON.stringify(args, null, 2);
  preview.textContent = ['run_powershell', 'roblox_studio', 'generate_image', 'generate_video', 'generate_3d'].includes(call.function.name) ? previewText : previewText.slice(0, 12000);
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
  allow.textContent = call.function.name === 'open_app' ? 'Permitir siempre' : 'Permitir';
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

function rememberedApprovalNotice(call, args) {
  const card = document.createElement('div');
  card.className = 'action-card remembered-app-action';
  const title = document.createElement('div');
  title.className = 'action-title';
  title.textContent = `Permiso global guardado · abrir ${args.app || 'aplicación'}`;
  const caption = document.createElement('div');
  caption.className = 'action-caption';
  caption.textContent = 'Jarvis puede abrir esta y cualquier otra aplicación sin volver a preguntar. Puedes revocar este permiso global en Ajustes.';
  const status = document.createElement('div');
  status.className = 'action-result';
  status.textContent = 'Abriendo…';
  card.append(title, caption, status);
  $('#pendingArea').append(card);
  scrollToBottom();
  return { approved: true, args, card, status, remembered: true };
}

async function handleTool(call) {
  const args = readToolArguments(call);
  const isRememberedApp = call.function.name === 'open_app' && state.appOpeningAuthorized;
  const approval = isRememberedApp ? rememberedApprovalNotice(call, args) : await requestApproval(call, args);
  let result;
  if (!approval.approved) {
    result = { error: 'La persona rechazó esta acción. No se ejecutó.' };
  } else {
    try {
      result = await api('/api/action', { approved: true, name: call.function.name, arguments: approval.args });
      approval.status.textContent = 'Acción completada';
      approval.status.style.color = '#9bd6c0';
      if (call.function.name === 'open_app') {
        const permissionSaved = saveAppOpeningPermission();
        approval.status.textContent = permissionSaved ? 'Permiso global guardado para abrir aplicaciones' : (approval.remembered ? 'Permiso global activo' : 'Abierta; no se pudo guardar el permiso');
        if (!permissionSaved && !approval.remembered) toast('La aplicación se abrió, pero no se pudo guardar el permiso en este equipo.');
      }
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
  let followupMessage = null;
  let modelResult = result;
  if (call.function.name === 'capture_screen' && result?.result?.dataUrl) {
    const captured = result.result;
    const dataUrl = String(captured.dataUrl);
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
      modelResult = { error: 'La captura no tenía un formato de imagen válido.' };
    } else {
      const { dataUrl: ignored, ...metadata } = captured;
      modelResult = { result: metadata };
      const image = document.createElement('img');
      image.alt = `Captura de pantalla ${Number(captured.pantalla) + 1}`;
      image.src = dataUrl;
      image.style.cssText = 'display:block;max-width:min(100%,720px);max-height:400px;margin-top:12px;border:1px solid rgba(130,190,220,.28);border-radius:12px;background:#080e17;object-fit:contain';
      approval.card.append(image);
      followupMessage = {
        role: 'user',
        content: [
          { type: 'text', text: `Captura de pantalla ${Number(captured.pantalla) + 1}, ${captured.ancho}×${captured.alto} píxeles. La persona autorizó compartir esta imagen para: ${captured.finalidad}.` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      };
    }
  }
  if (['generate_image', 'generate_video', 'generate_3d'].includes(call.function.name) && result?.result?.url) {
    const media = result.result;
    const mediaUrl = String(media.url);
    if (/^https?:\/\/127\.0\.0\.1:3210\/media\//.test(mediaUrl)) {
      if (call.function.name === 'generate_image') {
        const image = document.createElement('img');
        image.alt = 'Imagen creada por Jarvis';
        image.src = mediaUrl;
        image.style.cssText = 'display:block;max-width:min(100%,720px);max-height:460px;margin-top:12px;border:1px solid rgba(130,190,220,.28);border-radius:12px;background:#080e17;object-fit:contain';
        approval.card.append(image);
      } else if (call.function.name === 'generate_video') {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.src = mediaUrl;
        video.style.cssText = 'display:block;width:min(100%,720px);max-height:460px;margin-top:12px;border:1px solid rgba(130,190,220,.28);border-radius:12px;background:#080e17';
        approval.card.append(video);
      } else {
        const link = document.createElement('a');
        link.href = mediaUrl;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.className = 'text-link';
        link.textContent = 'Abrir el objeto 3D OBJ';
        link.style.display = 'block';
        link.style.marginTop = '12px';
        approval.card.append(link);
      }
    }
  }
  const payload = JSON.stringify(modelResult);
  return { toolMessage: { role: 'tool', tool_call_id: call.id, name: call.function.name, content: payload }, followupMessage };
}

function directAppRequest(text) {
  let command = String(text || '').trim().replace(/^[¿¡]+/, '').replace(/[.!?]+$/, '').trim();
  command = command.replace(/^jarvis\s*[,;:]?\s*/i, '');
  command = command.replace(/^por favor[,;:]?\s*/i, '');
  const match = command.match(/^(?:por favor\s+)?(?:(?:puedes|podr[ií]as)\s+|quiero\s+(?:que\s+)?|me\s+puedes\s+)?(?:abre|abrir|abras|abra|inicia|iniciar|ejecuta|ejecutar|lanza|lanzar)\s+(.+)$/i);
  if (!match) return null;
  let app = match[1].trim().replace(/[,;]?\s+(?:por favor|porfa)$/i, '');
  if (/\b(?:y luego|y despu[eé]s|y tambi[eé]n|para que|y dime|y abre)\b/i.test(app)) return null;
  app = app.replace(/^(?:la\s+aplicaci[oó]n|la\s+app|el\s+programa|el\s+juego)\s+(?:(?:llamad[oa]|de)\s+)?/i, '').replace(/^(?:el|la)\s+/i, '').trim();
  if (!app || app.length > 260) return null;
  return app;
}

async function openAppDirectly(appName) {
  const call = {
    id: `call_${crypto.randomUUID().replaceAll('-', '')}`,
    type: 'function',
    function: { name: 'open_app', arguments: JSON.stringify({ app: appName }) },
  };
  appendMessage({ role: 'assistant', content: null, tool_calls: [call] });
  const handled = await handleTool(call);
  appendMessage(handled.toolMessage);
  if (handled.followupMessage) appendMessage(handled.followupMessage);
  let result = {};
  try { result = JSON.parse(handled.toolMessage.content || '{}'); } catch { result = {}; }
  if (result?.result?.abierta || result?.result?.abierto) {
    appendMessage({ role: 'assistant', content: `He abierto ${result.result.abierta || result.result.abierto}.` });
  } else if (result?.error) {
    appendMessage({ role: 'assistant', content: `No he podido abrir ${appName}. ${result.error}` });
  } else {
    appendMessage({ role: 'assistant', content: 'No he podido confirmar que la aplicación se haya abierto.' });
  }
}

function renderAttachmentTray() {
  const tray = $('#attachmentTray');
  if (!tray || !window.JarvisAttachments) return;
  tray.replaceChildren();
  tray.hidden = state.attachments.length === 0;
  $('#attachButton')?.classList.toggle('has-files', state.attachments.length > 0);
  for (const item of state.attachments) {
    const chip = document.createElement('div'); chip.className = 'attachment-chip';
    const preview = document.createElement(item.kind === 'video' ? 'video' : 'img');
    preview.src = item.poster || item.url; preview.alt = item.name;
    if (item.kind === 'video') { preview.muted = true; preview.preload = 'metadata'; }
    chip.append(preview);
    const copy = document.createElement('div'); copy.className = 'attachment-chip-copy';
    const name = document.createElement('span'); name.className = 'attachment-chip-name'; name.textContent = item.name;
    const meta = document.createElement('span'); meta.className = 'attachment-chip-meta'; meta.textContent = `${item.kind === 'video' ? 'Vídeo' : 'Imagen'} · ${JarvisAttachments.formatBytes(item.size)}`;
    copy.append(name, meta);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'attachment-remove'; remove.title = 'Quitar archivo'; remove.textContent = '×';
    remove.addEventListener('click', () => { JarvisAttachments.release(item); state.attachments = state.attachments.filter(candidate => candidate.id !== item.id); renderAttachmentTray(); });
    chip.append(copy, remove); tray.append(chip);
  }
}

function addAttachments(files) {
  const incoming = [...files].filter(file => /^(image|video)\//i.test(file.type || ''));
  if (!incoming.length) return toast('Selecciona imágenes o vídeos.');
  state.attachments.push(...incoming.map(file => JarvisAttachments.create(file)));
  renderAttachmentTray();
  toast(`${incoming.length} archivo(s) preparado(s). El archivo permanece en este dispositivo hasta enviarlo.`, 2600);
}

async function prepareAttachmentContent(text, attachments) {
  const parts = []; if (text) parts.push({ type: 'text', text });
  for (const item of attachments) {
    if (item.kind === 'image') {
      try { parts.push({ type: 'image_url', image_url: { url: await JarvisAttachments.toDataUrl(item.file) } }); }
      catch { parts.push({ type: 'text', text: `[No se pudo leer la imagen adjunta: ${item.name}]` }); }
    } else {
      item.poster = await JarvisAttachments.videoPoster(item.file);
      if (item.poster) parts.push({ type: 'image_url', image_url: { url: item.poster } });
      parts.push({ type: 'text', text: `[Vídeo adjunto: ${item.name} · ${JarvisAttachments.formatBytes(item.size)}. El modelo recibe una previsualización.]` });
    }
  }
  if (!parts.length) return '';
  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
}

async function sendCurrent(textOverride) {
  if (state.busy) return;
  const text = (textOverride ?? $('#messageInput').value).trim();
  const attachments = state.attachments.slice();
  if (!text && !attachments.length) return;
  $('#messageInput').value = '';
  resizeInput();
  state.attachments = [];
  renderAttachmentTray();
  let content = text;
  try { content = await prepareAttachmentContent(text, attachments); }
  catch (error) { content = text || `[No se pudieron preparar los archivos adjuntos: ${error.message}]`; }
  appendMessage({ role: 'user', content, attachments });
  setBusy(true);
  let indicator = typingIndicator();
  try {
    const requestedApp = directAppRequest(text);
    if (requestedApp) {
      indicator?.remove();
      indicator = null;
      await openAppDirectly(requestedApp);
      return;
    }
    let completed = false;
    for (let turn = 0; turn < 6; turn++) {
      indicator?.remove();
      indicator = typingIndicator();
      const response = await api('/api/chat', { messages: state.messages.map(({ attachments: ignored, ...message }) => message) });
      indicator?.remove();
      indicator = null;
      const assistant = response.message || { role: 'assistant', content: 'No recibí una respuesta.' };
      if (!assistant.role) assistant.role = 'assistant';
      appendMessage(assistant);
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      if (!calls.length) { completed = true; break; }
      for (const item of calls) {
        const call = { ...item, id: item.id || `call_${crypto.randomUUID().replaceAll('-', '')}` };
        const handled = await handleTool(call);
        appendMessage(handled.toolMessage);
        if (handled.followupMessage) appendMessage(handled.followupMessage);
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
  state.ollama = status.ollama || { available: false, models: [] };
  const ready = state.provider === 'ollama' ? state.ollama.available : state.hasKey;
  const label = state.provider === 'ollama' ? 'IA LOCAL' : (ready ? 'ONLINE · GRATIS' : 'CONFIGURAR');
  $('#connectionLabel').textContent = label;
  $('#localLabel').textContent = IS_ANDROID_APP ? 'APLICACIÓN ANDROID' : (state.provider === 'ollama' ? 'MODELO EN ESTE EQUIPO' : 'INTERFAZ EN ESTE EQUIPO');
  $('#providerLine').innerHTML = '';
  const text = document.createElement('span');
  text.textContent = state.provider === 'ollama' ? (state.ollama.available ? `${state.ollama.models.length} modelo(s) disponible(s)` : 'Ollama no está conectado') : (state.hasKey ? 'Modelo gratuito conectado' : 'Conecta un modelo gratuito');
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
  if (IS_ANDROID_APP) $('#providerSelect').value = 'openrouter';
  const local = !IS_ANDROID_APP && $('#providerSelect').value === 'ollama';
  $('#localDetails').hidden = !local;
  $('#remoteDetails').hidden = local;
  const status = $('#ollamaStatus');
  status.classList.toggle('offline', !state.ollama.available);
  status.replaceChildren();
  const dot = document.createElement('i');
  const text = document.createElement('span');
  text.textContent = IS_ANDROID_APP ? 'Las acciones se ejecutan en este dispositivo Android' : (state.ollama.available ? `Ollama está activo · ${state.ollama.models.length} modelo(s)` : 'Ollama no está activo en este ordenador');
  status.append(dot, text);
}

function openSettings() {
  $('#settingsError').hidden = true;
  $('#apiKeyInput').value = '';
  if (state.provider === 'openrouter') $('#remoteModel').value = state.model || 'openrouter/free';
  if (state.provider === 'ollama') $('#localModel').value = state.model || '';
  updateSettingsDetails();
  renderAppOpeningPermission();
  $('#settingsDialog').showModal();
  if (!IS_ANDROID_APP) refreshRobloxBridgeStatus();
}

async function saveSettings() {
  const button = $('#saveSettings');
  const provider = $('#providerSelect').value;
  const model = provider === 'ollama' ? $('#localModel').value.trim() : $('#remoteModel').value.trim();
  const key = $('#apiKeyInput').value.trim();
  const error = $('#settingsError');
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Guardando…';
  try {
    const result = await api('/api/config', { provider, model, apiKey: key });
    $('#settingsDialog').close();
    await refreshStatus();
    toast(provider === 'ollama' ? 'Jarvis utilizará el modelo local.' : 'Jarvis ya puede usar los modelos gratuitos.');
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

function setActiveNav(id) {
  $$('.side-link').forEach(link => link.classList.toggle('selected', link.id === id));
}

function showStudyPage(page = 'dashboard') {
  const view = $('#studyView');
  if (!view) return;
  const pages = $$('.study-page', view);
  const target = pages.some(node => node.dataset.studyPageTarget === page) ? page : 'dashboard';
  pages.forEach(node => { node.hidden = node.dataset.studyPageTarget !== target; });
  $$('.study-nav-item', view).forEach(button => button.classList.toggle('selected', button.dataset.studyPage === target));
  state.studyPage = target;
  if (target === 'builder') renderStudyHistory();
}

function navigateStudyPage(page) {
  if (!page) return;
  if (page === 'close') { showChatView(); return; }
  if (page === 'dark') { toast('El modo oscuro de Study estará disponible próximamente.'); return; }
  if (page === 'download') { toast('La descarga de apuntes estará disponible próximamente.'); return; }
  if (page === 'help') { toast('Puedes usar StudyIA para crear exámenes, repasar y consultar a Jarvis.'); return; }
  setStudyScene('builder');
  showStudyPage(page);
}

function setStudyScene(scene) {
  const isBuilder = scene === 'builder';
  const isExam = scene === 'exam';
  const isResult = scene === 'result';
  document.body.classList.add('study-active');
  $('#chatStage').hidden = true;
  $('#composerWrap').hidden = true;
  $('#studyView').hidden = !isBuilder;
  $('#studyExamView').hidden = !isExam;
  $('#studyResultView').hidden = !isResult;
  state.activeView = isBuilder || isExam || isResult ? 'study' : 'chat';
  setActiveNav('studyLink');
  if (isBuilder) showStudyPage('builder');
}

function showChatView() {
  document.body.classList.remove('study-active');
  clearInterval(state.studyTimer);
  state.studyTimer = null;
  $('#chatStage').hidden = false;
  $('#composerWrap').hidden = false;
  $('#studyView').hidden = true;
  $('#studyExamView').hidden = true;
  $('#studyResultView').hidden = true;
  state.activeView = 'chat';
  setActiveNav('chatLink');
}

function saveStudyHistory() {
  try { localStorage.setItem(STUDY_HISTORY_KEY, JSON.stringify(state.studyHistory.slice(0, 40))); }
  catch { /* El historial es opcional y no debe bloquear Study. */ }
}

function renderStudyHistory() {
  const list = $('#studyHistory');
  if (!list) return;
  list.replaceChildren();
  const attempts = state.studyHistory;
  if (!attempts.length) {
    const empty = document.createElement('div');
    empty.className = 'study-empty';
    empty.innerHTML = 'Todavía no hay intentos.<br><span>Tu primer examen aparecerá aquí.</span>';
    list.append(empty);
  } else {
    attempts.slice(0, 8).forEach(attempt => {
      const item = document.createElement('article');
      item.className = 'study-history-item';
      const score = document.createElement('span');
      score.className = 'study-history-score';
      score.textContent = `${Math.round(Number(attempt.score) || 0)}%`;
      const title = document.createElement('strong');
      title.textContent = attempt.title || 'Examen sin título';
      const meta = document.createElement('small');
      const date = attempt.date ? new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(new Date(attempt.date)) : 'ahora';
      meta.textContent = `${date} · ${attempt.correct || 0}/${attempt.count || 0} correctas · ${attempt.topic || 'Repaso general'}`;
      item.append(score, title, meta);
      list.append(item);
    });
  }
  const count = $('#studyExamCount');
  const average = $('#studyAverageScore');
  const historyCount = $('#studyHistoryCount');
  if (count) count.textContent = String(attempts.length);
  if (historyCount) historyCount.textContent = String(attempts.length);
  if (average) average.textContent = attempts.length ? `${Math.round(attempts.reduce((sum, item) => sum + Number(item.score || 0), 0) / attempts.length)}%` : '—';
}

function renderStudyImages() {
  const preview = $('#studyImagePreview');
  if (!preview) return;
  preview.replaceChildren();
  state.studyImages.forEach((image, index) => {
    const chip = document.createElement('div');
    chip.className = 'study-image-chip';
    const img = document.createElement('img');
    img.src = image.dataUrl;
    img.alt = image.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = `Quitar ${image.name}`;
    remove.textContent = '×';
    remove.addEventListener('click', () => { state.studyImages.splice(index, 1); renderStudyImages(); });
    chip.append(img, remove);
    preview.append(chip);
  });
}

function readStudyImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error(`${file.name} no es una imagen.`));
    if (file.size > 350 * 1024) return reject(new Error(`${file.name} supera 350 KB. Reduce su tamaño para poder enviarla al modelo.`));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function handleStudyImages(event) {
  const files = [...(event.target.files || [])].slice(0, 5 - state.studyImages.length);
  event.target.value = '';
  if (!files.length) {
    if (state.studyImages.length >= 5) toast('Study admite hasta 5 imágenes por examen.');
    return;
  }
  for (const file of files) {
    try { state.studyImages.push(await readStudyImage(file)); }
    catch (error) { toast(error.message, 4500); }
  }
  renderStudyImages();
}

function selectedStudyTypes() {
  const types = $$('.study-type:checked').map(input => input.value);
  return types.length ? types : ['multiple_choice', 'true_false', 'short_answer'];
}

function applyStudyTypePreset(preset) {
  const presets = {
    test: ['multiple_choice'],
    development: ['short_answer'],
    mixed: ['multiple_choice', 'true_false', 'short_answer'],
  };
  const selected = presets[preset] || presets.test;
  $$('.study-type').forEach(input => { input.checked = selected.includes(input.value); });
  $$('.study-type-choice').forEach(button => button.classList.toggle('selected', button.dataset.studyTypePreset === preset));
}

function setStudyDifficulty(value) {
  const select = $('#studyDifficulty');
  if (select && ['facil', 'medio', 'dificil'].includes(value)) select.value = value;
  $$('[data-study-difficulty]').forEach(button => button.classList.toggle('selected', button.dataset.studyDifficulty === value));
}

async function generateStudyExam(event) {
  event?.preventDefault();
  const button = $('#generateStudyExam');
  const error = $('#studyBuilderError');
  const topic = $('#studyTopic').value.trim();
  const count = Math.min(200, Math.max(1, Number.parseInt($('#studyQuestionCount').value, 10) || 10));
  $('#studyQuestionCount').value = String(count);
  error.hidden = true;
  if (!topic && !state.studyImages.length) {
    error.textContent = 'Escribe un tema o añade una imagen de tus apuntes para empezar.';
    error.hidden = false;
    return;
  }
  button.disabled = true;
  button.querySelector('span').textContent = 'Generando…';
  try {
    const response = await api('/api/study/generate', {
      title: $('#studyTitle').value.trim(), topic, difficulty: $('#studyDifficulty').value,
      count, timeLimit: Number.parseInt($('#studyTimeLimit').value, 10) || 0,
      questionTypes: selectedStudyTypes(), images: state.studyImages.map(image => image.dataUrl),
    });
    state.studyExam = response.exam;
    state.studyAnswers = {};
    renderStudyExam();
    toast(`Examen listo: ${response.exam.questions.length} preguntas.`);
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Generar examen';
  }
}

function answerValue(question) {
  const value = state.studyAnswers[question.id];
  return value === undefined || value === null ? '' : String(value);
}

function updateStudyProgress() {
  if (!state.studyExam) return;
  const total = state.studyExam.questions.length;
  const answered = state.studyExam.questions.filter(question => answerValue(question).trim() !== '').length;
  $('#studyProgressText').textContent = `${answered} / ${total}`;
  $('#studyProgressBar').style.width = `${total ? Math.round(answered / total * 100) : 0}%`;
}

function renderStudyExam() {
  const exam = state.studyExam;
  if (!exam) return;
  $('#studyExamTitle').textContent = exam.title || 'Examen de Study';
  $('#studyExamTopic').textContent = exam.topic ? `Tema: ${exam.topic}` : 'Generado a partir de tus materiales';
  $('#studyExamDifficultyLabel').textContent = String(exam.difficulty || 'medio').toUpperCase();
  const questions = $('#studyQuestions');
  questions.replaceChildren();
  exam.questions.forEach((question, index) => {
    const card = document.createElement('article');
    card.className = 'study-question-card';
    card.dataset.questionId = question.id;
    const top = document.createElement('div');
    top.className = 'study-question-top';
    const number = document.createElement('span');
    number.className = 'study-question-number';
    number.textContent = `${String(index + 1).padStart(2, '0')} / ${exam.questions.length}`;
    const type = document.createElement('span');
    type.textContent = question.type === 'multiple_choice' ? 'OPCIÓN MÚLTIPLE' : question.type === 'true_false' ? 'VERDADERO / FALSO' : 'RESPUESTA CORTA';
    top.append(number, type);
    const text = document.createElement('p');
    text.className = 'study-question-text';
    text.textContent = question.question;
    const options = document.createElement('div');
    options.className = 'study-options';
    if (question.type === 'short_answer') {
      const input = document.createElement('input');
      input.className = 'study-short-answer';
      input.type = 'text';
      input.placeholder = 'Escribe tu respuesta…';
      input.value = answerValue(question);
      input.addEventListener('input', () => { state.studyAnswers[question.id] = input.value; card.classList.toggle('is-answered', Boolean(input.value.trim())); updateStudyProgress(); });
      options.append(input);
    } else {
      (question.options || []).forEach((option, optionIndex) => {
        const label = document.createElement('label');
        label.className = 'study-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `study-${question.id}`;
        input.value = question.type === 'true_false' ? String(optionIndex === 0) : String(optionIndex);
        input.checked = answerValue(question) === input.value;
        input.addEventListener('change', () => { state.studyAnswers[question.id] = input.value; card.classList.add('is-answered'); updateStudyProgress(); });
        const labelText = document.createElement('span');
        labelText.textContent = option;
        label.append(input, labelText);
        options.append(label);
      });
    }
    card.append(top, text, options);
    questions.append(card);
  });
  setStudyScene('exam');
  updateStudyProgress();
  startStudyTimer();
}

function startStudyTimer() {
  clearInterval(state.studyTimer);
  const limit = Number(state.studyExam?.timeLimit || 0);
  const timer = $('#studyExamTimer');
  if (!limit) { timer.textContent = 'SIN LÍMITE'; timer.classList.remove('warning'); state.studyTimer = null; return; }
  state.studyTimerEnds = Date.now() + limit * 60 * 1000;
  const tick = () => {
    const remaining = Math.max(0, state.studyTimerEnds - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    timer.classList.toggle('warning', seconds <= 60);
    if (!remaining) { clearInterval(state.studyTimer); state.studyTimer = null; toast('Se acabó el tiempo. Corrigiendo el examen.'); gradeStudyExam(); }
  };
  tick();
  state.studyTimer = setInterval(tick, 1000);
}

function normalizeStudyAnswer(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function shortAnswerMatches(answer, expected) {
  const actual = normalizeStudyAnswer(answer);
  const target = normalizeStudyAnswer(expected);
  if (!actual || !target) return false;
  if (actual.includes(target) || target.includes(actual)) return true;
  const words = target.split(' ').filter(word => word.length > 2);
  const hits = words.filter(word => actual.includes(word)).length;
  return words.length > 1 && hits >= Math.ceil(words.length * .6);
}

function gradeStudyExam(event) {
  event?.preventDefault();
  if (!state.studyExam) return;
  clearInterval(state.studyTimer);
  state.studyTimer = null;
  let correct = 0;
  state.studyExam.questions.forEach(question => {
    const answer = state.studyAnswers[question.id];
    let isCorrect = false;
    if (question.type === 'multiple_choice') isCorrect = Number(answer) === Number(question.answer);
    else if (question.type === 'true_false') isCorrect = String(answer) === String(Boolean(question.answer));
    else isCorrect = shortAnswerMatches(answer, question.answer);
    question.userAnswer = answer === undefined ? '' : answer;
    question.correct = isCorrect;
    if (isCorrect) correct += 1;
  });
  const count = state.studyExam.questions.length;
  const score = count ? Math.round(correct / count * 100) : 0;
  const attempt = { date: new Date().toISOString(), title: state.studyExam.title, topic: state.studyExam.topic, score, correct, count };
  state.studyHistory.unshift(attempt);
  state.studyHistory = state.studyHistory.slice(0, 40);
  saveStudyHistory();
  renderStudyResult(correct, score);
}

function renderStudyResult(correct, score) {
  const exam = state.studyExam;
  $('#studyResultTitle').textContent = exam.title || 'Resultado del examen';
  $('#studyResultSummary').textContent = score >= 85 ? 'Excelente dominio. Puedes subir la dificultad cuando quieras.' : score >= 60 ? 'Buen punto de partida. Revisa los conceptos marcados para afianzarlos.' : 'No pasa nada: repasar los errores es la parte más útil del estudio.';
  $('#studyScoreValue').textContent = `${score}%`;
  $('#studyCorrectCount').textContent = `${correct}/${exam.questions.length}`;
  $('#studyWrongCount').textContent = String(exam.questions.length - correct);
  $('#studyResultDifficulty').textContent = String(exam.difficulty || 'medio').toUpperCase();
  $('#studyResultTopic').textContent = exam.topic || 'Repaso a partir de imágenes';
  $('#studyResultTime').textContent = `${exam.questions.length} preguntas · ${exam.timeLimit ? `límite ${exam.timeLimit} min` : 'sin límite'}`;
  const review = $('#studyReview');
  review.replaceChildren();
  exam.questions.forEach((question, index) => {
    const item = document.createElement('article');
    item.className = `study-review-item ${question.correct ? 'correct' : 'wrong'}`;
    const badge = document.createElement('span');
    badge.className = 'review-badge';
    badge.textContent = question.correct ? '✓ CORRECTA' : '× PARA REPASAR';
    const title = document.createElement('strong');
    title.textContent = `${index + 1}. ${question.question}`;
    const detail = document.createElement('p');
    const answer = question.type === 'multiple_choice' ? question.options?.[Number(question.answer)] : question.type === 'true_false' ? (question.answer ? 'Verdadero' : 'Falso') : question.answer;
    const mine = question.userAnswer === '' ? 'Sin respuesta' : question.type === 'multiple_choice' ? question.options?.[Number(question.userAnswer)] : question.type === 'true_false' ? (String(question.userAnswer) === 'true' ? 'Verdadero' : 'Falso') : question.userAnswer;
    detail.textContent = `${question.correct ? 'Tu respuesta' : `Tu respuesta: ${mine}. Respuesta esperada: ${answer}.`} ${question.explanation || ''}`.trim();
    item.append(badge, title, detail);
    review.append(item);
  });
  setStudyScene('result');
}

$('#studyImages').addEventListener('change', handleStudyImages);
$$('.study-type-choice').forEach(button => button.addEventListener('click', () => applyStudyTypePreset(button.dataset.studyTypePreset)));
$$('[data-study-difficulty]').forEach(button => button.addEventListener('click', () => setStudyDifficulty(button.dataset.studyDifficulty)));
const studyQuestionCount = $('#studyQuestionCount');
const studyQuestionCountValue = $('#studyQuestionCountValue');
if (studyQuestionCount && studyQuestionCountValue) {
  const updateStudyQuestionCount = () => { studyQuestionCountValue.value = studyQuestionCount.value; studyQuestionCountValue.textContent = studyQuestionCount.value; };
  studyQuestionCount.addEventListener('input', updateStudyQuestionCount);
  updateStudyQuestionCount();
}
$('#studyBuilder').addEventListener('submit', generateStudyExam);
$('#studyExamForm').addEventListener('submit', gradeStudyExam);
$('#studyBackToBuilder').addEventListener('click', () => { clearInterval(state.studyTimer); setStudyScene('builder'); });
$('#studyCancelExam').addEventListener('click', () => { clearInterval(state.studyTimer); state.studyExam = null; setStudyScene('builder'); });
$('#studyResultBack').addEventListener('click', () => { state.studyExam = null; setStudyScene('builder'); });
$('#studyNewExam').addEventListener('click', () => { state.studyExam = null; setStudyScene('builder'); });
$('#studyRetryExam').addEventListener('click', () => { if (!state.studyExam) return; state.studyAnswers = {}; renderStudyExam(); });
$('#studyClearHistory').addEventListener('click', () => { if (!state.studyHistory.length || window.confirm('¿Borrar el historial local de Study?')) { state.studyHistory = []; saveStudyHistory(); renderStudyHistory(); toast('Historial de Study borrado.'); } });

$$('[data-study-page]').forEach(button => button.addEventListener('click', () => navigateStudyPage(button.dataset.studyPage)));

$('#studyLink').addEventListener('click', () => {
  state.studyExam = state.activeView === 'study' ? state.studyExam : null;
  setStudyScene('builder');
  showStudyPage('dashboard');
});

$('#composerForm').addEventListener('submit', event => { event.preventDefault(); sendCurrent(); });
$('#attachButton')?.addEventListener('click', () => $('#fileInput')?.click());
$('#fileInput')?.addEventListener('change', event => { addAttachments(event.target.files || []); event.target.value = ''; });
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
$('#revokeAppOpeningPermission').addEventListener('click', revokeAppOpeningPermission);
$('#refreshRobloxBridge').addEventListener('click', refreshRobloxBridgeStatus);
$('#newChat').addEventListener('click', () => {
  if (state.busy) return;
  state.attachments.forEach(item => window.JarvisAttachments?.release(item));
  showChatView();
  state.messages = [];
  state.attachments = [];
  renderAttachmentTray();
  saveHistory();
  $('#conversation').replaceChildren();
  $('#pendingArea').replaceChildren();
  $('#welcome').hidden = false;
  $('#messageInput').focus();
});
$('#chatLink').addEventListener('click', () => { showChatView(); $('#messageInput').focus(); });
$('#projectsLink').addEventListener('click', async () => {
  showChatView();
  try { await api('/api/action', { approved: true, name: 'open_app', arguments: { app: 'explorador' } }); toast('Abriendo la carpeta local de proyectos.'); }
  catch (error) { toast(error.message); }
});
$$('.prompt-card').forEach(button => button.addEventListener('click', () => sendCurrent(button.dataset.prompt)));

visibleHistory();
refreshStatus();
setVoiceCapability();
