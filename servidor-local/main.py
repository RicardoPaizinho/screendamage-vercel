# =============================================================================
# servidor-local/main.py — FastAPI com PyTorch + Mask R-CNN
# Roda no seu servidor/PC, NÃO na Vercel
# =============================================================================
# COMO RODAR:
#   pip install fastapi uvicorn torch torchvision pillow opencv-python-headless python-multipart
#   uvicorn main:app --host 0.0.0.0 --port 8000
#
# Coloque o modelo em: ./modelo/melhor_modelo_maskrcnn.pth
# =============================================================================

import io
import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
import torch
import torchvision.transforms.functional as TF
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from torchvision.models.detection import maskrcnn_resnet50_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.models.detection.mask_rcnn import MaskRCNNPredictor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("screendamage")

# ── Configurações ─────────────────────────────────────────────────────────────
BASE_DIR       = Path(__file__).parent
CAMINHO_MODELO = os.getenv("CAMINHO_MODELO", str(BASE_DIR / "modelo" / "melhor_modelo_maskrcnn.pth"))
DEVICE         = torch.device("cuda" if torch.cuda.is_available() else "cpu")

estado = {"modelo": None, "ckpt": None}

# ── Pré-processamento ─────────────────────────────────────────────────────────
def remover_reflexo(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    H, S, V = cv2.split(hsv)
    mascara = ((V > 240) & (S < 30)).astype(np.uint8) * 255
    kernel  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mascara = cv2.dilate(mascara, kernel, iterations=2)
    if mascara.sum() > 0:
        img = cv2.inpaint(img, mascara, 5, cv2.INPAINT_TELEA)
    return img

def aplicar_clahe(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return cv2.cvtColor(cv2.merge([clahe.apply(l), a, b]), cv2.COLOR_LAB2BGR)

def normalizar_brilho(img, alvo=128):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    H, S, V = cv2.split(hsv)
    m = V.mean()
    if m > 0:
        V = np.clip(V * (alvo / m), 0, 255)
    return cv2.cvtColor(cv2.merge([H, S, V]).astype(np.uint8), cv2.COLOR_HSV2BGR)

def preprocessar(img_bgr):
    img = remover_reflexo(img_bgr)
    img = aplicar_clahe(img)
    img = normalizar_brilho(img)
    return img

# ── Carregar modelo ───────────────────────────────────────────────────────────
def carregar_modelo(caminho: str):
    ckpt = torch.load(caminho, map_location=DEVICE)

    modelo = maskrcnn_resnet50_fpn(weights=None)
    n      = ckpt["num_classes"]

    in_feat = modelo.roi_heads.box_predictor.cls_score.in_features
    modelo.roi_heads.box_predictor = FastRCNNPredictor(in_feat, n)

    in_mask = modelo.roi_heads.mask_predictor.conv5_mask.in_channels
    modelo.roi_heads.mask_predictor = MaskRCNNPredictor(in_mask, 256, n)

    modelo.load_state_dict(ckpt["model_state"])
    modelo.transform.min_size = (ckpt.get("img_min_size", 600),)
    modelo.transform.max_size = ckpt.get("img_max_size", 800)
    modelo.eval().to(DEVICE)
    return modelo, ckpt

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Carregando modelo de: %s", CAMINHO_MODELO)
    if not Path(CAMINHO_MODELO).exists():
        logger.error("Modelo não encontrado em '%s'", CAMINHO_MODELO)
    else:
        try:
            modelo, ckpt = carregar_modelo(CAMINHO_MODELO)
            estado["modelo"] = modelo
            estado["ckpt"]   = ckpt
            # Warmup
            dummy = torch.zeros(1, 3, 600, 800).to(DEVICE)
            with torch.no_grad():
                modelo([dummy[0]])
            logger.info("Modelo carregado | device=%s | classes=%s", DEVICE, ckpt["classes"])
        except Exception as e:
            logger.exception("Falha ao carregar modelo: %s", e)
    yield
    logger.info("Servidor encerrado.")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="ScreenCheck API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ───────────────────────────────────────────────────────────────────
class BBox(BaseModel):
    x1: int; y1: int; x2: int; y2: int

class Deteccao(BaseModel):
    classe:    str
    confianca: float
    bbox:      BBox

class Resultado(BaseModel):
    veredicto:    str        # ok | damaged | nao_identificado
    danificada:   bool
    confianca:    float
    mensagem:     str
    total_danos:  int
    largura_img:  int
    altura_img:   int
    smartphone:   Deteccao | None
    pontos_dano:  list[Deteccao]

# ── Inferência ────────────────────────────────────────────────────────────────
@torch.no_grad()
def inferir(img_pil: Image.Image) -> dict:
    ckpt        = estado["ckpt"]
    classes     = ckpt["classes"]
    conf_min    = ckpt.get("conf_minima",       0.30)
    conf_id     = ckpt.get("conf_identificado", 0.70)
    mask_thr    = ckpt.get("mask_threshold",    0.50)
    larg, alt   = img_pil.size

    img_bgr  = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
    img_proc = preprocessar(img_bgr)
    img_rgb  = cv2.cvtColor(img_proc, cv2.COLOR_BGR2RGB)
    img_t    = TF.to_tensor(Image.fromarray(img_rgb)).unsqueeze(0).to(DEVICE)

    pred     = estado["modelo"](img_t)[0]
    area_img = img_t.shape[2] * img_t.shape[3]

    mask_c  = pred["scores"] >= conf_min
    boxes   = pred["boxes"][mask_c].cpu().numpy()
    labels  = pred["labels"][mask_c].cpu().numpy()
    scores  = pred["scores"][mask_c].cpu().numpy()

    # Escala de volta para dimensões originais
    sx = larg / img_t.shape[3]
    sy = alt  / img_t.shape[2]

    smartphone  = None
    pontos_dano = []

    for box, lbl, score in zip(boxes, labels, scores):
        x1, y1, x2, y2 = box
        area_r = (x2 - x1) * (y2 - y1) / area_img
        nome   = classes[lbl] if lbl < len(classes) else "?"

        det = Deteccao(
            classe    = nome,
            confianca = round(float(score), 4),
            bbox      = BBox(
                x1=max(0, int(x1*sx)), y1=max(0, int(y1*sy)),
                x2=min(larg, int(x2*sx)), y2=min(alt, int(y2*sy)),
            ),
        )

        if area_r > 0.30:
            if smartphone is None or score > smartphone.confianca:
                smartphone = det
        else:
            pontos_dano.append(det)

    det_p     = smartphone or (pontos_dano[0] if pontos_dano else None)
    danificada = False

    if det_p is None or det_p.confianca < conf_id:
        veredicto = "nao_identificado"
        confianca = det_p.confianca if det_p else 0.0
        mensagem  = "Não foi possível identificar a tela com certeza suficiente."
    else:
        veredicto  = det_p.classe
        confianca  = det_p.confianca
        danificada = veredicto == "damaged"
        if danificada:
            n = len(pontos_dano)
            mensagem = f"Tela danificada detectada.{f' {n} ponto(s) de dano localizado(s).' if n else ''}"
        else:
            mensagem = "Tela em bom estado, sem danos visíveis."

    return Resultado(
        veredicto   = veredicto,
        danificada  = danificada,
        confianca   = round(float(confianca), 4),
        mensagem    = mensagem,
        total_danos = len(pontos_dano),
        largura_img = larg,
        altura_img  = alt,
        smartphone  = smartphone,
        pontos_dano = pontos_dano,
    )

# ── Rotas ─────────────────────────────────────────────────────────────────────
@app.get("/")
def raiz():
    return {"servico": "ScreenCheck API", "device": str(DEVICE),
            "modelo": Path(CAMINHO_MODELO).name}

@app.get("/health")
def health():
    return {
        "api":             "online",
        "modelo_carregado": estado["modelo"] is not None,
        "device":          str(DEVICE),
    }

@app.post("/analisar-tela", response_model=Resultado)
async def analisar_tela(imagem: UploadFile = File(...)):
    if estado["modelo"] is None:
        raise HTTPException(503, "Modelo não carregado. Verifique o arquivo .pth.")

    tipos = {"image/jpeg", "image/png", "image/webp"}
    if imagem.content_type not in tipos:
        raise HTTPException(400, f"Tipo não suportado: {imagem.content_type}")

    raw = await imagem.read()
    if not raw:
        raise HTTPException(400, "Arquivo vazio.")

    try:
        img_pil = Image.open(io.BytesIO(raw)).convert("RGB")
    except UnidentifiedImageError:
        raise HTTPException(400, "Imagem inválida ou corrompida.")

    try:
        resultado = inferir(img_pil)
    except Exception as e:
        logger.exception("Erro na inferência: %s", e)
        raise HTTPException(500, "Erro interno ao processar a imagem.")

    logger.info("veredicto=%s conf=%.2f", resultado.veredicto, resultado.confianca)
    return resultado
