// =============================================================================
// script.js — ScreenCheck Frontend
// =============================================================================

const MAX_IMAGENS   = 3;
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];
const API_URL       = "https://screen.cdqweb.com.br";
const MAX_TENTATIVAS = 2;   // tenta novamente automaticamente em caso de erro

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
      <img src="${previewUrl}" alt="${file.name}"
           onclick="abrirZoom('${previewUrl}','${file.name}')"
           style="cursor:zoom-in" title="Clique para ampliar" />
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
  resultArea.innerHTML = `<h2 class="resultado-titulo">Resultados</h2>`;

  for (let idx = 0; idx < arquivos.length; idx++) {
    const item = arquivos[idx];
    setBusy(true, `Analisando ${idx + 1}/${arquivos.length}...`);

    // Cria card de "aguardando" imediatamente
    criarCardAguardando(item, idx);

    // Tenta até MAX_TENTATIVAS vezes
    let resultado = null;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      if (tentativa > 1) {
        atualizarCardStatus(idx, "retry", `Tentativa ${tentativa}/${MAX_TENTATIVAS}...`);
        await esperar(1500);
      }
      resultado = await analisarImagem(item, idx);
      if (!resultado.erro) break;
      // Se ainda tem tentativas, mostra que está tentando novamente
      if (tentativa < MAX_TENTATIVAS) {
        atualizarCardStatus(idx, "warning",
          `Erro na tentativa ${tentativa} — tentando novamente...`);
      }
    }

    // Atualiza o card com o resultado final (sucesso ou erro definitivo)
    atualizarCard(resultado);
  }

  setBusy(false);
  analisando = false;
}

async function analisarImagem(item, idx) {
  const form = new FormData();
  form.append("imagem", item.file);
  try {
    const resp = await fetch(`${API_URL}/analisar-tela`, {
      method: "POST", body: form
    });
    const data = await resp.json();
    if (!resp.ok)
      return { idx, nome: item.file.name, previewUrl: item.previewUrl,
               erro: data.detail || `Erro ${resp.status}` };
    return { idx, nome: item.file.name, previewUrl: item.previewUrl, resultado: data };
  } catch (e) {
    return { idx, nome: item.file.name, previewUrl: item.previewUrl,
             erro: e.name === "AbortError"
               ? "Tempo esgotado — tente uma imagem menor."
               : "Falha de conexão com o servidor." };
  }
}

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Cards de resultado ────────────────────────────────────────────────────────
function criarCardAguardando(item, idx) {
  // Remove card existente se houver (retry)
  const existente = document.getElementById(`resultado-card-${idx}`);
  if (existente) existente.remove();

  const card = document.createElement("div");
  card.className = "resultado-card";
  card.id = `resultado-card-${idx}`;
  card.innerHTML = `
    <div class="resultado-img-wrap" onclick="abrirZoom('${item.previewUrl}','${item.file.name}')"
         style="cursor:zoom-in" title="Clique para ampliar">
      <img src="${item.previewUrl}" alt="${item.file.name}" id="img-result-${idx}" />
      <canvas id="canvas-${idx}" class="canvas-overlay"></canvas>
      <div class="zoom-hint">🔍</div>
    </div>
    <div class="resultado-body">
      <p class="resultado-nome">${item.file.name}</p>
      <div class="badge badge-nd" id="badge-${idx}">
        <span class="mini-spin"></span> Analisando...
      </div>
      <p class="resultado-msg" id="msg-${idx}" style="color:var(--muted)">
        Aguardando resposta do servidor...
      </p>
    </div>`;
  resultArea.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function atualizarCardStatus(idx, tipo, msg) {
  const badge = document.getElementById(`badge-${idx}`);
  const msgEl = document.getElementById(`msg-${idx}`);
  if (!badge || !msgEl) return;
  if (tipo === "retry") {
    badge.className   = "badge badge-nd";
    badge.innerHTML   = `<span class="mini-spin"></span> Tentando...`;
    msgEl.textContent = msg;
    msgEl.style.color = "var(--yellow)";
  } else if (tipo === "warning") {
    badge.className   = "badge badge-dano";
    badge.innerHTML   = "⚠ " + msg;
    msgEl.textContent = "";
  }
}

function atualizarCard(r) {
  const card  = document.getElementById(`resultado-card-${r.idx}`);
  const badge = document.getElementById(`badge-${r.idx}`);
  const msgEl = document.getElementById(`msg-${r.idx}`);
  if (!card || !badge) return;

  if (r.erro) {
    badge.className   = "badge badge-erro";
    badge.innerHTML   = "✗ Erro";
    if (msgEl) {
      msgEl.textContent = r.erro;
      msgEl.style.color = "#fca5a5";
    }
    // Botão de retentar individual
    const body = card.querySelector(".resultado-body");
    if (body) {
      const btn = document.createElement("button");
      btn.className = "btn-retentar";
      btn.textContent = "↺ Tentar novamente";
      btn.onclick = () => retentarIndividual(r.idx);
      body.appendChild(btn);
    }
    return;
  }

  const res       = r.resultado;
  const veredicto = res.veredicto;
  const confianca = Math.round(res.confianca * 100);
  const nPontos   = res.total_danos || 0;
  const naoIdent  = veredicto === "nao_identificado";

  const badgeClass = naoIdent           ? "badge-nd"
                   : veredicto === "ok" ? "badge-ok"
                   : "badge-dano";
  const badgeLabel = naoIdent           ? "❓ Não identificado"
                   : veredicto === "ok" ? "✅ Tela OK"
                   : "⚠ Danificada";
  const detalhe = veredicto === "damaged" && nPontos > 0
    ? `${nPontos} ponto(s) de dano localizado(s)`
    : res.mensagem || "";

  badge.className = `badge ${badgeClass}`;
  badge.innerHTML = badgeLabel;
  if (msgEl) msgEl.remove();

  // Injeta barra de confiança e detalhe
  const body = card.querySelector(".resultado-body");
  const extras = document.createElement("div");
  extras.innerHTML = `
    <div class="confianca-wrap">
      <div class="confianca-label"><span>Certeza</span><span>${confianca}%</span></div>
      <div class="barra-bg">
        <div class="barra-fill ${badgeClass}" id="barra-${r.idx}" style="width:0%"></div>
      </div>
    </div>
    ${detalhe ? `<p class="resultado-msg">${detalhe}</p>` : ""}`;
  body.appendChild(extras);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const barra = document.getElementById(`barra-${r.idx}`);
    if (barra) barra.style.width = confianca + "%";
  }));

  // Guarda resultado e desenha boxes
  window[`_res_${r.idx}`] = res;
  const img = document.getElementById(`img-result-${r.idx}`);
  if (img && img.complete) desenharDeteccoes(r.idx);
  else if (img) img.addEventListener("load", () => desenharDeteccoes(r.idx));
}

