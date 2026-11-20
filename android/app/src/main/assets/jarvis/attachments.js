(() => {
  const uid = () => {
    try { return crypto.randomUUID(); }
    catch { return `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  };

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes;
    let unit = -1;
    do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
    return `${amount.toLocaleString('es-ES', { maximumFractionDigits: amount >= 100 ? 0 : 1 })} ${units[unit]}`;
  }

  function create(file) {
    const kind = String(file.type || '').startsWith('video/') ? 'video' : 'image';
    return {
      id: uid(),
      file,
      kind,
      name: file.name || (kind === 'video' ? 'video' : 'imagen'),
      type: file.type || (kind === 'video' ? 'video/*' : 'image/*'),
      size: Number(file.size) || 0,
      url: URL.createObjectURL(file),
      poster: '',
    };
  }

  function toDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  async function videoPoster(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    try {
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('No se pudo leer el vídeo.')), { once: true });
        video.load();
      });
      if (!video.videoWidth || !video.videoHeight) return '';
      if (Number.isFinite(video.duration) && video.duration > 0.05) {
        await new Promise(resolve => {
          const done = () => resolve();
          video.addEventListener('seeked', done, { once: true });
          video.currentTime = Math.min(0.5, video.duration / 2);
          setTimeout(done, 1200);
        });
      }
      const scale = Math.min(1, 720 / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.78);
    } catch { return ''; }
    finally { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); }
  }

  function release(attachment) {
    if (attachment?.url) URL.revokeObjectURL(attachment.url);
  }

  window.JarvisAttachments = { create, formatBytes, release, toDataUrl, videoPoster };
})();
