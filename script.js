// =============================================================================
// script.js — ScreenCheck Frontend
// Chama o servidor Python diretamente para evitar timeout da Vercel
// =============================================================================

const MAX_IMAGENS  = 3;
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];

// URL do servidor Python — chama direto, sem passar pela Vercel
// Isso evita o timeout de 10s do plano gratuito da Vercel
const API_URL = "https://screen.cdqweb.com.br";

let arquivos   = [];
let analisando = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const dropZone    = document.getElementById("drop-zone");
const fileInput   = document.getElementById("file-input");
const previewArea = document.getElementById("preview-area");
const btnAnalisar = document.getElementById("btn-analisar");
const btnLimpar   = document.getElementById("btn-limpar");
const resultArea  = document.getElementById("result-area");
const toast       = document.getElementById("toast");

// ── Drag & drop ───────────────────────────────────────────────────────────────
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

["dragleave", "drop"].forEach(ev =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove("drag-over"))
);

dropZone.addEventListener("drop", e => {
  e.preventDefault();
  adicionarArquivos([...e.dataTransfer.files]);
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  adicionarArquivos([...fileInput.files]);
  fileInput.value = "";
});

// ── Gerenciar arquivos ────────────────────────────────────────────────────────
function adicionarArquivos(novos) {
  const validos   = novos.filter(f => TIPOS_ACEITOS.includes(f.type));
  const invalidos = novos.length - validos.length;

  if (invalidos > 0)
    mostrarToast(`${invalidos} arquivo(s) ignorado(s) — use JPG, PNG ou WEBP`, "erro");

  const espacos = MAX_IMAGENS - arquivos.length;
  if (validos.length > espacos)
    mostrarToast(`Máximo ${MAX_IMAGENS} imagens. ${validos.length - espacos} ignorada(s).`, "aviso");

  validos.slice(0, espacos).forEach(file =>
    arquivos.push({ file, previewUrl: URL.createObjectURL(file), resultado: null })
  );

  renderizarPreviews();
  resultArea.innerHTML = "";
}

function removerArquivo(idx) {
  URL.revokeObjectURL(arquivos[idx].previewUrl);
  arquivos.splice(idx, 1);
  renderizarPreviews();
  resultArea.innerHTML = "";
}

function renderizarPreviews() {
  previewArea.innerHTML = "";

  const contador = document.getElementById("contador");
  if (contador) contador.textContent = `${arquivos.length}/${MAX_IMAGENS}`;

  if (arquivos.length === 0) {
    btnAnalisar.disabled    = true;
    btnLimpar.style.display = "none";
    return;
  }

  arquivos.forEach(({ file, previewUrl }, idx) => {
    const card = document.createElement("div");
    card.className = "preview-card";
    card.innerHTML = `
      <button class="btn-remover" onclick="removerArquivo(${idx})" title="Remover">✕</button>
      <img src="${previewUrl}" alt="${file.name}" />
      <div class="preview-nome">${file.name}</div>`;
    previewArea.appendChild(card);
  });

  btnAnalisar.disabled    = false;
  btnLimpar.style.display = "inline-flex";
}

btnLimpar.addEventListener("click", () => {
  arquivos.forEach(a => URL.revokeObjectURL(a.previewUrl));
  arquivos = [];
  renderizarPreviews();
  resultArea.innerHTML = "";
});

// ── Analisar ──────────────────────────────────────────────────────────────────
btnAnalisar.addEventListener("click", analisar);

async function analisar() {
  if (analisando || arquivos.length === 0) return;
  analisando = true;
  setBusy(true);
  resultArea.innerHTML = "";

  // Analisa as imagens sequencialmente para não sobrecarregar o servidor CPU
  // (em paralelo com 3 imagens o modelo demora 3x mais por imagem)
  const resultados = [];
  for (let idx = 0; idx < arquivos.length; idx++) {
    setBusy(true, `Analisando ${idx + 1}/${arquivos.length}...`);
    const r = await analisarImagem(arquivos[idx], idx);
    resultados.push(r);
    // Exibe resultado parcial conforme vai chegando
    renderizarResultado(r, resultados.length - 1);
  }

  setBusy(false);
  analisando = false;
}

async function analisarImagem(item, idx) {
  const form = new FormData();
  form.append("imagem", item.file);

  try {
    // Chama o servidor Python diretamente (sem passar pela Vercel)
    const resp = await fetch(`${API_URL}/analisar-tela`, {
      method: "POST",
      body:   form,
    });

    const data = await resp.json();

    if (!resp.ok) {
      return {
        idx, nome: item.file.name, previewUrl: item.previewUrl,
        erro: data.detail || `Erro ${resp.status}`,
      };
    }

    return { idx, nome: item.file.name, previewUrl: item.previewUrl, resultado: data };

  } catch (e) {
    // Distingue timeout de erro de rede
    const msg = e.name === "AbortError"
      ? "Tempo esgotado — tente uma imagem menor."
      : "Falha de conexão com o servidor.";
    return { idx, nome: item.file.name, previewUrl: item.previewUrl, erro: msg };
  }
}