// ── Retentar imagem individual ────────────────────────────────────────────────
async function retentarIndividual(idx) {
  if (idx >= arquivos.length) return;
  const item = arquivos[idx];

  // Remove botão de retentar e volta ao estado "analisando"
  const card = document.getElementById(`resultado-card-${idx}`);
  if (card) {
    const btn = card.querySelector(".btn-retentar");
    if (btn) btn.remove();
  }
  atualizarCardStatus(idx, "retry", "Enviando novamente...");

  let resultado = null;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    if (tentativa > 1) {
      atualizarCardStatus(idx, "warning", `Tentativa ${tentativa}...`);
      await esperar(1500);
    }
    resultado = await analisarImagem(item, idx);
    if (!resultado.erro) break;
  }
  atualizarCard(resultado);
}

// ── Desenhar bounding boxes ───────────────────────────────────────────────────
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

// ── Zoom modal ────────────────────────────────────────────────────────────────
let zoomAtual    = 1.0;
let zoomNome     = "";
let zoomArrastando = false;
let zoomInicioArrasto = null;

function abrirZoom(src, nome) {
  const modal = document.getElementById("zoom-modal");
  const img   = document.getElementById("zoom-img");
  const titulo= document.getElementById("zoom-titulo");
  zoomNome = nome;
  zoomAtual = 1.0;
  img.src = src;
  titulo.textContent = nome;
  img.style.transform = "scale(1)";
  img.style.transformOrigin = "center center";
  modal.style.display = "flex";
  document.getElementById("zoom-pct").textContent = "100%";
  document.body.style.overflow = "hidden";
}

function fecharZoom() {
  document.getElementById("zoom-modal").style.display = "none";
  document.body.style.overflow = "";
}

function ajustarZoomModal(delta) {
  zoomAtual = Math.max(0.25, Math.min(6, zoomAtual + delta));
  document.getElementById("zoom-img").style.transform = `scale(${zoomAtual})`;
  document.getElementById("zoom-pct").textContent = Math.round(zoomAtual * 100) + "%";
}

function resetZoomModal() {
  zoomAtual = 1.0;
  document.getElementById("zoom-img").style.transform = "scale(1)";
  document.getElementById("zoom-pct").textContent = "100%";
}

// Scroll para zoom no modal
document.addEventListener("DOMContentLoaded", () => {
  const modalScroll = document.getElementById("zoom-modal-scroll");
  if (modalScroll) {
    modalScroll.addEventListener("wheel", e => {
      e.preventDefault();
      ajustarZoomModal(e.deltaY > 0 ? -0.15 : 0.15);
    }, { passive: false });
  }

  // Fechar modal com Escape ou clicando fora da imagem
  document.getElementById("zoom-modal")?.addEventListener("click", e => {
    if (e.target.id === "zoom-modal") fecharZoom();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") fecharZoom();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setBusy(busy, msg) {
  btnAnalisar.disabled  = busy;
  btnAnalisar.innerHTML = busy
    ? `<div class="spinner"></div> ${msg || "Analisando..."}`
    : "Analisar";
}

function mostrarToast(msg, tipo = "ok") {
  toast.textContent = msg;
  toast.className   = `toast show toast-${tipo}`;
  setTimeout(() => toast.className = "toast", 3000);
}

renderizarPreviews();
