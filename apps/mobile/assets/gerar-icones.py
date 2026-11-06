"""Gera os PNGs do ícone e da splash a partir do avatar da Órbita.

Uso: python3 apps/mobile/assets/gerar-icones.py   (precisa de Pillow)
Geometria igual à de src/ui/Avatar.tsx (viewBox 100): círculo branco, dois olhos pretos.
"""

from pathlib import Path

from PIL import Image, ImageDraw

AQUI = Path(__file__).parent
BRANCO, PRETO = (255, 255, 255, 255), (0, 0, 0, 255)
TAMANHO, SS = 1024, 4  # SS: supersampling para borda suave


def avatar(diametro: float, fundo):
    """Canvas TAMANHO x TAMANHO com o avatar centralizado e `diametro` px de largura."""
    n = TAMANHO * SS
    img = Image.new("RGBA", (n, n), fundo)
    d = ImageDraw.Draw(img)
    esc = diametro * SS / 100
    x0 = (n - 100 * esc) / 2
    y0 = x0

    def p(v):
        return x0 + v * esc

    d.ellipse([p(0), y0, p(100), y0 + 100 * esc], fill=BRANCO)
    for ex in (32, 57):
        d.rounded_rectangle(
            [x0 + ex * esc, y0 + 30 * esc, x0 + (ex + 11) * esc, y0 + 58 * esc],
            radius=5.5 * esc,
            fill=PRETO,
        )
    return img.resize((TAMANHO, TAMANHO), Image.LANCZOS)


# Ícone completo (iOS/legado): preto, avatar grande.
avatar(700, PRETO).save(AQUI / "icon.png")
# Adaptive: a zona segura é um círculo de 66% (~676 px); o avatar fica dentro dela.
avatar(600, (0, 0, 0, 0)).save(AQUI / "adaptive-icon.png")
# Splash: avatar sobre transparente (o fundo preto vem do plugin).
avatar(600, (0, 0, 0, 0)).save(AQUI / "splash-icon.png")
