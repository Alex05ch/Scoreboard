const BASE = '';

async function post(url, body) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function get(url) {
  const res = await fetch(BASE + url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

async function del(url) {
  const res = await fetch(BASE + url, { method: 'DELETE' });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

async function uploadFile(url, file, fieldName = 'file', onProgress = null) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append(fieldName, file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + url);
    if (onProgress) {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        const err = JSON.parse(xhr.responseText || '{}');
        reject(new Error(err.error || xhr.statusText));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red'));
    xhr.send(fd);
  });
}

function sseStream(url, onData, onDone) {
  const es = new EventSource(BASE + url);
  es.onmessage = e => {
    const data = JSON.parse(e.data);
    onData(data);
    if (data.status === 'done' || data.status === 'error') {
      es.close();
      onDone(data);
    }
  };
  es.onerror = () => { es.close(); onDone({ status: 'error', error: 'Connection lost' }); };
  return es;
}

export default { post, get, del, uploadFile, sseStream };
