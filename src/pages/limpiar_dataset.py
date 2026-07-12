"""
Limpieza automática del dataset unificado con CLIP (zero-shot).

Los datasets de manzana y mandarina descargados traen imágenes contaminadas
(mangos, plátanos, tomates, fotos de stock con marca de agua, huertos lejanos,
estados de madurez mal etiquetados). Este script:

  1. Recorre data/{split}/{clase}/ para las clases afectadas.
  2. Clasifica cada imagen con CLIP (openai/clip-vit-base-patch32) contra un
     conjunto de descripciones (la esperada para su clase + distractores).
  3. Si la descripción top-1 no es una de las aceptadas para la clase,
     la imagen se MUEVE a data_descartadas/{clase}/ (no se borra).
  4. Actualiza data/indice.csv (quita filas descartadas) y guarda
     data_descartadas/descartes.csv con el detalle (ruta, clase, descripción
     top-1, score) para auditoría y para regenerar el dataset si hiciera falta.

Uso:
  python src/limpiar_dataset.py            # limpia
  python src/limpiar_dataset.py --dry-run  # solo reporta, no mueve nada
"""

import argparse
import os
import shutil

import pandas as pd
import torch
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_DATA = os.path.join(RAIZ, "data")
DIR_DESCARTES = os.path.join(RAIZ, "data_descartadas")
CSV_INDICE = os.path.join(DIR_DATA, "indice.csv")
CSV_DESCARTES = os.path.join(DIR_DESCARTES, "descartes.csv")
MODELO_CLIP = "openai/clip-vit-base-patch32"
BATCH = 64

# Descripciones candidatas. CLIP elige la más parecida a cada imagen;
# la imagen se conserva solo si la elegida está en ACEPTADAS de su clase.
DESCRIPCIONES = [
    "a photo of a single green unripe apple",
    "a photo of a ripe red or yellow apple",
    "a photo of a rotten or damaged apple",
    "a photo of a green unripe orange or tangerine",
    "a photo of a ripe orange tangerine fruit",
    "a photo of a rotten moldy orange",
    "a photo of a banana",
    "a photo of a mango",
    "a photo of a tomato",
    "a photo of an avocado",
    "a photo of a lime or lemon",
    "a photo of trees or an orchard landscape",
    "a stock photo with watermark text",
    "a diagram, collage or infographic with text",
    "a photo of leaves or plants without visible fruit",
]

# Clases a filtrar -> descripciones aceptadas.
# platano_* no se filtra: el dataset de bananas es limpio.
# Reglas calibradas por inspección visual de los grupos dudosos:
#   - manzana_maduro NO acepta "green apple": las Granny Smith verdes
#     etiquetadas Ripe contradicen la señal de color de madurez de la tesis.
#   - sobremaduro acepta "ripe apple"/"rotten orange" cruzados: CLIP confunde
#     manzana arrugada con sana y manzana podrida amarilla con naranja podrida.
#   - mandarina_verde acepta "lime": los cítricos verdes parecen limas.
#   - mandarina_maduro acepta "green orange": CLIP marca así naranjas maduras.
ACEPTADAS = {
    "manzana_verde":         {"a photo of a single green unripe apple"},
    "manzana_maduro":        {"a photo of a ripe red or yellow apple"},
    "manzana_sobremaduro":   {"a photo of a rotten or damaged apple",
                              "a photo of a ripe red or yellow apple",
                              "a photo of a rotten moldy orange"},
    "mandarina_verde":       {"a photo of a green unripe orange or tangerine",
                              "a photo of a lime or lemon"},
    "mandarina_maduro":      {"a photo of a ripe orange tangerine fruit",
                              "a photo of a green unripe orange or tangerine"},
    "mandarina_sobremaduro": {"a photo of a rotten moldy orange",
                              "a photo of a rotten or damaged apple",
                              "a photo of a green unripe orange or tangerine"},
}


def cargar_clip(dispositivo: str):
    from transformers import CLIPModel, CLIPProcessor
    modelo = CLIPModel.from_pretrained(MODELO_CLIP).to(dispositivo).eval()
    procesador = CLIPProcessor.from_pretrained(MODELO_CLIP)
    return modelo, procesador


@torch.no_grad()
def clasificar_lote(rutas, modelo, procesador, dispositivo):
    """Devuelve (indice_descripcion_top1, score_softmax) por imagen."""
    imagenes = [Image.open(r).convert("RGB") for r in rutas]
    entradas = procesador(text=DESCRIPCIONES, images=imagenes,
                          return_tensors="pt", padding=True).to(dispositivo)
    logits = modelo(**entradas).logits_per_image  # (n_imgs, n_textos)
    probs = logits.softmax(dim=1)
    scores, indices = probs.max(dim=1)
    return indices.cpu().tolist(), scores.cpu().tolist()