// ── Renderizar resultado individual ───────────────────────────────────────────
function renderizarResultado(r, posicao) {
  // Adiciona título só na primeira
  if (posicao === 0) {
    resultArea.innerHTML = `<h2 class="resultado-titulo">Resultados</h2>`;
  }

  const card = document.createElement("div");
  card.className = "resultado-card";
  card.id = `resultado-${r.idx}`;

  if (r.erro) {
    card.innerHTML = `
      <div class="resultado-img-wrap">
        <img src="${r.previewUrl}" alt="${r.nome}" />
      </div>
      <div class="resultado-body">
        <p class="resultado-nome">${r.nome}</p>
        <div class="badge badge-erro">⚠ Erro</div>
        <p class="resultado-msg erro-txt">${r.erro}</p>
      </div>`;
  } else {
    const res       = r.resultado;
    const veredicto = res.veredicto;
    const confianca = Math.round(res.confianca * 100);
    const nPontos   = res.total_danos || 0;
    const naoIdent  = veredicto === "nao_identificado";

    const badgeClass = naoIdent      ? "badge-nd"
                     : veredicto === "ok" ? "badge-ok"
                     : "badge-dano";

    const badgeLabel = naoIdent           ? "❓ Não identificado"
                     : veredicto === "ok" ? "✅ Tela OK"
                     : "⚠ Danificada";

    const detalhe = veredicto === "damaged" && nPontos > 0
      ? `${nPontos} ponto(s) de dano localizado(s)`
      : res.mensagem || "";

    card.innerHTML = `
      <div class="resultado-img-wrap">
        <img src="${r.previewUrl}" alt="${r.nome}"
             id="img-result-${r.idx}"
             onload="desenharDeteccoes(${r.idx})" />
        <canvas id="canvas-${r.idx}" class="canvas-overlay"></canvas>
      </div>
      <div class="resultado-body">
        <p class="resultado-nome">${r.nome}</p>
        <div class="badge ${badgeClass}">${badgeLabel}</div>
        <div class="confianca-wrap">
          <div class="confianca-label">
            <span>Certeza</span><span>${confianca}%</span>
          </div>
          <div class="barra-bg">
            <div class="barra-fill ${badgeClass}" style="width:0%"
                 id="barra-${r.idx}"></div>
          </div>
        </div>
        ${detalhe ? `<p class="resultado-msg">${detalhe}</p>` : ""}
      </div>`;

    // Guarda o resultado para usar no onload do canvas
    window[`_res_${r.idx}`] = res;

    // Anima a barra
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const barra = document.getElementById(`barra-${r.idx}`);
        if (barra) barra.style.width = confianca + "%";
      });
    });
  }

  resultArea.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Desenhar bounding boxes no canvas ────────────────────────────────────────
function desenharDeteccoes(idx) {
  const res    = window[`_res_${idx}`];
  const img    = document.getElementById(`img-result-${idx}`);
  const canvas = document.getElementById(`canvas-${idx}`);
  if (!res || !img || !canvas) return;

  canvas.width  = img.offsetWidth;
  canvas.height = img.offsetHeight;

  const scaleX = img.offsetWidth  / (res.largura_img || img.naturalWidth);
  const scaleY = img.offsetHeight / (res.altura_img  || img.naturalHeight);
  const ctx    = canvas.getContext("2d");

  const dets = [];
  if (res.smartphone)  dets.push({ ...res.smartphone,  tipo: "smartphone" });
  if (res.pontos_dano) res.pontos_dano.forEach(p => dets.push({ ...p, tipo: "ponto" }));

  dets.forEach(det => {
    if (!det.bbox) return;
    const { x1, y1, x2, y2 } = det.bbox;
    const sx1 = x1 * scaleX, sy1 = y1 * scaleY;
    const sw  = (x2 - x1) * scaleX, sh = (y2 - y1) * scaleY;

    const cor = det.classe === "ok" ? "#22c55e" : "#ef4444";

    ctx.strokeStyle = cor;
    ctx.lineWidth   = det.tipo === "smartphone" ? 3 : 2;
    ctx.setLineDash(det.tipo === "ponto" ? [6, 3] : []);
    ctx.fillStyle   = cor + "22";
    ctx.fillRect(sx1, sy1, sw, sh);
    ctx.strokeRect(sx1, sy1, sw, sh);
    ctx.setLineDash([]);

    const label = `${det.classe} ${Math.round(det.confianca * 100)}%`;
    ctx.font = "bold 11px system-ui";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = cor;
    ctx.fillRect(sx1, sy1 - 18, tw + 10, 18);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, sx1 + 5, sy1 - 5);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setBusy(busy, msg) {
  btnAnalisar.disabled = busy;
  btnAnalisar.innerHTML = busy
    ? `<div class="spinner"></div> ${msg || "Analisando..."}`
    : "Analisar";
}

function mostrarToast(msg, tipo = "ok") {
  toast.textContent = msg;
  toast.className   = `toast show toast-${tipo}`;
  setTimeout(() => toast.className = "toast", 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderizarPreviews();