def main():
    parser = argparse.ArgumentParser(description="Limpieza del dataset con CLIP")
    parser.add_argument("--dry-run", action="store_true",
                        help="Solo reportar, sin mover archivos")
    parser.add_argument("--batch", type=int, default=BATCH)
    parser.add_argument("--usar-auditoria", action="store_true",
                        help="Reusar auditoria_clip.csv previa (no re-corre CLIP)")
    args = parser.parse_args()

    df = pd.read_csv(CSV_INDICE)
    filtrar = df[df["clase"].isin(ACEPTADAS)].copy()

    ruta_auditoria = os.path.join(DIR_DESCARTES, "auditoria_clip.csv")
    if args.usar_auditoria and os.path.exists(ruta_auditoria):
        print(f"Reusando evaluaciones de {ruta_auditoria}")
        aud = pd.read_csv(ruta_auditoria)[["ruta", "descripcion_top1", "score"]]
        filtrar = filtrar.merge(aud, on="ruta", how="inner")
    else:
        dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Dispositivo: {dispositivo} | Modelo: {MODELO_CLIP}")
        modelo, procesador = cargar_clip(dispositivo)
        print(f"Imágenes a evaluar: {len(filtrar)} de {len(df)} totales")

        resultados = []  # (ruta, descripcion_top1, score)
        rutas = filtrar["ruta"].tolist()
        for i in range(0, len(rutas), args.batch):
            lote = rutas[i:i + args.batch]
            indices, scores = clasificar_lote(lote, modelo, procesador, dispositivo)
            resultados.extend(
                (r, DESCRIPCIONES[k], s) for r, k, s in zip(lote, indices, scores)
            )
            if (i // args.batch) % 20 == 0:
                print(f"  procesadas {min(i + args.batch, len(rutas))}/{len(rutas)}")

        filtrar["descripcion_top1"] = [d for _, d, _ in resultados]
        filtrar["score"] = [s for _, _, s in resultados]
    filtrar["rechazada"] = [
        d not in ACEPTADAS[c]
        for c, d in zip(filtrar["clase"], filtrar["descripcion_top1"])
    ]

    # Auditoría completa (todas las evaluaciones) para calibrar sin re-correr CLIP
    os.makedirs(DIR_DESCARTES, exist_ok=True)
    ruta_auditoria = os.path.join(DIR_DESCARTES, "auditoria_clip.csv")
    filtrar[["ruta", "clase", "fuente", "split", "descripcion_top1",
             "score", "rechazada"]].to_csv(ruta_auditoria, index=False)
    print(f"\nAuditoría guardada en: {ruta_auditoria}")

    rechazadas = filtrar[filtrar["rechazada"]]
    print("\nRechazadas por clase:")
    resumen = rechazadas.groupby("clase").size()
    for clase in ACEPTADAS:
        total = (filtrar["clase"] == clase).sum()
        n = int(resumen.get(clase, 0))
        print(f"  {clase:<22} {n:>5} de {total} ({100 * n / total:.1f}%)")

    if args.dry_run:
        print("\n[dry-run] No se movió ningún archivo.")
        return

    # Mover rechazadas y actualizar índice
    for _, fila in rechazadas.iterrows():
        destino_dir = os.path.join(DIR_DESCARTES, fila["clase"])
        os.makedirs(destino_dir, exist_ok=True)
        shutil.move(fila["ruta"], os.path.join(
            destino_dir, os.path.basename(fila["ruta"])))

    os.makedirs(DIR_DESCARTES, exist_ok=True)
    rechazadas[["ruta", "clase", "fuente", "split",
                "descripcion_top1", "score"]].to_csv(CSV_DESCARTES, index=False)

    df_limpio = df[~df["ruta"].isin(set(rechazadas["ruta"]))].reset_index(drop=True)
    df_limpio.to_csv(CSV_INDICE, index=False)

    print(f"\nMovidas {len(rechazadas)} imágenes a {DIR_DESCARTES}")
    print(f"Índice actualizado: {len(df_limpio)} imágenes restantes")
    print("\nConteo final por clase y split:")
    print(df_limpio.pivot_table(index="clase", columns="split", values="ruta",
                                aggfunc="count", fill_value=0).to_string())


if __name__ == "__main__":
    main()
